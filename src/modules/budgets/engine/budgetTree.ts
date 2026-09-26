/**
 * Armado del árbol presupuestario y cuadre, a partir de las filas clasificadas.
 * Es código puro (sin Node ni base de datos): lo usa el servidor para validar y guardar,
 * y la pantalla de importación para recalcular en vivo mientras el usuario corrige filas.
 */
import type {
  BuildOptions,
  BuildResult,
  ImportRow,
  Reconciliation,
  RubroCheck,
  SurchargeLine,
  SurchargeTreatment,
  TreeNode,
  ValidationIssue,
} from "./types";

/** Línea de área de obra: "Área: 3) BLOQUE 11 - ADMINISTRACIÓN". */
export const AREA_PATTERN = /^\s*[aá]rea\s*:?\s*(\d+)\s*\)/i;

export const IVA_PATTERN =/^(i\.?\s?v\.?\s?a\.?\b|impuesto)/i;

export function defaultSurchargeTreatment(description: string): SurchargeTreatment {
  return IVA_PATTERN.test(description.trim()) ? "IGNORE" : "DISTRIBUTE";
}

function slug(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function round(value: number, decimals: number) {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

interface Draft {
  row: ImportRow;
  kind: "RUBRO" | "SUBRUBRO" | "ITEM";
  level: number;
  path: string;
  parentPath: string | null;
  children: string[];
  quantity: number;
  unitPrice: number;
  amount: number;
  unit: string | null;
}

export function buildBudgetTree(rows: ImportRow[], options: BuildOptions = {}): BuildResult {
  const decimals = options.currencyDecimals ?? 0;
  const strategy = options.arithmeticStrategy ?? "KEEP_ORIGINAL";
  const issues: ValidationIssue[] = [];
  const issue = (row: ImportRow | null, i: Omit<ValidationIssue, "id">) =>
    issues.push({
      id: `${i.category}-${row?.id ?? "global"}-${issues.length}`,
      sheet: row?.sheet,
      rowNumber: row?.rowNumber,
      rowId: row?.id,
      code: row?.code,
      itemDescription: row?.description,
      ...i,
    });

  const drafts = new Map<string, Draft>();
  const order: string[] = [];
  const stack: Draft[] = [];
  const subtotalRows: { row: ImportRow; openPaths: string[] }[] = [];
  const surchargeRows: ImportRow[] = [];
  const counts = { rubros: 0, subrubros: 0, items: 0, subtotals: 0, surcharges: 0, ignored: 0 };

  // 1. Estructura: padre = título abierto más cercano con nivel − 1.
  for (const row of rows) {
    if (row.kind === "IGNORAR") {
      counts.ignored++;
      continue;
    }
    if (row.kind === "SUBTOTAL") {
      counts.subtotals++;
      subtotalRows.push({ row, openPaths: stack.map((d) => d.path) });
      continue;
    }
    if (row.kind === "RECARGO") {
      counts.surcharges++;
      surchargeRows.push(row);
      continue;
    }

    const isHeading = row.kind === "RUBRO" || row.kind === "SUBRUBRO";
    const level = Math.max(0, Math.min(Math.round(row.level), stack.length));
    while (stack.length > level) stack.pop();
    const parent = level > 0 ? stack[level - 1] : undefined;

    if (!row.description && !row.code) {
      issue(row, { type: "CRITICAL", category: "MISSING_FIELD", field: "description", message: "Fila sin descripción ni código" });
    }

    // Clave compuesta: A2/ESTRUCTURA-DE-HORMIGON-ARMADO/2/2.1
    const areaMatch = isHeading ? (row.description || row.code).match(AREA_PATTERN) : null;
    const key = areaMatch
      ? `A${areaMatch[1]}`
      : slug(row.code || row.description || row.id).replace(/\//g, "-") || "NODO";
    const base = parent ? `${parent.path}/${key}` : key;

    // Mismo título repetido bajo el mismo padre (ej. "B.N. BLOQUES NUEVOS" que reaparece
    // dentro de un capítulo): se reabre el nodo existente en vez de duplicarlo.
    const existing = drafts.get(base);
    if (
      isHeading &&
      row.code &&
      existing &&
      existing.kind !== "ITEM" &&
      existing.row.code === row.code &&
      existing.row.description === row.description
    ) {
      stack.push(existing);
      continue;
    }

    let path = base;
    let n = 2;
    while (drafts.has(path)) path = `${base}~${n++}`;
    if (path !== base && row.code) {
      const other = drafts.get(base);
      if (other && other.row.code === row.code) {
        // Se importan las dos (la clave se desambigua con ~2); queda como advertencia.
        issue(row, {
          type: "WARNING",
          category: "DUPLICATE_CODE",
          field: "code",
          message: `Código "${row.code}" repetido dentro de ${parent ? `"${parent.row.description}"` : "la raíz"} (filas ${other.row.rowNumber} y ${row.rowNumber})`,
        });
      }
    }

    const draft: Draft = {
      row,
      kind: isHeading ? (level === 0 ? "RUBRO" : "SUBRUBRO") : "ITEM",
      level,
      path,
      parentPath: parent?.path ?? null,
      children: [],
      quantity: 0,
      unitPrice: 0,
      amount: 0,
      unit: row.unit || null,
    };
    drafts.set(path, draft);
    order.push(path);
    parent?.children.push(path);
    if (isHeading) stack.push(draft);
  }

  // 2. Títulos sin hijos: con monto → partida global; sin monto → se omiten.
  //    De abajo hacia arriba, para que un rubro que queda vacío también se detecte.
  for (const path of [...order].reverse()) {
    const d = drafts.get(path)!;
    if (d.kind === "ITEM" || d.children.length > 0) continue;
    if ((d.row.totalPrice ?? 0) > 0) {
      d.kind = "ITEM";
      d.unit = d.unit || "gl";
      issue(d.row, {
        type: "INFO",
        category: "HIERARCHY",
        message: `"${d.row.description}" no tiene ítems pero sí monto: se carga como partida global`,
      });
    } else {
      drafts.delete(path);
      if (d.parentPath) {
        const p = drafts.get(d.parentPath);
        if (p) p.children = p.children.filter((c) => c !== path);
      }
      issue(d.row, {
        type: "INFO",
        category: "HIERARCHY",
        message: `"${d.row.description || d.row.code}" es un título sin ítems ni monto: se omite`,
      });
    }
  }
  const livePaths = order.filter((p) => drafts.has(p));

  // 3. Montos de ítems.
  for (const path of livePaths) {
    const d = drafts.get(path)!;
    if (d.kind !== "ITEM") continue;
    const { row } = d;
    const q = row.quantity;
    const pu = row.unitPrice;
    const total = row.totalPrice;

    if ([q, pu, total].some((v) => v !== null && v < 0)) {
      issue(row, { type: "CRITICAL", category: "FORMAT", message: "Cantidad, precio o total negativo" });
    }

    if (row.noCotiza) {
      d.quantity = q ?? 0;
      d.unitPrice = 0;
      d.amount = 0;
    } else if (q !== null && pu !== null && total !== null) {
      const computed = q * pu;
      const tol = Math.max(1, Math.abs(computed) * 0.002);
      if (Math.abs(computed - total) > tol) {
        issue(row, {
          type: "WARNING",
          category: "ARITHMETIC",
          field: "totalPrice",
          message: `Cantidad × PU = ${round(computed, decimals).toLocaleString("es-PY")} pero la planilla dice ${total.toLocaleString("es-PY")}`,
        });
      }
      d.quantity = q;
      if (strategy === "RECALCULATE_TOTAL") {
        d.unitPrice = pu;
        d.amount = round(computed, decimals);
      } else if (strategy === "RECALCULATE_PU") {
        d.amount = round(total, decimals);
        d.unitPrice = q !== 0 ? total / q : pu;
      } else {
        d.unitPrice = pu;
        d.amount = round(total, decimals);
      }
    } else if (q !== null && pu !== null) {
      d.quantity = q;
      d.unitPrice = pu;
      d.amount = round(q * pu, decimals);
    } else if (q !== null && total !== null) {
      d.quantity = q;
      d.unitPrice = q !== 0 ? total / q : 0;
      d.amount = round(total, decimals);
    } else if (total !== null) {
      d.quantity = 1;
      d.unitPrice = total;
      d.amount = round(total, decimals);
      d.unit = d.unit || "gl";
      issue(row, { type: "INFO", category: "MISSING_FIELD", message: "Sin cantidad: se toma como 1 gl por el total" });
    } else {
      d.quantity = q ?? 0;
      d.unitPrice = pu ?? 0;
      d.amount = 0;
    }
    if (d.amount === 0 && !row.noCotiza) {
      issue(row, { type: "WARNING", category: "MISSING_FIELD", message: "Ítem sin precio (PU 0): se importa con monto 0" });
    }
    if (!d.unit) d.unit = "un";
    if (row.unitReview) {
      issue(row, {
        type: "INFO",
        category: "UNIT",
        field: "unit",
        message: `Unidad no estándar "${row.unit}"${row.unitSuggestion ? `; sugerida "${row.unitSuggestion}"` : ""}`,
      });
    }
  }

  const leafPaths = livePaths.filter((p) => drafts.get(p)!.kind === "ITEM");
  if (leafPaths.length === 0) {
    issue(null, { type: "CRITICAL", category: "HIERARCHY", message: "No se detectó ningún ítem con unidad, cantidad o precio" });
  }

  // 4. Suma por rubro (montos de la planilla, antes de recargos) para el cuadre.
  const sheetAmounts = new Map<string, number>();
  const rollup = (path: string): number => {
    const d = drafts.get(path)!;
    const value = d.kind === "ITEM" ? d.amount : d.children.reduce((s, c) => s + rollup(c), 0);
    sheetAmounts.set(path, value);
    return value;
  };
  const roots = livePaths.filter((p) => drafts.get(p)!.parentPath === null);
  const itemsTotal = round(roots.reduce((s, p) => s + rollup(p), 0), decimals);

  // 5. Recargos: se calculan sobre la base acumulada (ítems + recargos anteriores).
  const treatments = options.surchargeTreatments ?? {};
  const surcharges: SurchargeLine[] = [];
  let base = itemsTotal;
  for (const row of surchargeRows) {
    const amount = round(
      row.totalPrice ?? (row.surchargePercent !== null ? (base * row.surchargePercent) / 100 : 0),
      decimals
    );
    surcharges.push({
      rowId: row.id,
      description: row.description,
      percent: row.surchargePercent,
      amount,
      treatment: treatments[row.id] ?? defaultSurchargeTreatment(row.description),
    });
    base += amount;
  }
  const surchargesTotal = round(surcharges.reduce((s, x) => s + x.amount, 0), decimals);

  // 6. Distribuir recargos prorrateados en los ítems (el redondeo se ajusta en el ítem mayor).
  const distributed = surcharges.filter((s) => s.treatment === "DISTRIBUTE").reduce((s, x) => s + x.amount, 0);
  if (distributed !== 0 && itemsTotal > 0) {
    const factor = (itemsTotal + distributed) / itemsTotal;
    let assigned = 0;
    let biggest: Draft | null = null;
    for (const p of leafPaths) {
      const d = drafts.get(p)!;
      d.amount = round(d.amount * factor, decimals);
      d.unitPrice = d.unitPrice * factor;
      assigned += d.amount;
      if (!biggest || d.amount > biggest.amount) biggest = d;
    }
    const remainder = round(itemsTotal + distributed - assigned, decimals);
    if (biggest && remainder !== 0) biggest.amount = round(biggest.amount + remainder, decimals);
  }

  // 7. Nodos finales.
  const topName = (d: Draft): string => {
    let cur = d;
    while (cur.parentPath && drafts.get(cur.parentPath)) cur = drafts.get(cur.parentPath)!;
    return cur.kind === "ITEM" && cur.parentPath === null ? "GENERAL" : cur.row.description || cur.row.code;
  };
  const finalAmount = (path: string): number => {
    const d = drafts.get(path)!;
    return d.kind === "ITEM" ? d.amount : d.children.reduce((s, c) => s + finalAmount(c), 0);
  };
  const nodes: TreeNode[] = livePaths.map((path, idx) => {
    const d = drafts.get(path)!;
    if (d.kind === "RUBRO") counts.rubros++;
    else if (d.kind === "SUBRUBRO") counts.subrubros++;
    else counts.items++;
    return {
      rowId: d.row.id,
      kind: d.kind,
      level: d.level,
      code: d.row.code,
      name: d.row.description || d.row.code,
      unit: d.kind === "ITEM" ? d.unit : null,
      quantity: d.kind === "ITEM" ? d.quantity : 0,
      unitPrice: d.kind === "ITEM" ? d.unitPrice : 0,
      amount: round(finalAmount(path), decimals),
      path,
      parentPath: d.parentPath,
      topRubroName: topName(d),
      sheet: d.row.sheet,
      rowNumber: d.row.rowNumber,
      noCotiza: d.row.noCotiza,
      unitReview: d.row.unitReview,
      unitSuggestion: d.row.unitSuggestion,
      sortOrder: idx,
    };
  });
  surcharges
    .filter((s) => s.treatment === "AS_ITEM")
    .forEach((s, i) => {
      counts.items++;
      nodes.push({
        rowId: s.rowId,
        kind: "ITEM",
        level: 0,
        code: `REC-${i + 1}`,
        name: s.description,
        unit: "gl",
        quantity: 1,
        unitPrice: s.amount,
        amount: s.amount,
        path: `RECARGO/${slug(s.description) || i + 1}`,
        parentPath: null,
        topRubroName: "RECARGOS",
        sheet: rows.find((r) => r.id === s.rowId)?.sheet ?? "",
        rowNumber: rows.find((r) => r.id === s.rowId)?.rowNumber ?? 0,
        noCotiza: false,
        unitReview: false,
        unitSuggestion: null,
        sortOrder: nodes.length,
        fromSurcharge: true,
      });
    });

  // 8. Cuadre.
  const budgetTotal = round(nodes.filter((n) => n.kind === "ITEM").reduce((s, n) => s + n.amount, 0), decimals);
  const sheetComputedTotal = round(itemsTotal + surchargesTotal, decimals);
  const tolerance = Math.max(1, round(sheetComputedTotal * 0.0001, decimals));

  const rubroChecks: RubroCheck[] = [];
  for (const path of livePaths) {
    const d = drafts.get(path)!;
    // Un título con total 0 o vacío (ej. =F*D sin cantidad ni PU) no declara subtotal.
    if (d.kind === "ITEM" || !d.row.totalPrice || d.row.totalPrice <= 0) continue;
    const computed = round(sheetAmounts.get(path) ?? 0, decimals);
    rubroChecks.push({
      path,
      code: d.row.code,
      name: d.row.description,
      declared: d.row.totalPrice,
      computed,
      difference: round(computed - d.row.totalPrice, decimals),
    });
  }

  const grandRows = subtotalRows.filter((s) => s.row.isGrandTotal && (s.row.totalPrice ?? 0) > 0);
  let declaredGrandTotal: number | null = grandRows.length ? grandRows[grandRows.length - 1].row.totalPrice : null;
  for (const { row, openPaths } of subtotalRows) {
    if (row.isGrandTotal || !row.totalPrice || row.totalPrice <= 0) continue;
    const value = row.totalPrice;
    const matched = [...openPaths].reverse().find((p) => Math.abs((sheetAmounts.get(p) ?? NaN) - value) <= tolerance);
    const target = matched ?? openPaths[0];
    if (!target) {
      // Subtotal fuera de todo rubro (al pie): se usa como total declarado si no hay otro
      if (declaredGrandTotal === null) declaredGrandTotal = value;
      continue;
    }
    if (rubroChecks.some((c) => c.path === target)) continue;
    const d = drafts.get(target);
    if (!d) continue;
    const computed = round(sheetAmounts.get(target) ?? 0, decimals);
    rubroChecks.push({
      path: target,
      code: d.row.code,
      name: d.row.description,
      declared: value,
      computed,
      difference: round(computed - value, decimals),
    });
  }
  // Si la planilla trae el total antes y después de recargos, se toma el que mejor coincide.
  if (grandRows.length > 1) {
    const candidates = grandRows.map((g) => g.row.totalPrice as number);
    declaredGrandTotal = candidates.reduce((best, v) =>
      Math.abs(v - sheetComputedTotal) < Math.abs(best - sheetComputedTotal) ? v : best
    );
  }

  const declaredDifference =
    declaredGrandTotal === null ? null : round(sheetComputedTotal - declaredGrandTotal, decimals);
  const contractAmount = options.contractAmount && options.contractAmount > 0 ? options.contractAmount : null;
  const contractDifference = contractAmount === null ? null : round(sheetComputedTotal - contractAmount, decimals);

  const badChecks = rubroChecks.filter((c) => Math.abs(c.difference) > Math.max(1, Math.abs(c.declared) * 0.0005));
  for (const c of badChecks) {
    const d = drafts.get(c.path);
    issue(d?.row ?? null, {
      type: "WARNING",
      category: "RECONCILIATION",
      message: `"${c.name}": la planilla dice ${c.declared.toLocaleString("es-PY")} y los ítems suman ${c.computed.toLocaleString("es-PY")}`,
    });
  }

  // El monto del contrato es informativo: no participa del cuadre.
  const balanced =
    (declaredDifference === null || Math.abs(declaredDifference) <= tolerance) && badChecks.length === 0;

  const reconciliation: Reconciliation = {
    itemsTotal,
    surcharges,
    surchargesTotal,
    sheetComputedTotal,
    declaredGrandTotal,
    declaredDifference,
    budgetTotal,
    contractAmount,
    contractDifference,
    rubroChecks,
    tolerance,
    balanced,
  };

  return { nodes, reconciliation, issues, counts };
}
