/**
 * Motor de costos (hojas 6, 7 y 8 del Excel CTN). Código puro: recibe los hechos del rango ya
 * leídos y reparte el costo a los ítems por las tres vías de CLAUDE.md.
 *
 *  A DIRECTO: documentos del rango con ítem (certificados de subcontratista, recepciones DIRECTO,
 *    caja chica, ajustes) → al ítem tal cual.
 *  B COMÚN: avance del rango × consumo del ACU × (1 + desperdicio) × precio vigente. El desvío real
 *    (inventario entre dos conteos) va a "pérdidas de material", nunca a un ítem.
 *  C TIEMPO: pozo de tiempo + gastos generales + personal, repartido por horas valorizadas del
 *    parte diario; lo que no tenga ítem se prorratea por valor ganado.
 *
 * Todo lo que contabilidad registró en el rango cae en exactamente un balde, por eso vale:
 *   imputado + pérdidas + no imputado = total contable.
 */

export type InsumoTipo = "DIRECTO" | "COMUN" | "TIEMPO";

/** ITEM_TIEMPO = costo de personal propio ya asignado a un ítem (liquidación con rubro). */
export type Bucket = "ITEM" | "ITEM_TIEMPO" | "GG" | "POOL_STOCK" | "POOL_TIEMPO";

export interface LedgerLine {
  budgetItemId: number;
  bucket: Bucket;
  amount: number;
  source: string;
  sourceNumber?: string | null;
  fecha: string;
}

export interface EngineItem {
  id: number;
  code: string;
  name: string;
  unit: string | null;
  /** Avance ejecutado en el rango. */
  ejecutado: number;
  /** Valor ganado del rango (ejecutado × costo meta); null si el ítem no tiene costo meta. */
  vg: number | null;
}

export interface AcuComp {
  insumoId: number;
  consumo: number;
  desperdicioPct: number;
}

export interface EngineInsumo {
  id: number;
  code: string;
  description: string;
  unit: string;
  tipo: InsumoTipo;
  precio: number | null;
  /** En %, como en el catálogo (5 = 5 %). */
  toleranciaPct: number;
}

/** Inventario de un insumo COMÚN entre los dos conteos que encierran el rango. */
export interface InventarioInput {
  insumoId: number;
  ventana: { desde: string; hasta: string } | null;
  stockInicial: number;
  /** Compras + transferencias recibidas − enviadas + ajustes manuales dentro de la ventana. */
  entradas: number;
  stockFinal: number;
  /** Consumo teórico de toda la ventana (puede ser más larga que el rango). */
  teoricoVentana: number;
}

export interface HoraKey {
  budgetItemId: number | null;
  /** Horas valorizadas (horas × costo hora): la llave de reparto de la vía C. */
  peso: number;
  origen: "EQUIPO" | "PERSONAL";
}

export interface EngineInput {
  desde: string;
  hasta: string;
  items: EngineItem[];
  acu: Record<number, AcuComp[]>;
  insumos: Record<number, EngineInsumo>;
  ledger: LedgerLine[];
  inventario: InventarioInput[];
  horas: HoraKey[];
}

export type EstadoDesvio = "OK" | "ALERTA" | "REVISAR" | "SIN_CONTEO";

export interface MaterialResult {
  insumoId: number;
  code: string;
  description: string;
  unit: string;
  precio: number | null;
  teoricoRango: number;
  ventana: { desde: string; hasta: string } | null;
  stockInicial: number | null;
  entradas: number | null;
  stockFinal: number | null;
  consumoReal: number | null;
  teoricoVentana: number | null;
  desvio: number | null;
  desvioPct: number | null;
  toleranciaPct: number;
  estado: EstadoDesvio;
  /** Parte del desvío que corresponde al rango (prorrateado si la ventana es más larga). */
  perdidaRango: number;
  perdidaValorizada: number;
  prorrateado: boolean;
}

export interface ItemCost {
  budgetItemId: number;
  code: string;
  name: string;
  unit: string | null;
  ejecutado: number;
  a: { total: number; porFuente: Record<string, number> };
  b: { total: number; insumos: { insumoId: number; code: string; cantidad: number; precio: number | null; monto: number }[] };
  c: { total: number; asignado: number; porHoras: number; porVG: number };
  total: number;
  costoUnitario: number | null;
  vg: number | null;
  /** Índice de costo IC = VG ÷ CR. */
  ic: number | null;
}

