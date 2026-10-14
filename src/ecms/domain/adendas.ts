import type { Prisma } from "@prisma/client";
import { DomainError, NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { audit } from "../../core/domain/audit";
import { toDay } from "../../core/domain/prices";
import { recalculateProjectFinancials } from "../../bridge/domain/projectFinancials";
import { cantidadVigente, montoVigente, r2, r4 } from "./previstoEjecutadoMath";

type Tx = Prisma.TransactionClient;

/**
 * Presupuesto original congelado + adendas.
 *  - `BudgetItem.contractQuantity/contractAmount` son el contrato original (congelado).
 *  - Una adenda cambia CANTIDADES (los precios unitarios no cambian) o suma ítems extra.
 *  - `totalQuantity` y `originalAmount` son la cantidad y el monto VIGENTES: caché de
 *    contrato + Σ deltas de las adendas APROBADAS (`recalcularVigente`). La fuente de verdad son las adendas.
 */

export interface AdendaLineaInput {
  tipo?: "VARIACION" | "EXTRA";
  budgetItemId?: number | null;
  /** Con signo. En un extra es la cantidad inicial (positiva). */
  deltaQuantity: number;
  nota?: string | null;
  codigo?: string | null;
  nombre?: string | null;
  unidad?: string | null;
  parentId?: number | null;
  precioUnitario?: number | null;
}

export interface AdendaInput {
  titulo: string;
  motivo?: string | null;
  resolucion?: string | null;
  fecha: string;
  createdBy?: string | null;
  lineas: AdendaLineaInput[];
}

const fmtQty = (n: number) => n.toLocaleString("es-PY", { maximumFractionDigits: 4 });

/** El presupuesto ya está congelado: cantidades y precios solo cambian por adenda. */
export async function presupuestoCongelado(tx: Tx, projectId: number) {
  const p = await tx.project.findUnique({ where: { id: projectId }, select: { presupuestoCongeladoAt: true } });
  return Boolean(p?.presupuestoCongeladoAt);
}

export function errorUsarAdenda(detalle: string) {
  return new DomainError("USE_ADENDA", `El presupuesto está congelado: ${detalle}. Las cantidades se cambian con una adenda y los precios no cambian.`, 409);
}

/** Congela el presupuesto actual como contrato original (una sola vez por obra). */
export async function congelarPresupuesto(tx: Tx, projectId: number) {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, presupuestoCongeladoAt: true } });
  if (!project) throw new NotFoundError("Obra", projectId);
  if (project.presupuestoCongeladoAt) throw new DomainError("ALREADY_FROZEN", "El presupuesto de esta obra ya está congelado", 409);
  const items = await tx.budgetItem.findMany({ where: { projectId, nodeKind: "ITEM", isSystem: false } });
  if (!items.length) throw new DomainError("NOTHING_TO_FREEZE", "La obra no tiene partidas para congelar", 422);
  for (const it of items) {
    await tx.budgetItem.update({
      where: { id: it.id },
      data: { contractQuantity: it.totalQuantity, contractAmount: it.originalAmount, isExtra: false, origenAdendaId: null },
    });
  }
  await tx.project.update({ where: { id: projectId }, data: { presupuestoCongeladoAt: new Date() } });
  await audit(tx, { entity: "Project", entityId: projectId, action: "BUDGET_FREEZE", payload: { items: items.length } });
  return { items: items.length };
}

/** Σ de deltas de adendas APROBADAS por ítem, opcionalmente sin una adenda o con una adicional. */
async function deltasPorItem(tx: Tx, projectId: number, opts: { excluir?: number; incluir?: number } = {}) {
  const aprobadas = await tx.adenda.findMany({ where: { projectId, estado: "APROBADA" }, select: { id: true } });
  const ids = new Set(aprobadas.map((a) => a.id));
  if (opts.excluir !== undefined) ids.delete(opts.excluir);
  if (opts.incluir !== undefined) ids.add(opts.incluir);
  const out = new Map<number, number>();
  if (!ids.size) return out;
  const lineas = await tx.adendaLinea.findMany({ where: { adendaId: { in: [...ids] } } });
  for (const l of lineas) {
    if (l.budgetItemId === null) continue;
    out.set(l.budgetItemId, r4((out.get(l.budgetItemId) ?? 0) + moneyNumber(l.deltaQuantity)));
  }
  return out;
}

