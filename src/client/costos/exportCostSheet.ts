import * as XLSX from "xlsx-js-style";
import type { Project } from "../types";
import type { SheetRow } from "./sheetModel";

/**
 * Exporta la planilla técnica a Excel con el mismo formato que la pantalla:
 * sangría por nivel, rubros en negrita con fondo gris, subtotales y saldos como fórmulas,
 * formatos de número (#,##0 Gs. / #,##0.00 cantidades / 0,0 % avance) y TOTAL GENERAL.
 */
export function exportCostSheet(rows: SheetRow[], project: Project, filtered: boolean) {
  const header = [
    "Ítem",
    "Descripción",
    "Un.",
    "Cant. prevista",
    "Cant. ejecutada",
    "Saldo cant.",
    "% avance físico",
    "P.U. (Gs.)",
    "Total previsto (Gs.)",
    "Total ejecutado (Gs.)",
    "Saldo (Gs.)",
  ];
  const HEAD_ROW = 4; // filas 1-3: título; 4: encabezado; datos desde la 5
  const first = HEAD_ROW + 1;
  const excelRow = (i: number) => first + i;

  // Hijos directos de cada fila (en orden visual), para armar los SUM de subtotales
  const childRows = new Map<number, number[]>();
  const stack: { depth: number; index: number }[] = [];
  rows.forEach((r, i) => {
    while (stack.length && stack[stack.length - 1].depth >= r.depth) stack.pop();
    if (stack.length) {
      const parent = stack[stack.length - 1].index;
      childRows.set(parent, [...(childRows.get(parent) ?? []), i]);
    }
    stack.push({ depth: r.depth, index: i });
  });

  const GS = "#,##0";
  const QTY = "#,##0.00";
  const PCT = "0.0%";
  const border = { bottom: { style: "thin", color: { rgb: "E2E8F0" } } };
  const cell = (v: unknown, z?: string, extra: Record<string, unknown> = {}) => {
    const base: any = typeof v === "object" && v !== null && "f" in (v as object) ? { ...(v as object), t: "n" } : { v, t: typeof v === "number" ? "n" : "s" };
    if (z) base.z = z;
    base.s = { border, ...extra };
    return base;
  };

  const data: any[][] = [
    [cell(`Centro de Costos — ${project.code} · ${project.name}`, undefined, { font: { bold: true, sz: 14 } })],
    [cell(`Exportado ${new Date().toLocaleDateString("es-PY")}${filtered ? " · con filtros aplicados" : ""}`, undefined, { font: { color: { rgb: "64748B" } } })],
    [],
    header.map((h) => cell(h, undefined, { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E293B" } }, alignment: { horizontal: "center", wrapText: true } })),
  ];

  rows.forEach((r, i) => {
    const R = excelRow(i);
    const rubro = r.node.nodeKind === "RUBRO";
    const style = rubro ? { font: { bold: true }, fill: { fgColor: { rgb: "F1F5F9" } } } : r.exceeded ? { fill: { fgColor: { rgb: "FFF1F2" } } } : {};
    const kids = childRows.get(i);
    const sumOf = (col: string) => (kids?.length ? { f: kids.map((k) => `${col}${excelRow(k)}`).join("+") } : 0);
    data.push([
      cell(r.node.code, undefined, style),
      cell(r.node.name, undefined, { ...style, alignment: { indent: r.depth } }),
      cell(r.isItem ? r.node.unit ?? "" : "", undefined, style),
      cell(r.isItem ? r.plannedQty ?? 0 : "", QTY, style),
      cell(r.isItem ? r.executedQty ?? 0 : "", QTY, style),
      cell(r.isItem ? { f: `D${R}-E${R}` } : "", QTY, style),
      cell(r.isItem ? { f: `IF(D${R}=0,"",E${R}/D${R})` } : { f: `IF(I${R}=0,"",J${R}/I${R})` }, PCT, style),
      cell(r.isItem ? r.unitPrice ?? 0 : "", GS, style),
      cell(r.isItem ? r.plannedTotal : sumOf("I"), GS, style),
      cell(r.isItem ? r.executedTotal : sumOf("J"), GS, style),
      cell({ f: `I${R}-J${R}` }, GS, style),
    ]);
  });

  const roots = rows.map((r, i) => (r.depth === 0 ? excelRow(i) : null)).filter((x): x is number => x !== null);
  const T = excelRow(rows.length);
  const totalStyle = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E293B" } } };
  const sumRoots = (col: string) => (roots.length ? { f: roots.map((r) => `${col}${r}`).join("+") } : 0);
  data.push([
    cell("", undefined, totalStyle),
    cell(filtered ? "TOTAL (filtrado)" : "TOTAL GENERAL", undefined, totalStyle),
    ...Array.from({ length: 4 }, () => cell("", undefined, totalStyle)),
    cell({ f: `IF(I${T}=0,"",J${T}/I${T})` }, PCT, totalStyle),
    cell("", undefined, totalStyle),
    cell(sumRoots("I"), GS, totalStyle),
    cell(sumRoots("J"), GS, totalStyle),
    cell({ f: `I${T}-J${T}` }, GS, totalStyle),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 10 }, { wch: 60 }, { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  ws["!freeze"] = { xSplit: 2, ySplit: HEAD_ROW };
  (ws as any)["!views"] = [{ state: "frozen", xSplit: 2, ySplit: HEAD_ROW }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Centro de Costos");
  XLSX.writeFile(wb, `${project.code}_Centro_de_Costos.xlsx`);
}