export interface EngineResult {
  desde: string;
  hasta: string;
  items: ItemCost[];
  materiales: MaterialResult[];
  tiempo: { pozo: number; porHoras: number; porVG: number; sinDistribuir: number; pesoConItem: number; pesoSinItem: number };
  noImputado: { total: number; stockNoConsumido: number; tiempoSinDistribuir: number };
  totales: {
    a: number;
    b: number;
    c: number;
    imputado: number;
    perdidas: number;
    noImputado: number;
    /** Costo real del período = imputado + pérdidas (hoja 7). */
    costoReal: number;
    totalContable: number;
    diferencia: number;
    ok: boolean;
    vg: number;
    ic: number | null;
  };
  avisos: string[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Consumo teórico por insumo e ítem: ejecutado × consumo × (1 + desperdicio). */
export function teoricoPorInsumo(ejecutado: Map<number, number>, acu: Record<number, AcuComp[]>, incluir: (insumoId: number) => boolean) {
  const out = new Map<number, Map<number, number>>();
  for (const [itemId, qty] of ejecutado) {
    if (!qty) continue;
    for (const c of acu[itemId] ?? []) {
      if (!incluir(c.insumoId)) continue;
      const byItem = out.get(c.insumoId) ?? new Map<number, number>();
      byItem.set(itemId, r6((byItem.get(itemId) ?? 0) + qty * c.consumo * (1 + (c.desperdicioPct || 0) / 100)));
      out.set(c.insumoId, byItem);
    }
  }
  return out;
}

export function estadoDesvio(desvioPct: number | null, toleranciaPct: number): EstadoDesvio {
  if (desvioPct === null) return "OK";
  const tol = toleranciaPct / 100;
  if (desvioPct > tol + 1e-9) return "ALERTA";
  if (desvioPct < -tol - 1e-9) return "REVISAR";
  return "OK";
}

export function computeCostEngine(input: EngineInput): EngineResult {
  const avisos: string[] = [];
  const isComun = (id: number) => input.insumos[id]?.tipo === "COMUN";
  const ejecutado = new Map(input.items.map((i) => [i.id, i.ejecutado]));
  const itemIds = new Set(input.items.map((i) => i.id));

  // ── Vía B: teórico de insumos COMUNES ────────────────────────────────
  const teorico = teoricoPorInsumo(ejecutado, input.acu, isComun);
  const sinPrecio = new Set<string>();
  const bByItem = new Map<number, ItemCost["b"]>();
  for (const [insumoId, byItem] of teorico) {
    const ins = input.insumos[insumoId];
    if (ins.precio === null) sinPrecio.add(ins.code);
    for (const [itemId, cantidad] of byItem) {
      const entry = bByItem.get(itemId) ?? { total: 0, insumos: [] };
      const monto = cantidad * (ins.precio ?? 0);
      entry.insumos.push({ insumoId, code: ins.code, cantidad, precio: ins.precio, monto });
      entry.total += monto;
      bByItem.set(itemId, entry);
    }
  }
  if (sinPrecio.size) avisos.push(`Insumos comunes sin precio vigente (valen 0): ${[...sinPrecio].join(", ")}`);

  // ── Pérdidas: inventario entre conteos ───────────────────────────────
  const inv = new Map(input.inventario.map((i) => [i.insumoId, i]));
  const comunes = new Set([...teorico.keys(), ...input.inventario.map((i) => i.insumoId)]);
  const materiales: MaterialResult[] = [...comunes].map((insumoId) => {
    const ins = input.insumos[insumoId];
    const teoricoRango = r6(sum([...(teorico.get(insumoId)?.values() ?? [])]));
    const base = { insumoId, code: ins.code, description: ins.description, unit: ins.unit, precio: ins.precio, teoricoRango, toleranciaPct: ins.toleranciaPct };
    const i = inv.get(insumoId);
    if (!i?.ventana) {
      return {
        ...base,
        ventana: null,
        stockInicial: null,
        entradas: null,
        stockFinal: null,
        consumoReal: null,
        teoricoVentana: null,
        desvio: null,
        desvioPct: null,
        estado: "SIN_CONTEO" as const,
        perdidaRango: 0,
        perdidaValorizada: 0,
        prorrateado: false,
      };
    }
    const consumoReal = r6(i.stockInicial + i.entradas - i.stockFinal);
    const desvio = r6(consumoReal - i.teoricoVentana);
    const desvioPct = i.teoricoVentana > 0 ? desvio / i.teoricoVentana : null;
    const mismaVentana = i.ventana.desde <= input.desde && i.ventana.hasta >= input.hasta && Math.abs(i.teoricoVentana - teoricoRango) < 1e-9;
    const perdidaRango = mismaVentana ? desvio : i.teoricoVentana > 0 ? r6((desvio * teoricoRango) / i.teoricoVentana) : 0;
    return {
      ...base,
      ventana: i.ventana,
      stockInicial: i.stockInicial,
      entradas: i.entradas,
      stockFinal: i.stockFinal,
      consumoReal,
      teoricoVentana: i.teoricoVentana,
      desvio,
      desvioPct,
      estado: estadoDesvio(desvioPct, ins.toleranciaPct),
      perdidaRango,
      perdidaValorizada: perdidaRango * (ins.precio ?? 0),
      prorrateado: !mismaVentana,
    };
  });
  materiales.sort((x, y) => x.code.localeCompare(y.code));
  const alertas = materiales.filter((m) => m.estado === "ALERTA");
  if (alertas.length) avisos.push(`Desvío de inventario sobre la tolerancia: ${alertas.map((m) => m.code).join(", ")}`);

  // ── Vía A y personal asignado ────────────────────────────────────────
  const aByItem = new Map<number, ItemCost["a"]>();
  const cAsignado = new Map<number, number>();
  for (const l of input.ledger) {
    if (l.bucket === "ITEM") {
      const e = aByItem.get(l.budgetItemId) ?? { total: 0, porFuente: {} };
      e.total += l.amount;
      e.porFuente[l.source] = (e.porFuente[l.source] ?? 0) + l.amount;
      aByItem.set(l.budgetItemId, e);
    } else if (l.bucket === "ITEM_TIEMPO") {
      cAsignado.set(l.budgetItemId, (cAsignado.get(l.budgetItemId) ?? 0) + l.amount);
    }
  }

  // ── Vía C: pozo por horas, resto por valor ganado ────────────────────
  const pozo = sum(input.ledger.filter((l) => l.bucket === "POOL_TIEMPO" || l.bucket === "GG").map((l) => l.amount));
  const pesoTotal = sum(input.horas.map((h) => h.peso));
  const pesoItem = new Map<number, number>();
  for (const h of input.horas) {
    if (h.budgetItemId !== null && itemIds.has(h.budgetItemId)) pesoItem.set(h.budgetItemId, (pesoItem.get(h.budgetItemId) ?? 0) + h.peso);
  }
  const pesoConItem = sum([...pesoItem.values()]);
  const porHoras = new Map<number, number>();
  if (pesoTotal > 0) for (const [id, w] of pesoItem) porHoras.set(id, (pozo * w) / pesoTotal);
  const resto = pozo - sum([...porHoras.values()]);
  const vgTotal = sum(input.items.map((i) => Math.max(i.vg ?? 0, 0)));
  const porVG = new Map<number, number>();
  let sinDistribuir = 0;
  if (Math.abs(resto) > 1e-9) {
    if (vgTotal > 0) {
      for (const i of input.items) if ((i.vg ?? 0) > 0) porVG.set(i.id, (resto * i.vg!) / vgTotal);
    } else {
      sinDistribuir = resto;
      avisos.push("Hay costos por tiempo sin horas por ítem y sin valor ganado en el rango: quedan como no imputados");
    }
  }

  // ── Resultado por ítem ───────────────────────────────────────────────
  const items: ItemCost[] = input.items.map((i) => {
    const a = aByItem.get(i.id) ?? { total: 0, porFuente: {} };
    const b = bByItem.get(i.id) ?? { total: 0, insumos: [] };
    const asignado = cAsignado.get(i.id) ?? 0;
    const h = porHoras.get(i.id) ?? 0;
    const v = porVG.get(i.id) ?? 0;
    const c = { total: asignado + h + v, asignado, porHoras: h, porVG: v };
    const total = a.total + b.total + c.total;
    return {
      budgetItemId: i.id,
      code: i.code,
      name: i.name,
      unit: i.unit,
      ejecutado: i.ejecutado,
      a,
      b,
      c,
      total,
      costoUnitario: i.ejecutado ? total / i.ejecutado : null,
      vg: i.vg,
      ic: i.vg !== null && total > 0 ? i.vg / total : null,
    };
  });
  const huerfanos = input.ledger.filter((l) => (l.bucket === "ITEM" || l.bucket === "ITEM_TIEMPO") && !itemIds.has(l.budgetItemId));
  if (huerfanos.length) avisos.push(`${huerfanos.length} movimiento(s) de ítems fuera del presupuesto vigente: se informan como no imputados`);

  const totA = sum(items.map((i) => i.a.total));
  const totB = sum(items.map((i) => i.b.total));
  const totC = sum(items.map((i) => i.c.total));
  const imputado = totA + totB + totC;
  const perdidas = sum(materiales.map((m) => m.perdidaValorizada));
  const stockMoney = sum(input.ledger.filter((l) => l.bucket === "POOL_STOCK").map((l) => l.amount));
  const stockNoConsumido = stockMoney - totB - perdidas;
  const tiempoSinDistribuir = sinDistribuir + sum(huerfanos.map((l) => l.amount));
  const noImputado = stockNoConsumido + tiempoSinDistribuir;
  const totalContable = sum(input.ledger.map((l) => l.amount));
  const diferencia = totalContable - (imputado + perdidas + noImputado);
  const vg = sum(items.map((i) => i.vg ?? 0));
  if (Math.abs(diferencia) >= 1) avisos.push(`Validación: la suma no cierra por ${Math.round(diferencia)} Gs`);

  return {
    desde: input.desde,
    hasta: input.hasta,
    items,
    materiales,
    tiempo: { pozo, porHoras: sum([...porHoras.values()]), porVG: sum([...porVG.values()]), sinDistribuir, pesoConItem, pesoSinItem: pesoTotal - pesoConItem },
    noImputado: { total: noImputado, stockNoConsumido, tiempoSinDistribuir },
    totales: {
      a: totA,
      b: totB,
      c: totC,
      imputado,
      perdidas,
      noImputado,
      costoReal: imputado + perdidas,
      totalContable,
      diferencia,
      ok: Math.abs(diferencia) < 1,
      vg,
      ic: imputado > 0 ? vg / imputado : null,
    },
    avisos,
  };
}