/** Rehace la cantidad y el monto vigentes (caché) de todos los ítems a partir del contrato y las adendas aprobadas. */
export async function recalcularVigente(tx: Tx, projectId: number) {
  if (!(await presupuestoCongelado(tx, projectId))) return;
  const [items, sumas] = await Promise.all([
    tx.budgetItem.findMany({ where: { projectId, nodeKind: "ITEM", isSystem: false } }),
    deltasPorItem(tx, projectId),
  ]);
  for (const it of items) {
    const d = sumas.get(it.id) ?? 0;
    const qty = cantidadVigente(moneyNumber(it.contractQuantity), [d]);
    const amount = montoVigente(moneyNumber(it.contractAmount), moneyNumber(it.unitPrice), [d]);
    if (qty !== r4(moneyNumber(it.totalQuantity)) || amount !== r2(moneyNumber(it.originalAmount))) {
      await tx.budgetItem.update({ where: { id: it.id }, data: { totalQuantity: qty, originalAmount: amount } });
    }
  }
}

async function validarLineas(tx: Tx, projectId: number, lineas: AdendaLineaInput[]) {
  if (!lineas.length) throw new DomainError("ADENDA_VACIA", "La adenda necesita al menos una línea", 422);
  const codigosExtra = new Set<string>();
  for (const [i, l] of lineas.entries()) {
    const n = i + 1;
    const tipo = l.tipo ?? "VARIACION";
    if (!Number.isFinite(l.deltaQuantity) || l.deltaQuantity === 0) {
      throw new DomainError("ADENDA_LINEA", `Línea ${n}: la cantidad no puede ser 0`, 422);
    }
    if (tipo === "VARIACION") {
      if (!l.budgetItemId) throw new DomainError("ADENDA_LINEA", `Línea ${n}: elegí el ítem`, 422);
      const it = await tx.budgetItem.findUnique({ where: { id: l.budgetItemId } });
      if (!it || it.projectId !== projectId || it.nodeKind !== "ITEM" || it.isSystem) {
        throw new DomainError("ADENDA_LINEA", `Línea ${n}: el ítem no es una partida del presupuesto de esta obra`, 422);
      }
    } else {
      if (l.deltaQuantity < 0) throw new DomainError("ADENDA_LINEA", `Línea ${n}: un ítem extra lleva cantidad positiva`, 422);
      if (!l.codigo?.trim() || !l.nombre?.trim()) throw new DomainError("ADENDA_LINEA", `Línea ${n}: el ítem extra necesita código y descripción`, 422);
      if (l.precioUnitario === null || l.precioUnitario === undefined || !(l.precioUnitario >= 0)) {
        throw new DomainError("ADENDA_LINEA", `Línea ${n}: el ítem extra necesita su precio unitario`, 422);
      }
      if (!l.parentId) throw new DomainError("ADENDA_LINEA", `Línea ${n}: elegí el rubro donde va el ítem extra`, 422);
      const parent = await tx.budgetItem.findUnique({ where: { id: l.parentId } });
      if (!parent || parent.projectId !== projectId || parent.nodeKind === "ITEM") {
        throw new DomainError("ADENDA_LINEA", `Línea ${n}: el rubro no es válido`, 422);
      }
      const clave = `${l.parentId}/${l.codigo.trim()}`;
      if (codigosExtra.has(clave)) throw new DomainError("ADENDA_LINEA", `Línea ${n}: el código ${l.codigo} se repite en la adenda`, 422);
      codigosExtra.add(clave);
    }
  }
}

