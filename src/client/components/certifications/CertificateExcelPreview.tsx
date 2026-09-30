import React, { useState } from "react";
import * as XLSX from "xlsx";
import {
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  Lock,
  ArrowLeft,
  FileText,
  Building2,
  Calendar,
  AlertCircle,
  ExternalLink,
  DollarSign,
  Camera,
  Layers,
  Download,
} from "lucide-react";
import { Certification, ItemPhoto, AuxiliaryCalculation } from "../../types";
import { api } from "../../api";
import { ItemPhotoModal } from "./ItemPhotoModal";
import { StatusSteps, statusStepIndex } from "./MeasurementForm";
import { NumCell } from "./sheetGrid";

import { formatGs, formatQty } from "../../utils/numbers";
interface CertificateExcelPreviewProps {
  certification: Certification;
  onBack: () => void;
  onRefresh: () => void;
  onNavigateToInvoice?: (invoiceId: number) => void;
}

export const CertificateExcelPreview: React.FC<CertificateExcelPreviewProps> = ({
  certification,
  onBack,
  onRefresh,
  onNavigateToInvoice,
}) => {
  const [approving, setApproving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [activePhotoModalItem, setActivePhotoModalItem] = useState<{
    code: string;
    name: string;
    photos: ItemPhoto[];
  } | null>(null);
  const [expandedAuxItemId, setExpandedAuxItemId] = useState<number | null>(null);

  // Cálculos consolidados
  const totalMontoAnterior = certification.items.reduce((sum, it) => {
    const pu = Number(it.precioUnitario || 0);
    const ant = Number(it.cantidadAnterior || 0);
    return sum + Math.round(ant * pu);
  }, 0);

  const totalMontoPresente = certification.items.reduce((sum, it) => {
    const pu = Number(it.precioUnitario || 0);
    const pres = Number(it.cantidadPresente || 0);
    return sum + Math.round(pres * pu);
  }, 0);

  const totalMontoAcumulado = totalMontoAnterior + totalMontoPresente;

  // Filas de presentación (monto contractual y saldo por ítem)
  const rows = certification.items.map((item, idx) => {
    const pu = Number(item.precioUnitario || 0);
    const cantAnt = Number(item.cantidadAnterior || 0);
    const cantPres = Number(item.cantidadPresente || 0);
    const cantContrato = Number(item.budgetItem?.totalQuantity || 0);
    const montoAnt = Math.round(cantAnt * pu);
    const montoPres = Math.round(cantPres * pu);
    const montoTot = montoAnt + montoPres;
    const contractual = Math.round(cantContrato * pu);
    return {
      item,
      code: item.budgetItem?.code || String(idx + 1),
      name: item.budgetItem?.name || "Rubro presupuestario",
      unit: item.budgetItem?.unit || "un",
      pu,
      cantAnt,
      cantPres,
      cantContrato,
      montoAnt,
      montoPres,
      montoTot,
      contractual,
      saldo: contractual - montoTot,
    };
  });
  const totalContractual = rows.reduce((s, r) => s + r.contractual, 0);

  // Pie del certificado
  const hasStoredRetention = certification.retentionAmount != null && Number(certification.retentionAmount) > 0;
  const [reparoPct, setReparoPct] = useState<number>(Number(certification.retentionPct || 0));
  const [anticipo, setAnticipo] = useState<number>(0);
  const [materiales, setMateriales] = useState<number>(0);
  const fondoReparo = hasStoredRetention
    ? Math.round(Number(certification.retentionAmount))
    : Math.round((totalMontoPresente * reparoPct) / 100);
  const netoAPagar = totalMontoPresente - fondoReparo - anticipo - materiales;

  const isApproved = certification.estado === "APROBADO";
  const isBorradorCertificado = certification.estado === "CERTIFICADO_BORRADOR";
  const isBorradorMedicion = certification.estado === "MEDICION_BORRADOR";

  // Factura vinculada
  const linkedInvoice = certification.invoices && certification.invoices.length > 0
    ? certification.invoices[0]
    : null;

  // Manejo de Cierre de Medición
  const handleCloseMeasurement = async () => {
    if (!window.confirm("¿Confirma cerrar la medición de campo? Esto bloqueará el ingreso de cantidades físicas y generará la planilla financiera del certificado.")) {
      return;
    }
    setClosing(true);
    try {
      await api.closeCertificationMeasurement(certification.id);
      onRefresh();
    } catch (err: any) {
      alert("Error al cerrar medición: " + err.message);
    } finally {
      setClosing(false);
    }
  };

  // Manejo de Aprobación y Facturación Automática (Three-Way Match)
  const handleApprove = async () => {
    const msg = certification.partnerId
      ? `¿Aprobar Certificado N° ${certification.numero} de Subcontratista?\n\nAcción Contable: Se creará automáticamente una Factura Fiscal RECIBIDA (Cuentas por Pagar) con Three-Way Match 100% validado por ${formatGs(totalMontoPresente)} Gs.`
      : `¿Aprobar Certificado N° ${certification.numero} de Obra al Cliente?\n\nAcción Contable: Se creará automáticamente una Factura Fiscal EMITIDA (Cuentas por Cobrar) por ${formatGs(totalMontoPresente)} Gs.`;

    if (!window.confirm(msg)) return;

    setApproving(true);
    try {
      const res = await api.approveCertification(certification.id);
      alert(
        `✅ Certificado N° ${certification.numero} APROBADO EXITOSAMENTE.\n\nFactura generada: ${res.invoice?.numeroFactura || "Fiscal"}\nMonto: ${formatGs(Number(res.invoice?.total || totalMontoPresente))} Gs.\nThree-Way Match: 100% Aprobado.${
          res.budgetWarnings?.length
            ? `\n\n⚠ Avisos de presupuesto:\n${res.budgetWarnings.map((w) => "• " + w.message).join("\n")}`
            : ""
        }${
          res.measurementWarnings?.length
            ? `\n\n⚠ Supera la medición oficial:\n${res.measurementWarnings.map((w) => "• " + w).join("\n")}`
            : ""
        }`
      );
      onRefresh();
    } catch (err: any) {
      alert("Error al aprobar certificación: " + err.message);
    } finally {
      setApproving(false);
    }
  };

  // Exportar a Excel con fórmulas de ingeniería
  const handleExportToExcel = () => {
    const wb = XLSX.utils.book_new();

    // Encabezado del Certificado
    const titleRows = [
      ["PLANILLA DE MEDICIÓN Y CERTIFICACIÓN DE OBRA"],
      [`Obra: ${certification.project?.name || ""} (${certification.project?.code || ""})`],
      [
        certification.partner
          ? `Subcontratista: ${certification.partner.name} (RUC: ${certification.partner.taxId})`
          : `Comitente / Cliente: ${certification.project?.clientName || "—"}`,
      ],
      [
        `Certificado / Medición N°: ${certification.numero}`,
        `Fecha de Corte: ${new Date(certification.fecha).toLocaleDateString("es-PY")}`,
        `Estado: ${certification.estado}`,
      ],
      [],
      [
        "ÍTEM",
        "DESCRIPCIÓN DEL RUBRO",
        "UNIDAD",
        "PRECIO UNITARIO (Gs.)",
        "CANT. ANTERIOR",
        "CANT. PRESENTE",
        "CANT. ACUMULADA",
        "MONTO ANTERIOR (Gs.)",
        "MONTO PRESENTE (Gs.)",
        "MONTO TOTAL (Gs.)",
      ],
    ];

    const dataRows = certification.items.map((it, idx) => {
      const rowNum = 7 + idx; // Fila en Excel
      const code = it.budgetItem?.code || String(idx + 1);
      const name = it.budgetItem?.name || "Rubro";
      const unit = it.budgetItem?.unit || "un";
      const pu = Number(it.precioUnitario || 0);
      const cantAnt = Number(it.cantidadAnterior || 0);
      const cantPres = Number(it.cantidadPresente || 0);
      const cantTot = cantAnt + cantPres;
      const montoAnt = Math.round(cantAnt * pu);
      const montoPres = Math.round(cantPres * pu);
      const montoTot = montoAnt + montoPres;

      return [
        code,
        name,
        unit,
        pu,
        cantAnt,
        cantPres,
        { f: `E${rowNum}+F${rowNum}`, v: cantTot },
        { f: `E${rowNum}*D${rowNum}`, v: montoAnt },
        { f: `F${rowNum}*D${rowNum}`, v: montoPres },
        { f: `G${rowNum}*D${rowNum}`, v: montoTot },
      ];
    });

    const startRow = 7;
    const endRow = 6 + certification.items.length;
    const totalRow = [
      "TOTALES",
      "",
      "",
      "",
      "",
      "",
      "",
      { f: `SUM(H${startRow}:H${endRow})`, v: totalMontoAnterior },
      { f: `SUM(I${startRow}:I${endRow})`, v: totalMontoPresente },
      { f: `SUM(J${startRow}:J${endRow})`, v: totalMontoAcumulado },
    ];

    const fullSheetData = [...titleRows, ...dataRows, totalRow];
    const ws = XLSX.utils.aoa_to_sheet(fullSheetData);

    // Ajustar anchos de columnas
    ws["!cols"] = [
      { wch: 12 }, // Ítem
      { wch: 45 }, // Descripción
      { wch: 10 }, // Unidad
      { wch: 18 }, // Precio Unitario
      { wch: 16 }, // Cant. Anterior
      { wch: 16 }, // Cant. Presente
      { wch: 16 }, // Cant. Total
      { wch: 22 }, // Monto Anterior
      { wch: 22 }, // Monto Presente
      { wch: 22 }, // Monto Total
    ];

    XLSX.utils.book_append_sheet(wb, ws, `Certificado N° ${certification.numero}`);

    // Si tiene cómputos auxiliares, crear hoja complementaria
    const allAuxCalculations: any[] = [];
    certification.items.forEach((item) => {
      if (item.auxiliaryCalculations && item.auxiliaryCalculations.length > 0) {
        item.auxiliaryCalculations.forEach((ac) => {
          allAuxCalculations.push([
            item.budgetItem?.code || "",
            item.budgetItem?.name || "",
            ac.descripcion,
            Number(ac.largo),
            Number(ac.ancho),
            Number(ac.alto),
            Number(ac.factor_repeticion),
            Number(ac.subtotal),
            item.budgetItem?.unit || "un",
          ]);
        });
      }
    });

    if (allAuxCalculations.length > 0) {
      const auxWsData = [
        ["PLANILLA DE CÓMPUTOS AUXILIARES DE CAMPO"],
        [`Obra: ${certification.project?.name || ""}`],
        [`Certificación N°: ${certification.numero}`],
        [],
        [
          "CÓDIGO RUBRO",
          "RUBRO",
          "DESCRIPCIÓN DEL ELEMENTO",
          "LARGO (m)",
          "ANCHO (m)",
          "ALTO / ESPESOR (m)",
          "FACTOR REPETICIÓN",
          "SUBTOTAL",
          "UNIDAD",
        ],
        ...allAuxCalculations,
      ];
      const auxWs = XLSX.utils.aoa_to_sheet(auxWsData);
      auxWs["!cols"] = [
        { wch: 14 },
        { wch: 30 },
        { wch: 35 },
        { wch: 12 },
        { wch: 12 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 10 },
      ];
      XLSX.utils.book_append_sheet(wb, auxWs, "Cómputos Auxiliares");
    }

    const safeFilename = `Certificado_${certification.numero}_${certification.project?.code || "Obra"}.xlsx`;
    XLSX.writeFile(wb, safeFilename);
  };

  // CSV plano: una fila por ítem, números sin formato
  const handleExportCsv = () => {
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "item", "descripcion", "unidad", "cant_contratada", "cant_anterior", "cant_periodo", "cant_acumulada",
      "precio_unitario", "monto_contractual", "monto_anterior", "monto_cert", "monto_acumulado", "saldo",
    ];
    const lines = rows.map((r) =>
      [
        r.code, r.name, r.unit, r.cantContrato, r.cantAnt, r.cantPres, r.cantAnt + r.cantPres,
        r.pu, r.contractual, r.montoAnt, r.montoPres, r.montoTot, r.saldo,
      ].map(esc).join(";")
    );
    const csv = "﻿" + [header.join(";"), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Certificado_${certification.numero}_${certification.project?.code || "Obra"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Imprimir en A4 Horizontal
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Styles for print (Landscape A4 strict styling) */}
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 10mm;
          }
          body {
            background-color: white !important;
            color: black !important;
            font-size: 10pt;
          }
          .no-print {
            display: none !important;
          }
          .print-only {
            display: block !important;
          }
          .print-table {
            width: 100% !important;
            border-collapse: collapse !important;
            font-size: 8pt !important;
          }
          .print-table th, .print-table td {
            border: 1px solid #333 !important;
            padding: 3px 5px !important;
          }
          .print-table th {
            background-color: #f0f0f0 !important;
            font-weight: bold !important;
          }
        }
      `}</style>

      {/* Toolbar (no-print) */}
      <div className="no-print bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1 text-xs font-semibold"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </button>
          <div className="h-6 w-px bg-slate-200"></div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                Previsualización Oficial de Certificado
                <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-slate-900 text-white">
                  N° {String(certification.numero).padStart(2, "0")}
                </span>
              </h2>
              <StatusSteps current={statusStepIndex(certification.estado)} />
            </div>
            <p className="text-xs text-slate-500">
              Formato Civil Estricto — Contratos Públicos y Privados de Obra
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Export to Excel */}
          <button
            onClick={handleExportToExcel}
            className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Exportar a Excel (.xlsx)
          </button>

          <button
            onClick={handleExportCsv}
            className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>

          {/* Print / PDF */}
          <button
            onClick={handlePrint}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Vista PDF / Imprimir
          </button>

          {/* Close measurement button (if draft) */}
          {isBorradorMedicion && (
            <button
              onClick={handleCloseMeasurement}
              disabled={closing}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              {closing ? "Enviando..." : "Enviar a revisión"}
            </button>
          )}

          {/* Approve button (if draft certificate) */}
          {(isBorradorCertificado || isBorradorMedicion) && (
            <button
              onClick={handleApprove}
              disabled={approving}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {approving ? "Procesando..." : "Aprobar"}
            </button>
          )}
        </div>
      </div>

      {/* Linked Invoice Alert (if already approved) */}
      {linkedInvoice && (
        <div className="no-print bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-emerald-900">
                Factura Fiscal Generada Automáticamente (Three-Way Match Aprobado)
              </h4>
              <p className="text-xs text-emerald-700">
                N° Factura: <strong className="font-mono">{linkedInvoice.numeroFactura}</strong> |
                Tipo: <strong>{linkedInvoice.tipo === "RECIBIDA" ? "Cuentas por Pagar (Subcontrato)" : "Cuentas por Cobrar (Cliente)"}</strong> |
                Monto: <strong>{formatGs(Number(linkedInvoice.total))} Gs.</strong> |
                Condición: <strong>{linkedInvoice.condicionVenta}</strong>
              </p>
            </div>
          </div>
          {onNavigateToInvoice && (
            <button
              onClick={() => onNavigateToInvoice(linkedInvoice.id)}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
            >
              Ver en Contabilidad
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Main Document / Excel Preview Card */}
      <div className="bg-white rounded-xl border border-slate-300 shadow-md p-6 sm:p-8 space-y-6 text-slate-800">
        {/* Certificate Letterhead */}
        <div className="border-b-2 border-slate-800 pb-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <span className="text-[11px] font-bold text-blue-700 uppercase tracking-widest block">
                Planilla Oficial de Medición y Liquidación
              </span>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                CERTIFICADO DE AVANCE DE OBRA N° {String(certification.numero).padStart(2, "0")}
              </h1>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Emisión bajo normas de control presupuestario de obra
              </p>
            </div>
            <div className="text-right">
              <div className="inline-block bg-slate-100 border border-slate-300 rounded-lg p-3 text-left">
                <div className="text-[11px] text-slate-500 font-medium">Fecha de Corte de Medición:</div>
                <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-slate-600" />
                  {new Date(certification.fecha).toLocaleDateString("es-PY", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Project & Beneficiary Metadata Box */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5 pt-4 border-t border-slate-200 text-xs">
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Obra
              </span>
              <div className="font-bold text-slate-800 text-sm mt-0.5 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-slate-600" />
                {certification.project?.name}
              </div>
              <div className="text-slate-500 text-[11px] mt-1">
                Código: <span className="font-mono font-semibold">{certification.project?.code}</span> |
                Ubicación: {certification.project?.location}
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                {certification.partner ? "Subcontratista Ejecutor" : "Comitente / Propietario de Obra"}
              </span>
              <div className="font-bold text-slate-800 text-sm mt-0.5">
                {certification.partner ? certification.partner.name : certification.project?.clientName || "—"}
              </div>
              <div className="text-slate-500 text-[11px] mt-1">
                {certification.partner ? (
                  <>RUC: <span className="font-mono font-semibold">{certification.partner.taxId}</span> (Cuentas por Pagar)</>
                ) : (
                  <>Certificación al Cliente Principal (Cuentas por Cobrar)</>
                )}
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Resumen Financiero del Período
              </span>
              <div className="font-black text-emerald-700 text-base mt-0.5 font-mono">
                {formatGs(totalMontoPresente)} Gs.
              </div>
              <div className="text-slate-500 text-[11px] mt-1">
                Acumulado a la fecha: <strong className="text-slate-700">{formatGs(totalMontoAcumulado)} Gs.</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Planilla del certificado */}
        <div className="overflow-x-auto rounded-lg border border-slate-300">
          <table className="w-full text-left text-xs border-collapse print-table">
            <thead>
              <tr className="bg-slate-800 text-white font-bold text-[11px]">
                <th className="py-2 px-2 text-center w-14 border-r border-slate-700">Ítem</th>
                <th className="py-2 px-3 min-w-[220px] border-r border-slate-700">Descripción</th>
                <th className="py-2 px-2 text-center w-12 border-r border-slate-700">Un.</th>
                <th className="py-2 px-2 text-right w-28 border-r border-slate-700">P.U.</th>
                <th className="py-2 px-2 text-right w-32 border-r border-slate-700">Monto contractual</th>
                <th className="py-2 px-2 text-right w-32 border-r border-slate-700">Acum. anterior</th>
                <th className="py-2 px-2 text-right w-32 border-r border-slate-700 bg-emerald-900">Este cert.</th>
                <th className="py-2 px-2 text-right w-32 border-r border-slate-700">Acum. actual</th>
                <th className="py-2 px-2 text-right w-32">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
              {rows.map((row, idx) => {
                const item = row.item;
                const hasPhotos = item.photos && item.photos.length > 0;
                const hasAux = item.auxiliaryCalculations && item.auxiliaryCalculations.length > 0;
                const isAuxExpanded = expandedAuxItemId === item.id;

                return (
                  <React.Fragment key={item.id || idx}>
                    <tr className={row.saldo < 0 ? "bg-red-50" : "hover:bg-slate-50"}>
                      <td className="py-2 px-2 text-center font-bold text-slate-700 border-r border-slate-200">{row.code}</td>
                      <td className="py-2 px-3 font-sans text-slate-800 border-r border-slate-200">
                        <div>{row.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {formatQty(row.cantAnt)} + <strong className="text-blue-800">{formatQty(row.cantPres)}</strong> ={" "}
                          {formatQty(row.cantAnt + row.cantPres)} {row.unit}
                          {row.cantContrato > 0 && ` de ${formatQty(row.cantContrato)}`}
                        </div>
                        <div className="no-print flex items-center gap-2 mt-0.5">
                          {hasAux && (
                            <button
                              type="button"
                              onClick={() => setExpandedAuxItemId(isAuxExpanded ? null : item.id || null)}
                              className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 rounded-sm flex items-center gap-1 cursor-pointer"
                            >
                              <Layers className="w-2.5 h-2.5" /> Cómputo ({item.auxiliaryCalculations?.length})
                            </button>
                          )}
                          {hasPhotos && (
                            <button
                              type="button"
                              onClick={() =>
                                setActivePhotoModalItem({ code: row.code, name: row.name, photos: item.photos || [] })
                              }
                              className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 rounded-sm flex items-center gap-1 cursor-pointer"
                            >
                              <Camera className="w-2.5 h-2.5" /> {item.photos?.length} fotos
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-center font-sans text-slate-600 border-r border-slate-200">{row.unit}</td>
                      <td className="py-2 px-2 text-right border-r border-slate-200">{formatGs(row.pu)}</td>
                      <td className="py-2 px-2 text-right border-r border-slate-200">{row.contractual ? formatGs(row.contractual) : "—"}</td>
                      <td className="py-2 px-2 text-right text-slate-600 border-r border-slate-200">{formatGs(row.montoAnt)}</td>
                      <td className="py-2 px-2 text-right font-bold text-emerald-800 bg-emerald-50/60 border-r border-slate-200">{formatGs(row.montoPres)}</td>
                      <td className="py-2 px-2 text-right font-semibold border-r border-slate-200">{formatGs(row.montoTot)}</td>
                      <td className={`py-2 px-2 text-right ${row.saldo < 0 ? "text-red-700 font-bold" : "text-slate-600"}`}>
                        {row.contractual ? formatGs(row.saldo) : "—"}
                      </td>
                    </tr>

                    {isAuxExpanded && item.auxiliaryCalculations && (
                      <tr className="no-print bg-amber-50/50">
                        <td colSpan={9} className="p-2 pl-16">
                          <table className="text-[11px] font-mono">
                            <tbody>
                              {item.auxiliaryCalculations.map((ac, acIdx) => (
                                <tr key={acIdx} className={ac.isDeduction ? "text-red-700" : "text-slate-700"}>
                                  <td className="pr-4 font-sans">{ac.descripcion}</td>
                                  <td className="pr-4">
                                    {ac.largo} × {ac.ancho} × {ac.alto} × {ac.factor_repeticion}
                                  </td>
                                  <td className="text-right font-bold">{formatQty(Number(ac.subtotal))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-900 text-white font-bold text-xs">
                <td colSpan={4} className="py-2.5 px-3 text-right uppercase font-sans">Totales</td>
                <td className="py-2.5 px-2 text-right font-mono">{formatGs(totalContractual)}</td>
                <td className="py-2.5 px-2 text-right font-mono text-slate-300">{formatGs(totalMontoAnterior)}</td>
                <td className="py-2.5 px-2 text-right font-mono text-emerald-300">{formatGs(totalMontoPresente)}</td>
                <td className="py-2.5 px-2 text-right font-mono">{formatGs(totalMontoAcumulado)}</td>
                <td className="py-2.5 px-2 text-right font-mono text-amber-300">{formatGs(totalContractual - totalMontoAcumulado)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Pie: deducciones y neto */}
        <div className="flex justify-end">
          <table className="text-xs w-full max-w-md border border-slate-300 print-table">
            <tbody className="font-mono">
              <tr>
                <td className="px-3 py-1.5 font-sans">Monto de este certificado</td>
                <td className="px-3 py-1.5 text-right font-bold">{formatGs(totalMontoPresente)}</td>
              </tr>
              <tr>
                <td className="px-3 py-1.5 font-sans">
                  (−) Fondo de reparo{" "}
                  {hasStoredRetention ? (
                    <span className="text-slate-500">({Number(certification.retentionPct || 0)}%)</span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5">
                      <NumCell
                        value={reparoPct}
                        onValue={setReparoPct}
                        disabled={isApproved}
                        className="w-12 border border-slate-300 rounded px-1 text-right"
                      />
                      <span className="text-slate-500">%</span>
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right text-red-700">{formatGs(fondoReparo)}</td>
              </tr>
              <tr>
                <td className="px-3 py-1.5 font-sans">(−) Descuento de anticipo</td>
                <td className="px-3 py-1.5 text-right text-red-700">
                  <NumCell
                    value={anticipo}
                    onValue={setAnticipo}
                    disabled={isApproved}
                    className="w-32 border border-slate-300 rounded px-1 text-right disabled:border-transparent disabled:bg-transparent"
                  />
                </td>
              </tr>
              <tr>
                <td className="px-3 py-1.5 font-sans">(−) Materiales provistos</td>
                <td className="px-3 py-1.5 text-right text-red-700">
                  <NumCell
                    value={materiales}
                    onValue={setMateriales}
                    disabled={isApproved}
                    className="w-32 border border-slate-300 rounded px-1 text-right disabled:border-transparent disabled:bg-transparent"
                  />
                </td>
              </tr>
              <tr className="bg-slate-900 text-white">
                <td className="px-3 py-2.5 font-sans font-black uppercase">Neto a pagar</td>
                <td className="px-3 py-2.5 text-right font-black text-base">{formatGs(netoAPagar)} Gs.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="no-print text-[10px] text-slate-500 text-right -mt-4">
          Anticipo y materiales son informativos para la planilla impresa y el CSV; la aprobación factura según la lógica actual.
        </p>

        {/* Signature Blocks for Printing and Formal Approval */}
        <div className="pt-10 mt-10 border-t border-slate-300 grid grid-cols-3 gap-6 text-center text-xs">
          <div className="space-y-12">
            <div className="h-10"></div>
            <div className="border-t border-slate-400 pt-2">
              <div className="font-bold text-slate-800">Jefe de Campo / Topógrafo</div>
              <div className="text-[11px] text-slate-500">Medición física ejecutada</div>
            </div>
          </div>

          <div className="space-y-12">
            <div className="h-10"></div>
            <div className="border-t border-slate-400 pt-2">
              <div className="font-bold text-slate-800">Fiscal de Obra / Supervisor</div>
              <div className="text-[11px] text-slate-500">Verificación y conformidad técnica</div>
            </div>
          </div>

          <div className="space-y-12">
            <div className="h-10"></div>
            <div className="border-t border-slate-400 pt-2">
              <div className="font-bold text-slate-800">Director de Obra / Gerencia</div>
              <div className="text-[11px] text-slate-500">Autorización financiera y contable</div>
            </div>
          </div>
        </div>
      </div>

      {/* Photo Modal Viewer */}
      {activePhotoModalItem && (
        <ItemPhotoModal
          isOpen={Boolean(activePhotoModalItem)}
          onClose={() => setActivePhotoModalItem(null)}
          rubroCode={activePhotoModalItem.code}
          rubroName={activePhotoModalItem.name}
          photos={activePhotoModalItem.photos}
          onSavePhotos={() => {}}
          readOnly={true}
        />
      )}
    </div>
  );
};
