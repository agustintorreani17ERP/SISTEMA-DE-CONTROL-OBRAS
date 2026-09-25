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
} from "lucide-react";
import { Certification, ItemPhoto, AuxiliaryCalculation } from "../../types";
import { api } from "../../api";
import { ItemPhotoModal } from "./ItemPhotoModal";

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
      ? `¿Aprobar Certificado N° ${certification.numero} de Subcontratista?\n\nAcción Contable: Se creará automáticamente una Factura Fiscal RECIBIDA (Cuentas por Pagar) con Three-Way Match 100% validado por ${totalMontoPresente.toLocaleString("es-PY")} Gs.`
      : `¿Aprobar Certificado N° ${certification.numero} de Obra al Cliente?\n\nAcción Contable: Se creará automáticamente una Factura Fiscal EMITIDA (Cuentas por Cobrar) por ${totalMontoPresente.toLocaleString("es-PY")} Gs.`;

    if (!window.confirm(msg)) return;

    setApproving(true);
    try {
      const res = await api.approveCertification(certification.id);
      alert(
        `✅ Certificado N° ${certification.numero} APROBADO EXITOSAMENTE.\n\nFactura generada: ${res.invoice?.numeroFactura || "Fiscal"}\nMonto: ${Number(res.invoice?.total || totalMontoPresente).toLocaleString("es-PY")} Gs.\nThree-Way Match: 100% Aprobado.`
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
      [`Obra: ${certification.project?.name || "Proyecto Vial"} (${certification.project?.code || ""})`],
      [
        certification.partner
          ? `Subcontratista: ${certification.partner.name} (RUC: ${certification.partner.taxId})`
          : `Comitente / Cliente: ${certification.project?.clientName || "MOPC / República del Paraguay"}`,
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
              {isApproved ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" /> APROBADO Y FACTURADO
                </span>
              ) : isBorradorCertificado ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                  <FileText className="w-3.5 h-3.5" /> CERTIFICADO BORRADOR
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                  <Layers className="w-3.5 h-3.5" /> MEDICIÓN BORRADOR
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Formato Civil Estricto — Normas MOPC / Contratos Privados de Infraestructura
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

          {/* Print / PDF */}
          <button
            onClick={handlePrint}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Imprimir / PDF (A4 Horizontal)
          </button>

          {/* Close measurement button (if draft) */}
          {isBorradorMedicion && (
            <button
              onClick={handleCloseMeasurement}
              disabled={closing}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              {closing ? "Cerrando..." : "Cerrar Medición y Generar Certificado"}
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
              {approving ? "Procesando..." : "Aprobar Certificado (Three-Way Match)"}
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
                Monto: <strong>{Number(linkedInvoice.total).toLocaleString("es-PY")} Gs.</strong> |
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
                Emisión bajo normas de control presupuestario vial y obras civiles
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
                Obra / Tramo Vial
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
                {certification.partner ? certification.partner.name : certification.project?.clientName || "MOPC"}
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
                {totalMontoPresente.toLocaleString("es-PY")} Gs.
              </div>
              <div className="text-slate-500 text-[11px] mt-1">
                Acumulado a la fecha: <strong className="text-slate-700">{totalMontoAcumulado.toLocaleString("es-PY")} Gs.</strong>
              </div>
            </div>
          </div>
        </div>

        {/* 10-Column Strict Financial Table */}
        <div className="overflow-x-auto rounded-lg border border-slate-300">
          <table className="w-full text-left text-xs border-collapse print-table">
            <thead>
              <tr className="bg-slate-800 text-white font-bold text-[11px] tracking-wide border-b border-slate-900">
                <th className="py-2.5 px-2 text-center w-12 border-r border-slate-700">1. Ítem</th>
                <th className="py-2.5 px-3 min-w-[220px] border-r border-slate-700">2. Descripción del Rubro</th>
                <th className="py-2.5 px-2 text-center w-12 border-r border-slate-700">3. Unid.</th>
                <th className="py-2.5 px-3 text-right w-28 border-r border-slate-700">4. P. Unitario (Gs.)</th>
                <th className="py-2.5 px-2.5 text-right w-24 bg-slate-700/80 border-r border-slate-600">5. Cant. Anterior</th>
                <th className="py-2.5 px-2.5 text-right w-24 bg-blue-900/80 border-r border-blue-800 text-blue-100">6. Cant. Presente</th>
                <th className="py-2.5 px-2.5 text-right w-24 bg-slate-700/80 border-r border-slate-600">7. Cant. Total</th>
                <th className="py-2.5 px-3 text-right w-32 bg-slate-700/80 border-r border-slate-600">8. Monto Anterior (Gs.)</th>
                <th className="py-2.5 px-3 text-right w-32 bg-emerald-900/90 border-r border-emerald-800 text-emerald-100">9. Monto Presente (Gs.)</th>
                <th className="py-2.5 px-3 text-right w-32 bg-slate-900 text-amber-300 font-black">10. Monto Total (Gs.)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
              {certification.items.map((item, idx) => {
                const pu = Number(item.precioUnitario || 0);
                const cantAnt = Number(item.cantidadAnterior || 0);
                const cantPres = Number(item.cantidadPresente || 0);
                const cantTot = cantAnt + cantPres;
                const montoAnt = Math.round(cantAnt * pu);
                const montoPres = Math.round(cantPres * pu);
                const montoTot = montoAnt + montoPres;

                const hasPhotos = item.photos && item.photos.length > 0;
                const hasAux = item.auxiliaryCalculations && item.auxiliaryCalculations.length > 0;
                const isAuxExpanded = expandedAuxItemId === item.id;

                return (
                  <React.Fragment key={item.id || idx}>
                    <tr className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-2 text-center font-bold text-slate-700 border-r border-slate-200">
                        {item.budgetItem?.code || idx + 1}
                      </td>
                      <td className="py-2.5 px-3 font-sans font-medium text-slate-800 border-r border-slate-200">
                        <div>{item.budgetItem?.name || "Rubro presupuestario"}</div>
                        {/* Evidence Tags (no-print) */}
                        <div className="no-print flex items-center gap-2 mt-1">
                          {hasAux && (
                            <button
                              type="button"
                              onClick={() => setExpandedAuxItemId(isAuxExpanded ? null : (item.id || null))}
                              className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-sm hover:bg-emerald-100 flex items-center gap-1 cursor-pointer"
                            >
                              <Layers className="w-2.5 h-2.5" />
                              {item.auxiliaryCalculations?.length} tramos auxiliar
                            </button>
                          )}
                          {hasPhotos && (
                            <button
                              type="button"
                              onClick={() =>
                                setActivePhotoModalItem({
                                  code: item.budgetItem?.code || "",
                                  name: item.budgetItem?.name || "",
                                  photos: item.photos || [],
                                })
                              }
                              className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-sm hover:bg-blue-100 flex items-center gap-1 cursor-pointer"
                            >
                              <Camera className="w-2.5 h-2.5" />
                              {item.photos?.length} fotos
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-center text-slate-600 font-sans border-r border-slate-200">
                        {item.budgetItem?.unit || "un"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700 border-r border-slate-200">
                        {pu.toLocaleString("es-PY")}
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-slate-600 bg-slate-50/50 border-r border-slate-200">
                        {cantAnt.toLocaleString("es-PY", { maximumFractionDigits: 3 })}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-bold text-blue-800 bg-blue-50/40 border-r border-slate-200">
                        {cantPres.toLocaleString("es-PY", { maximumFractionDigits: 3 })}
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-slate-800 font-semibold bg-slate-50/50 border-r border-slate-200">
                        {cantTot.toLocaleString("es-PY", { maximumFractionDigits: 3 })}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600 bg-slate-50/50 border-r border-slate-200">
                        {montoAnt.toLocaleString("es-PY")}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-800 bg-emerald-50/50 border-r border-slate-200">
                        {montoPres.toLocaleString("es-PY")}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900 bg-slate-100/70">
                        {montoTot.toLocaleString("es-PY")}
                      </td>
                    </tr>

                    {/* Inline Auxiliary Calculation Preview if expanded */}
                    {isAuxExpanded && item.auxiliaryCalculations && (
                      <tr className="no-print bg-slate-900 text-slate-200">
                        <td colSpan={10} className="p-3">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs font-bold text-emerald-400">
                              <span>Cómputo Auxiliar de Campo para {item.budgetItem?.code}</span>
                              <span className="text-[11px] text-slate-400">
                                Total Sumado: {cantPres.toLocaleString("es-PY", { maximumFractionDigits: 3 })} {item.budgetItem?.unit}
                              </span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                              {item.auxiliaryCalculations.map((ac, acIdx) => (
                                <div key={acIdx} className="bg-slate-800 p-2 rounded-sm border border-slate-700 flex justify-between items-center">
                                  <div>
                                    <span className="font-semibold text-white">{ac.descripcion}</span>
                                    <span className="text-slate-400 ml-2 font-mono">
                                      ({ac.largo}m × {ac.ancho}m × {ac.alto}m × {ac.factor_repeticion})
                                    </span>
                                  </div>
                                  <span className="font-mono font-bold text-emerald-300">
                                    {Number(ac.subtotal).toLocaleString("es-PY", { maximumFractionDigits: 3 })} {item.budgetItem?.unit}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-900 text-white font-black text-xs border-t-2 border-slate-950">
                <td colSpan={7} className="py-3 px-4 text-right uppercase tracking-wider font-sans border-r border-slate-700">
                  TOTALES GENERALES DEL CERTIFICADO:
                </td>
                <td className="py-3 px-3 text-right font-mono text-slate-300 border-r border-slate-700">
                  {totalMontoAnterior.toLocaleString("es-PY")} Gs.
                </td>
                <td className="py-3 px-3 text-right font-mono text-emerald-300 bg-emerald-950/60 border-r border-slate-700 text-sm">
                  {totalMontoPresente.toLocaleString("es-PY")} Gs.
                </td>
                <td className="py-3 px-3 text-right font-mono text-amber-300 text-sm">
                  {totalMontoAcumulado.toLocaleString("es-PY")} Gs.
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

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