const datosLinea = (adendaId: number, l: AdendaLineaInput) => ({
  adendaId,
  tipo: l.tipo ?? "VARIACION",
  budgetItemId: (l.tipo ?? "VARIACION") === "VARIACION" ? l.budgetItemId ?? null : null,
  deltaQuantity: l.deltaQuantity,
  nota: l.nota?.trim() || null,
  codigo: l.codigo?.trim() || null,
  nombre: l.nombre?.trim() || null,
  unidad: l.unidad?.trim() || null,
  parentId: l.parentId ?? null,
  precioUnitario: l.precioUnitario ?? null,
});

export async function crearAdenda(tx: Tx, projectId: number, input: AdendaInput) {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, presupuestoCongeladoAt: true } });
  if (!project) throw new NotFoundError("Obra", projectId);
  if (!project.presupuestoCongeladoAt) {
    throw new DomainError("NOT_FROZEN", "Congelá el presupuesto original antes de cargar adendas", 409);
  }
  await validarLineas(tx, projectId, input.lineas);
  const last = await tx.adenda.findFirst({ where: { projectId }, orderBy: { numero: "desc" } });
  const adenda = await tx.adenda.create({
    data: {
      projectId,
      numero: (last?.numero ?? 0) + 1,
      titulo: input.titulo.trim(),
      motivo: input.motivo?.trim() || null,
      resolucion: input.resolucion?.trim() || null,
      fecha: toDay(input.fecha),
      estado: "BORRADOR",
      createdBy: input.createdBy ?? null,
    },
  });
  // Renglones aparte (no create anidado): el almacenamiento simulado de desarrollo no lo soporta.
  await tx.adendaLinea.createMany({ data: input.lineas.map((l) => datosLinea(adenda.id, l)) });
  await audit(tx, { entity: "Adenda", entityId: adenda.id, action: "CREATE", toStatus: "BORRADOR", payload: { numero: adenda.numero, lineas: input.lineas.length } });
  return adenda;
}

async function cargarAdenda(tx: Tx, id: number) {
  const adenda = await tx.adenda.findUnique({ where: { id } });
  if (!adenda) throw new NotFoundError("Adenda", id);
  return adenda;
}

export async function actualizarAdendaBorrador(tx: Tx, id: number, input: AdendaInput) {
  const adenda = await cargarAdenda(tx, id);
  if (adenda.estado !== "BORRADOR") {
    throw new DomainError("ADENDA_NO_EDITABLE", `La adenda N° ${adenda.numero} está ${adenda.estado.toLowerCase()}: solo se edita un borrador`, 409);
  }
  await validarLineas(tx, adenda.projectId, input.lineas);
  const next = await tx.adenda.update({
    where: { id },
    data: { titulo: input.titulo.trim(), motivo: input.motivo?.trim() || null, resolucion: input.resolucion?.trim() || null, fecha: toDay(input.fecha) },
  });
  await tx.adendaLinea.deleteMany({ where: { adendaId: id } });
  await tx.adendaLinea.createMany({ data: input.lineas.map((l) => datosLinea(id, l)) });
  await audit(tx, { entity: "Adenda", entityId: id, action: "UPDATE", payload: { lineas: input.lineas.length } });
  return next;
}

export async function eliminarAdendaBorrador(tx: Tx, id: number) {
  const adenda = await cargarAdenda(tx, id);
  if (adenda.estado !== "BORRADOR") {
    throw new DomainError("ADENDA_NO_EDITABLE", `La adenda N° ${adenda.numero} está ${adenda.estado.toLowerCase()}: solo se borra un borrador (una aprobada se anula)`, 409);
  }
  await tx.adendaLinea.deleteMany({ where: { adendaId: id } });
  await tx.adenda.delete({ where: { id } });
  await audit(tx, { entity: "Adenda", entityId: id, action: "DELETE", fromStatus: "BORRADOR" });
}

