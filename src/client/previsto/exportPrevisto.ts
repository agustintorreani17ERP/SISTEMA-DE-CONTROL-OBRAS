import * as XLSX from "xlsx-js-style";
import type { PrevistoEjecutadoData } from "../types";
import { buildPrevistoView, totalesGenerales } from "./previstoModel";

/**
 * Exporta la planilla Previsto vs Ejecutado a Excel. Saldos y cantidades reales son fórmulas
 * (contractual + Σ adendas, real − ejecutada, real − ejecutado en Gs.), así se pueden revisar.
 * Los rubros llevan sus montos calculados desde los ítems y el total general suma solo los ítems.
 */
export function exportPrevistoEjecutado(data: PrevistoEjecutadoData, projectCode: string, filtrada: boolean, visibles: ReturnType<typeof buildPrevistoView>) {
  const GS = "#,##0";
  const QTY = "#,##0.00";
  const PCT = "0.0%";
  const head = { font: { bold: true }, fill: { fgColor: { rgb: "E2E8F0" } }, alignment: { wrapText: true, vertical: "center" } };
  const bold = { font: { bold: true } };
  const cell = (v: any, fmt?: string, style?: object) => ({ v, t: typeof v === "number" || (v && typeof v === "object" && "f" in v) ? "n" : "s", ...(fmt ? { z: fmt } : {}), ...(style ? { s: style } : {}) });

  const adendas = data.adendas;
  const cabecera = [
    "Ítem", "Descripción", "Un.", "P.U. (sin IVA)", "Cant. contractual",
    ...adendas.map((a) => `Adenda N° ${a.numero} (Δ)`),
    "Cant. real", "Cant. ejecutada", "Saldo cant.", "% ejecutado",
    "Monto contractual", "Monto real", "Monto ejecutado", "Saldo Gs.",
  ];
  const nAdendas = adendas.length;
  const col = (i: number) => XLSX.utils.encode_col(i);
  const iContr = 4, iReal = 5 + nAdendas, iEjec = iReal + 1, iSaldoQ = iReal + 2, iPct = iReal + 3;
  const iMContr = iPct + 1, iMReal = iPct + 2, iMEjec = iPct + 3, iMSaldo = iPct + 4;
  const data2: any[][] = [[cell(`Previsto vs Ejecutado · al ${data.al}${filtrada ? " (filtrado)" : ""}`, undefined, bold)], [], cabecera.map((h) => cell(h, undefined, head))];
  const HEAD_ROW = 3; // encabezado en la fila 3 (1-based), congelado debajo

  visibles.forEach((v) => {
    const r = v.row;
    const excelRow = data2.length + 1;
    const indent = "  ".repeat(v.depth);
    const estilo = r.nodeKind === "ITEM" ? undefined : bold;
    if (r.nodeKind !== "ITEM") {
      data2.push([
        cell(r.code, undefined, estilo), cell(indent + r.name, undefined, estilo), cell("", undefined, estilo), cell("", undefined, estilo),
        ...Array.from({ length: nAdendas + 1 }, () => cell("", undefined, estilo)),
        cell("", undefined, estilo), cell("", undefined, estilo), cell("", undefined, estilo), cell("", undefined, estilo),
        cell(v.montos.contractAmount, GS, estilo), cell(v.montos.realAmount, GS, estilo), cell(v.montos.executedAmount, GS, estilo), cell(v.montos.saldoAmount, GS, estilo),
      ]);
      return;
    }
    const deltas = adendas.map((a, j) => cell(r.deltas[a.id] ?? 0, QTY));
    data2.push([
      cell(r.code), cell(indent + r.name + (r.isExtra ? ` · Extra · Adenda N° ${r.extraAdendaNumero}` : "")), cell(r.unit ?? ""),
      cell(r.unitPrice ?? 0, GS),
      cell(r.contractQty ?? 0, QTY),
      ...deltas,
      cell({ f: `${col(iContr)}${excelRow}+SUM(${col(5)}${excelRow}:${col(4 + nAdendas)}${excelRow})` }, QTY),
      cell(r.executedQty ?? 0, QTY),
      cell({ f: `${col(iReal)}${excelRow}-${col(iEjec)}${excelRow}` }, QTY),
      cell({ f: `IF(${col(iReal)}${excelRow}=0,"",${col(iEjec)}${excelRow}/${col(iReal)}${excelRow})` }, PCT),
      cell(r.contractAmount, GS),
      cell({ f: `${col(iMContr)}${excelRow}+(${col(iReal)}${excelRow}-${col(iContr)}${excelRow})*${col(3)}${excelRow}` }, GS),
      cell({ f: `${col(iEjec)}${excelRow}*${col(3)}${excelRow}` }, GS),
      cell({ f: `${col(iMReal)}${excelRow}-${col(iMEjec)}${excelRow}` }, GS),
    ]);
  });

  const t = totalesGenerales(visibles.map((v) => v.row));
  const totalStyle = { font: { bold: true }, border: { top: { style: "thin" } } };
  data2.push([
    cell("TOTAL GENERAL", undefined, totalStyle), cell("", undefined, totalStyle), cell("", undefined, totalStyle), cell("", undefined, totalStyle),
    ...Array.from({ length: nAdendas + 1 + 3 + 1 }, () => cell("", undefined, totalStyle)),
    cell(t.contractAmount, GS, totalStyle), cell(t.realAmount, GS, totalStyle), cell(t.executedAmount, GS, totalStyle), cell(t.saldoAmount, GS, totalStyle),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(data2);
  ws["!cols"] = [{ wch: 10 }, { wch: 56 }, { wch: 6 }, { wch: 14 }, { wch: 14 }, ...adendas.map(() => ({ wch: 14 })), { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  ws["!freeze"] = { xSplit: 2, ySplit: HEAD_ROW };
  (ws as any)["!views"] = [{ state: "frozen", xSplit: 2, ySplit: HEAD_ROW }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Previsto vs Ejecutado");
  XLSX.writeFile(wb, `${projectCode}_Previsto_vs_Ejecutado_${data.al}.xlsx`);
}
