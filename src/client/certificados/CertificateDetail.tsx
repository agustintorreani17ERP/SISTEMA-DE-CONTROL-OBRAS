import React, { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { CheckCircle2, Download, FileSpreadsheet, Info, Printer, XCircle } from "lucide-react";
import { api } from "../api";
import { CertificateSummaryData, Project } from "../types";
import { Badge, Button, Card, cx, inputClass, Modal, pct } from "../ui";
import { auxFormula } from "../../modules/certifications/certMath";
import { formatMoney } from "../utils/format";
import { CERT_STATUS, destinoLabel, periodLabel } from "./status";
import { agruparPorFrente } from "./porFrente";

import { formatQty } from "../utils/numbers";
interface CertificateDetailProps {
  certificationId: number;
  project: Project;
  currency: "PYG" | "USD";
  onClose: () => void;
  onChanged: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

const qty = (v: number) => formatQty(v);

/** Certificado con el formato de la skill: Medición (N) + Cert (N), verificación final y exportación. */
export function CertificateDetail({ certificationId, project, currency, onClose, onChanged, showToast }: CertificateDetailProps) {
  const [data, setData] = useState<CertificateSummaryData | null>(null);
  const [retention, setRetention] = useState("");
  const [busy, setBusy] = useState(false);
  /** Subcontratista: "CONTRATISTA" = lo que se le entrega; "INTERNA" agrega el rubro presupuestario. */
  const [vista, setVista] = useState<"CONTRATISTA" | "INTERNA">("CONTRATISTA");
  const money = (v: number) => formatMoney(v, currency);

  const load = useCallback(async () => {
    try {
      const d = await api.getCertificateSummary(certificationId);
      setData(d);
      setRetention(String(d.summary.retentionPct || ""));
    } catch (err: any) {
      showToast(err.message || "No se pudo cargar el certificado", "error");
    }
  }, [certificationId, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <Modal title="Certificado" onClose={onClose} size="lg">
        <p className="text-sm text-slate-400">Cargando…</p>
      </Modal>
    );
  }

  const { certification: cert, summary: s, checks } = data;
  const n = String(cert.numero).padStart(2, "0");
  const status = CERT_STATUS[cert.estado];
  const editable = cert.estado !== "APROBADO";
  const esSub = Boolean(cert.partnerId);
  const interna = vista === "INTERNA";

  /** Planilla del subcontratista agrupada por frente (pantalla, Excel e impresión). */
  const grupos = agruparPorFrente(
    s.rows.map((r, idx) => {
      const it = cert.items[idx];
      return {
        ...r,
        monto: r.periodAmount,
        rubro: it?.budgetItem ? `${it.budgetItem.code} · ${it.budgetItem.name}` : null,
        frente: it?.planillaLinea?.workFront ?? null,
      };
    }),
    (f) => f.frente,
    (f) => f.code
  ).map((g) => ({ ...g, subtotal: g.rows.reduce((a, f) => a + f.monto, 0) }));
  const sinAsignar = grupos.reduce((a, g) => a + g.rows.filter((f) => !f.rubro).length, 0);
  const subHead = ["N°", "Rubro de MO", "Unidad", "Anterior", "Presente", "Acumulado", "PU", "Monto", ...(interna ? ["Rubro presupuestario"] : [])];

  const act = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true);
    try {
      const res = await fn();
      showToast(msg);
      res?.budgetWarnings?.forEach((w: { message: string }) => showToast(`Presupuesto: ${w.message}`, "info"));
      res?.measurementWarnings?.forEach((w: string) => showToast(`Pendiente de certificar al cliente: ${w}`, "info"));
      res?.priceWarnings?.forEach((w: string) => showToast(`Precio: ${w}`, "error"));
      res?.avisos?.forEach((a: string) => showToast(a, "info"));
      if (res?.message) showToast(res.message, "info");
      await load();
      onChanged();
    } catch (err: any) {
      showToast(err.message || "No se pudo completar la acción", "error");
    } finally {
      setBusy(false);
    }
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    // Cómputo: fórmulas visibles (piezas × L × A × H; descuentos en negativo)
    const comp: any[][] = [["Ítem", "Sector", "Piezas", "Largo", "Ancho", "Alto", "Descuento", "Subtotal", "Fórmula"]];
    cert.items.forEach((it) =>
      (it.auxiliaryCalculations ?? []).forEach((a) => {
        const r = comp.length + 1;
        comp.push([
          it.planillaLinea?.numero ?? it.budgetItem?.code,
          a.location || a.descripcion,
          Number(a.factor_repeticion),
          Number(a.largo) || "",
          Number(a.ancho) || "",
          Number(a.alto) || "",
          a.isDeduction ? "SÍ" : "",
          { f: `IF(G${r}="SÍ",-1,1)*C${r}*IF(D${r}="",1,D${r})*IF(E${r}="",1,E${r})*IF(F${r}="",1,F${r})` },
          auxFormula({ ...a, largo: Number(a.largo), ancho: Number(a.ancho), alto: Number(a.alto), factor_repeticion: Number(a.factor_repeticion) }),
        ]);
      })
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(comp), `Computo (${n})`);

    if (esSub) {
      const cer: any[][] = [
        [`${project.name} — ${cert.partner?.name ?? ""}`],
        [`Certificado N° ${n} · ${periodLabel(cert)}${interna ? " · vista interna" : ""}`],
        [],
        subHead,
      ];
      const subtotales: number[] = [];
      grupos.forEach((g) => {
        cer.push([g.label]);
        const desde = cer.length + 1;
        g.rows.forEach((f) => {
          const i = cer.length + 1;
          cer.push([f.code, f.name, f.unit, f.previousQuantity, f.periodQuantity, { f: `D${i}+E${i}` }, f.unitPrice, { f: `ROUND(E${i}*G${i},0)` }, ...(interna ? [f.rubro ?? "SIN ASIGNAR"] : [])]);
        });
        cer.push(["", `Subtotal ${g.label}`, "", "", "", "", "", { f: `SUM(H${desde}:H${cer.length})` }]);
        subtotales.push(cer.length);
        cer.push([]);
      });
      const t = cer.length + 1;
      cer.push(["", "Total", "", "", "", "", "", { f: subtotales.length ? subtotales.map((r) => `H${r}`).join("+") : "0" }]);
      cer.push(["", `Fondo de reparo ${s.retentionPct}%`, "", "", "", "", "", { f: `ROUND(H${t}*${s.retentionPct}/100,0)` }]);
      cer.push(["", "Neto a pagar", "", "", "", "", "", { f: `H${t}-H${t + 1}` }]);
      const ws = XLSX.utils.aoa_to_sheet(cer);
      ws["!cols"] = [{ wch: 8 }, { wch: 48 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, ...(interna ? [{ wch: 48 }] : [])];
      XLSX.utils.book_append_sheet(wb, ws, `Cert (${n})`);
      XLSX.writeFile(wb, `${project.code}_${(cert.partner?.name ?? "sub").replace(/[^\w]+/g, "_")}_Cert_${n}${interna ? "_interna" : ""}.xlsx`);
      return;
    }

    const med: any[][] = [["Ítem", "Descripción", "Unidad", "Contratado", "Acumulado anterior", "Período", "Acumulado actual", "% avance"]];
    s.rows.forEach((r) => {
      const i = med.length + 1;
      med.push([r.code, r.name, r.unit, r.contractedQuantity, r.previousQuantity, r.periodQuantity, { f: `E${i}+F${i}` }, { f: `IF(D${i}=0,0,G${i}/D${i})` }]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(med), `Medicion (${n})`);

    const cer: any[][] = [["Ítem", "Descripción", "Precio unitario", "Monto contractual", "Acumulado anterior", "Este certificado", "Acumulado actual", "Saldo"]];
    s.rows.forEach((r, idx) => {
      const i = cer.length + 1;
      const m = idx + 2;
      cer.push([
        r.code,
        r.name,
        r.unitPrice,
        { f: `ROUND('Medicion (${n})'!D${m}*C${i},0)` },
        { f: `ROUND('Medicion (${n})'!E${m}*C${i},0)` },
        { f: `ROUND('Medicion (${n})'!F${m}*C${i},0)` },
        { f: `E${i}+F${i}` },
        { f: `D${i}-G${i}` },
      ]);
    });
    const last = cer.length;
    cer.push([], ["", "Total este certificado", "", "", "", { f: `SUM(F2:F${last})` }]);
    cer.push(["", `Fondo de reparo ${s.retentionPct}%`, "", "", "", { f: `ROUND(F${last + 2}*${s.retentionPct}/100,0)` }]);
    cer.push(["", "Neto a pagar", "", "", "", { f: `F${last + 2}-F${last + 3}` }]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cer), `Cert (${n})`);

    const who = cert.partner?.name ?? "Avance de obra";
    XLSX.writeFile(wb, `${project.code}_${who.replace(/[^\w]+/g, "_")}_Cert_${n}.xlsx`);
  };

  const exportCsv = () => {
    const header = ["obra", "subcontratista", "cert_nro", "periodo", "item_codigo", "descripcion", "unidad", "cantidad_periodo", "precio_unitario", "monto"];
    const period = periodLabel(cert);
    const lines = s.rows.map((r) =>
      [project.code, cert.partner?.name ?? "", cert.numero, period, r.code, r.name, r.unit, r.periodQuantity, r.unitPrice, r.periodAmount]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(";")
    );
    const blob = new Blob(["﻿" + [header.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.code}_Cert_${n}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /** Impresión del certificado del subcontratista: planilla por frente en una ventana aparte. */
  const imprimir = () => {
    const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const extra = interna ? "<td></td>" : "";
    const q = (v: number) => `<td class="r">${esc(qty(v))}</td>`;
    const gs = (v: number) => `<td class="r">${esc(money(v))}</td>`;
    const body = grupos
      .map(
        (g) =>
          `<tr class="g"><td colspan="${subHead.length}">${esc(g.label)}</td></tr>` +
          g.rows
            .map(
              (f) =>
                `<tr><td>${esc(f.code)}</td><td>${esc(f.name)}</td><td>${esc(f.unit)}</td>${q(f.previousQuantity)}${q(f.periodQuantity)}${q(f.accumulatedQuantity)}${gs(f.unitPrice)}${gs(f.monto)}${
                  interna ? `<td${f.rubro ? "" : ' class="a"'}>${esc(f.rubro ?? "Sin asignar")}</td>` : ""
                }</tr>`
            )
            .join("") +
          `<tr class="s"><td colspan="7">Subtotal ${esc(g.label)}</td>${gs(g.subtotal)}${extra}</tr>`
      )
      .join("");
    const pie = (label: string, v: string) => `<tr class="s"><td colspan="7">${esc(label)}</td><td class="r">${esc(v)}</td>${extra}</tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Cert ${n} ${esc(cert.partner?.name)}</title><style>
@page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#000}h1{font-size:15px;margin:0}p{margin:2px 0 10px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:3px 5px;text-align:left}.r{text-align:right;white-space:nowrap}
tr.g td{font-weight:bold;padding-top:8px}tr.s td{font-weight:bold}tr.s td:first-child{text-align:right}.a{color:#c00;font-weight:bold}
</style></head><body><h1>${esc(project.name)} — Certificado N° ${n}</h1>
<p>Subcontratista: ${esc(cert.partner?.name)} · ${esc(periodLabel(cert))}${cert.contract ? ` · Contrato ${esc(cert.contract.number)}` : ""}${interna ? " · Vista interna" : ""}</p>
<table><thead><tr>${subHead.map((h, i) => `<th${i >= 3 && i <= 7 ? ' class="r"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${body}
${pie("Total", money(s.periodAmount))}${pie(`Fondo de reparo ${s.retentionPct}%`, `− ${money(s.retentionAmount)}`)}${pie("Neto a pagar", money(s.netAmount))}
</tbody></table></body></html>`;
    const w = window.open("", "_blank");
    if (!w) return showToast("El navegador bloqueó la ventana de impresión", "error");
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  /** `informativo`: si no se cumple es un aviso (texto negro), no una alerta. */
  const check = (ok: boolean, label: string, informativo = false) => (
    <li className={cx("flex items-center gap-2", ok ? "text-emerald-700" : informativo ? "text-slate-900" : "text-rose-700")}>
      {ok ? <CheckCircle2 className="h-4 w-4" /> : informativo ? <Info className="h-4 w-4" /> : <XCircle className="h-4 w-4" />} {label}
    </li>
  );

  return (
    <Modal
      title={`${cert.estado === "MEDICION_BORRADOR" ? "Medición" : "Certificado"} N° ${n} · ${destinoLabel(cert)}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button icon={<FileSpreadsheet className="h-4 w-4" />} onClick={exportExcel}>
            Excel
          </Button>
          {esSub && (
            <Button icon={<Printer className="h-4 w-4" />} onClick={imprimir}>
              Imprimir
            </Button>
          )}
          <Button icon={<Download className="h-4 w-4" />} onClick={exportCsv}>
            CSV para ERP
          </Button>
          {cert.estado === "MEDICION_BORRADOR" && (
            <Button variant="primary" disabled={busy} onClick={() => act(() => api.closeCertificationMeasurement(cert.id), "Borrador de certificado creado")}>
              Crear borrador de certificado
            </Button>
          )}
          {cert.estado === "CERTIFICADO_BORRADOR" && (
            <Button
              variant="primary"
              disabled={busy || checks.pendingReview > 0}
              title={checks.pendingReview ? "Hay líneas marcadas [?] pendientes de revisión" : undefined}
              onClick={() => window.confirm("¿Aprobar el certificado? Se descuenta del presupuesto y ya no se puede modificar.") && act(() => api.approveCertification(cert.id), "Certificado aprobado")}
            >
              Aprobar
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <Badge tone={status.tone}>{status.label}</Badge>
        <span>{periodLabel(cert)}</span>
        {cert.contract && <span>· Contrato {cert.contract.number}</span>}
      </div>

      {esSub && (
        <Card
          title={`Cert (${n}) · planilla por frente`}
          padded={false}
          action={
            <div className="flex gap-1 text-xs">
              {(["CONTRATISTA", "INTERNA"] as const).map((v) => (
                <button key={v} onClick={() => setVista(v)} className={cx("rounded-md border px-2 py-1", vista === v ? "border-slate-900 font-semibold" : "border-slate-200")}>
                  {v === "CONTRATISTA" ? "Contratista" : "Interna"}
                </button>
              ))}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm text-slate-900">
              <thead className="text-left text-xs">
                <tr className="border-b border-slate-900">
                  {subHead.map((h, i) => (
                    <th key={h} className={cx("px-3 py-2", i >= 3 && i <= 7 && "text-right")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              {grupos.map((g) => (
                <tbody key={g.key}>
                  <tr>
                    <td colSpan={subHead.length} className="px-3 pb-1 pt-3 font-semibold">
                      {g.label}
                    </td>
                  </tr>
                  {g.rows.map((f, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-3 py-1.5 tabular-nums">{f.code}</td>
                      <td className="px-3 py-1.5">{f.name}</td>
                      <td className="px-3 py-1.5">{f.unit}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{qty(f.previousQuantity)}</td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">{qty(f.periodQuantity)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{qty(f.accumulatedQuantity)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{money(f.unitPrice)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{money(f.monto)}</td>
                      {interna && <td className={cx("px-3 py-1.5 text-xs", !f.rubro && "font-semibold text-red-600")}>{f.rubro ?? "Sin asignar"}</td>}
                    </tr>
                  ))}
                  <tr className="border-b border-slate-900 font-semibold">
                    <td colSpan={7} className="px-3 py-1.5 text-right">
                      Subtotal {g.label}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{money(g.subtotal)}</td>
                    {interna && <td />}
                  </tr>
                </tbody>
              ))}
              <tfoot className="font-semibold">
                {[
                  ["Total", money(s.periodAmount)],
                  [`Fondo de reparo ${s.retentionPct}%`, `− ${money(s.retentionAmount)}`],
                  ["Neto a pagar", money(s.netAmount)],
                ].map(([l, v]) => (
                  <tr key={l}>
                    <td colSpan={7} className="px-3 py-1.5 text-right">
                      {l}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{v}</td>
                    {interna && <td />}
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
          {interna && sinAsignar > 0 && <p className="px-4 py-2 text-xs font-semibold text-red-600">{sinAsignar} línea(s) sin rubro presupuestario: asignalas antes de aprobar.</p>}
        </Card>
      )}

      {!esSub && (
      <Card title={`Medición (${n})`} padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-4 py-2">Ítem</th>
                <th className="px-3 py-2 text-right">Contratado</th>
                <th className="px-3 py-2 text-right">Anterior</th>
                <th className="px-3 py-2 text-right">Período</th>
                <th className="px-3 py-2 text-right">Acumulado</th>
                <th className="px-3 py-2 text-right">Avance</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.code + r.name} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2">
                    <p className="text-slate-800">
                      {r.code} · {r.name}
                    </p>
                    <p className="text-xs text-slate-400">{r.unit}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(r.contractedQuantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(r.previousQuantity)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{qty(r.periodQuantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(r.accumulatedQuantity)}</td>
                  <td className={cx("px-3 py-2 text-right tabular-nums", r.overContract && "font-semibold text-rose-600")}>{pct(r.progress)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      )}

      <Card title={esSub ? "Resumen y fondo de reparo" : `Cert (${n})`}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {[
            ["Monto contractual", s.contractAmount],
            ["Acumulado anterior", s.previousAmount],
            ["Este certificado", s.periodAmount],
            ["Acumulado actual", s.accumulatedAmount],
            ["Saldo", s.balance],
          ].map(([label, value]) => (
            <div key={label as string} className="flex justify-between border-b border-slate-100 py-1.5">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium tabular-nums">{money(value as number)}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5">
            <dt className="text-slate-500">Fondo de reparo</dt>
            <dd className="flex items-center gap-2">
              {editable ? (
                <>
                  <input type="number" min={0} max={30} step="0.5" value={retention} onChange={(e) => setRetention(e.target.value)} className={`${inputClass} w-20 py-1 text-right`} />
                  <span className="text-slate-500">%</span>
                  <Button size="sm" disabled={busy || Number(retention || 0) === s.retentionPct} onClick={() => act(() => api.setCertificateRetention(cert.id, Number(retention || 0)), "Fondo de reparo aplicado")}>
                    Aplicar
                  </Button>
                </>
              ) : (
                <span>{s.retentionPct}%</span>
              )}
              <span className="font-medium tabular-nums">− {money(s.retentionAmount)}</span>
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-900 px-4 py-3 text-slate-900">
          <span className="text-sm">Neto a pagar</span>
          <span className="text-lg font-semibold tabular-nums">{money(s.netAmount)}</span>
        </div>
      </Card>

      <Card title="Verificación final">
        <ul className="space-y-1.5 text-sm">
          {check(checks.measurementMatchesCertificate, "La suma de la medición es igual al total del certificado")}
          {check(checks.previousMatchesHistory, "Los acumulados coinciden con los certificados anteriores")}
          {check(checks.noPendingReview, checks.noPendingReview ? "No quedan cantidades pendientes de revisión" : `${checks.pendingReview} línea(s) del cómputo marcadas [?]`)}
          {check(checks.overContract.length === 0, checks.overContract.length ? `Superan lo contratado: ${checks.overContract.join(", ")}` : "Ningún ítem supera lo contratado")}
          {cert.partnerId && (
            <>
              {check(
                !checks.sinRubro?.length,
                checks.sinRubro?.length ? `Líneas sin rubro presupuestario (no se puede aprobar): N° ${checks.sinRubro.join(", ")}` : "Todas las líneas tienen rubro presupuestario"
              )}
              {check(!checks.priceWarnings?.length, checks.priceWarnings?.length ? "Precios distintos del sugerido (lista de MO):" : "Todos los precios son los sugeridos de la lista de MO")}
              {checks.priceWarnings?.map((w) => (
                <li key={w} className="pl-6 text-red-600">
                  {w}
                </li>
              ))}
              {editable &&
                checks.controlMedicionSub !== "NO_CONTROLAR" &&
                check(
                  !checks.overMeasured?.length,
                  checks.overMeasured?.length
                    ? checks.controlMedicionSub === "BLOQUEAR"
                      ? "Supera la medición oficial: no se puede certificar hasta medirlo al cliente:"
                      : "Pendiente de certificar al cliente:"
                    : "No supera la medición oficial acumulada",
                  checks.controlMedicionSub !== "BLOQUEAR"
                )}
              {editable &&
                checks.controlMedicionSub !== "NO_CONTROLAR" &&
                checks.overMeasured?.map((w) => (
                  <li key={w} className={checks.controlMedicionSub === "BLOQUEAR" ? "pl-6 text-red-600" : "pl-6 text-slate-900"}>
                    {w}
                  </li>
                ))}
            </>
          )}
        </ul>
      </Card>

      {cert.partnerId && (
        <Card title="Precios de mano de obra">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold">
                <th className="py-1.5">Ítem</th>
                <th className="py-1.5 text-right">Precio usado</th>
                <th className="py-1.5 text-right">Sugerido</th>
                <th className="py-1.5 pl-3">Origen</th>
              </tr>
            </thead>
            <tbody>
              {cert.items.map((i) => {
                const usado = Number(i.precioUnitario);
                const sug = i.precioSugerido === null || i.precioSugerido === undefined ? null : Number(i.precioSugerido);
                const distinto = sug === null || (sug > 0 ? Math.abs(usado / sug - 1) > 0.005 : usado !== 0);
                return (
                  <tr key={i.id} className="border-b border-slate-100">
                    <td className="py-1.5">
                      {i.planillaLinea ? (
                        <>
                          {i.planillaLinea.numero} · {i.planillaLinea.laborPrice?.description}
                          <span className="block text-xs">{i.budgetItem ? `Rubro ${i.budgetItem.code} · ${i.budgetItem.name}` : <span className="text-red-600">Sin rubro presupuestario</span>}</span>
                        </>
                      ) : (
                        <>
                          {i.budgetItem?.code} · {i.budgetItem?.name}
                        </>
                      )}
                    </td>
                    <td className={cx("py-1.5 text-right tabular-nums", distinto && "font-semibold text-red-600")}>{money(usado)}</td>
                    <td className="py-1.5 text-right tabular-nums">{sug === null ? "—" : money(sug)}</td>
                    <td className="py-1.5 pl-3 text-xs">{i.precioFuente === "LISTA_OBRA" ? "Lista de MO de la obra" : i.precioFuente === "ACU_MO" ? "MO del ACU" : "Sin referencia"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {cert.items.some((i) => (i.photos ?? []).length) && (
        <Card title="Fotos de la medición">
          <div className="flex flex-wrap gap-2">
            {cert.items.flatMap((i) =>
              (i.photos ?? []).map((p) => (
                <a key={p.url} href={p.url} target="_blank" rel="noreferrer" title={i.budgetItem?.name}>
                  <img src={p.url} alt={p.comentario ?? ""} className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200" />
                </a>
              ))
            )}
          </div>
        </Card>
      )}
    </Modal>
  );
}