/**
 * Verifica que la cantidad vigente de cada ítem tocado quede ≥ 0 y no baje de lo ya ejecutado
 * (certificados al cliente). `deltas` son los deltas por ítem YA con el cambio aplicado.
 */
async function assertNoBajaDeEjecutado(tx: Tx, itemIds: number[], deltas: Map<number, number>, cuando: string) {
  if (!itemIds.length) return;
  const items = await tx.budgetItem.findMany({ where: { id: { in: [...new Set(itemIds)] } } });
  const problemas: string[] = [];
  for (const it of items) {
    const vigente = cantidadVigente(moneyNumber(it.contractQuantity), [deltas.get(it.id) ?? 0]);
    const ejecutada = moneyNumber(it.certifiedQuantity);
    if (vigente < 0) problemas.push(`${it.code} ${it.name}: la cantidad real quedaría en ${fmtQty(vigente)}`);
    else if (vigente + 0.0001 < ejecutada) {
      problemas.push(`${it.code} ${it.name}: la cantidad real quedaría en ${fmtQty(vigente)} y ya hay ${fmtQty(ejecutada)} ejecutados`);
    }
  }
  if (problemas.length) {
    throw new DomainError("ADENDA_BAJO_EJECUTADO", `No se puede ${cuando}: ${problemas.join("; ")}`, 409, problemas);
  }
}

export async function aprobarAdenda(tx: Tx, id: number, opts: { usuario?: string } = {}) {
  const adenda = await cargarAdenda(tx, id);
  if (adenda.estado !== "BORRADOR") {
    throw new DomainError("ADENDA_ESTADO", `La adenda N° ${adenda.numero} está ${adenda.estado.toLowerCase()}: solo se aprueba un borrador`, 409);
  }
  if (!(await presupuestoCongelado(tx, adenda.projectId))) {
    throw new DomainError("NOT_FROZEN", "Congelá el presupuesto original antes de aprobar adendas", 409);
  }
  const lineas = await tx.adendaLinea.findMany({ where: { adendaId: id }, orderBy: { id: "asc" } });
  if (!lineas.length) throw new DomainError("ADENDA_VACIA", "La adenda no tiene líneas", 422);

  // Variaciones: nada puede quedar por debajo de lo ejecutado
  const variaciones = lineas.filter((l) => l.tipo === "VARIACION" && l.budgetItemId !== null);
  const con = await deltasPorItem(tx, adenda.projectId, { incluir: id });
  await assertNoBajaDeEjecutado(tx, variaciones.map((l) => l.budgetItemId as number), con, `aprobar la adenda N° ${adenda.numero}`);

  // Extras: se crean como ítems con contrato 0
  for (const l of lineas.filter((x) => x.tipo === "EXTRA")) {
    if (l.budgetItemId !== null) continue; // ya creado (reintento)
    const parent = l.parentId ? await tx.budgetItem.findUnique({ where: { id: l.parentId } }) : null;
    if (!parent || parent.projectId !== adenda.projectId || parent.nodeKind === "ITEM") {
      throw new DomainError("ADENDA_LINEA", `El rubro del ítem extra ${l.codigo ?? ""} ya no es válido`, 422);
    }
    const codigo = (l.codigo ?? "").trim();
    const path = `${parent.path}/${codigo}`;
    if (await tx.budgetItem.findUnique({ where: { projectId_path: { projectId: adenda.projectId, path } } })) {
      throw new DomainError("DUPLICATE_CODE", `Ya existe "${codigo}" en el rubro ${parent.code}`, 409);
    }
    const qty = moneyNumber(l.deltaQuantity);
    const pu = moneyNumber(l.precioUnitario);
    const item = await tx.budgetItem.create({
      data: {
        projectId: adenda.projectId,
        parentId: parent.id,
        code: codigo,
        name: (l.nombre ?? "").trim(),
        category: parent.category,
        unit: l.unidad?.trim() || "un",
        totalQuantity: qty,
        unitPrice: pu,
        originalAmount: r2(qty * pu),
        contractQuantity: 0,
        contractAmount: 0,
        isSystem: false,
        isExtra: true,
        origenAdendaId: id,
        path,
        hierarchyLevel: parent.hierarchyLevel + 1,
        nodeKind: "ITEM",
        sortOrder: (await tx.budgetItem.count({ where: { projectId: adenda.projectId } })) + 1,
      },
    });
    await tx.adendaLinea.update({ where: { id: l.id }, data: { budgetItemId: item.id } });
  }

  const next = await tx.adenda.update({ where: { id }, data: { estado: "APROBADA", approvedAt: new Date() } });
  await recalcularVigente(tx, adenda.projectId);
  await recalculateProjectFinancials(tx, adenda.projectId);
  await audit(tx, {
    entity: "Adenda", entityId: id, action: "APPROVE", fromStatus: "BORRADOR", toStatus: "APROBADA",
    payload: { numero: adenda.numero, lineas: lineas.length, usuario: opts.usuario ?? null } as Prisma.InputJsonValue,
  });
  return next;
}

/** Ítem creado por la adenda que no lo usa ningún documento (se puede borrar al anular). */
async function itemSinReferencias(tx: Tx, id: number) {
  const where = { budgetItemId: id };
  const cuentas = await Promise.all([
    tx.budgetMovement.count({ where }),
    tx.certificationItem.count({ where }),
    tx.purchaseOrderDetail.count({ where }),
    tx.materialRequestDetail.count({ where }),
    tx.subcontractorContract.count({ where }),
    tx.pettyCashExpense.count({ where }),
    tx.stockMovement.count({ where }),
    tx.componenteItem.count({ where }),
    tx.parteEquipo.count({ where }),
    tx.parteHoraPersonal.count({ where }),
    tx.viajeCamion.count({ where }),
  ]);
  return cuentas.every((c) => c === 0);
}

export async function anularAdenda(tx: Tx, id: number, opts: { usuario?: string } = {}) {
  const adenda = await cargarAdenda(tx, id);
  if (adenda.estado !== "APROBADA") {
    throw new DomainError("ADENDA_ESTADO", `La adenda N° ${adenda.numero} está ${adenda.estado.toLowerCase()}: solo se anula una aprobada`, 409);
  }
  const lineas = await tx.adendaLinea.findMany({ where: { adendaId: id } });
  const sin = await deltasPorItem(tx, adenda.projectId, { excluir: id });
  await assertNoBajaDeEjecutado(
    tx,
    lineas.filter((l) => l.budgetItemId !== null).map((l) => l.budgetItemId as number),
    sin,
    `anular la adenda N° ${adenda.numero}`
  );

  const next = await tx.adenda.update({ where: { id }, data: { estado: "ANULADA" } });
  await recalcularVigente(tx, adenda.projectId);

  // Extras sin uso: se borran. Con documentos, quedan en 0 (no se pueden borrar).
  for (const l of lineas.filter((x) => x.tipo === "EXTRA" && x.budgetItemId !== null)) {
    const itemId = l.budgetItemId as number;
    if (await itemSinReferencias(tx, itemId)) {
      await tx.adendaLinea.update({ where: { id: l.id }, data: { budgetItemId: null } });
      await tx.budgetItem.delete({ where: { id: itemId } });
    }
  }
  await recalculateProjectFinancials(tx, adenda.projectId);
  await audit(tx, {
    entity: "Adenda", entityId: id, action: "CANCEL", fromStatus: "APROBADA", toStatus: "ANULADA",
    payload: { numero: adenda.numero, usuario: opts.usuario ?? null } as Prisma.InputJsonValue,
  });
  return next;
}
