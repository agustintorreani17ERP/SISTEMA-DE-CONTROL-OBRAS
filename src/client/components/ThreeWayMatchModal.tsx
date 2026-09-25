import React, { useState } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  FileText,
  Truck,
  Receipt,
  X,
  RefreshCw,
  CheckCircle2,
  Lock,
  ArrowRight,
  Printer,
  CreditCard,
  Building2,
} from "lucide-react";
import { formatMoney, formatDate } from "../utils/format";

interface ThreeWayMatchModalProps {
  invoice: any;
  project?: any;
  onClose: () => void;
  onViewA4: (invoice: any) => void;
  onProceedPayment: (invoice: any) => void;
  onMatchUpdated: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const ThreeWayMatchModal: React.FC<ThreeWayMatchModalProps> = ({
  invoice,
  project,
  onClose,
  onViewA4,
  onProceedPayment,
  onMatchUpdated,
  showToast,
}) => {
  const [revalidating, setRevalidating] = useState(false);

  const po = invoice?.purchaseOrder;
  const poAmount = Number(po?.totalAmount || 0);
  const invoiceTotal = Number(invoice?.total || 0);
  const diff = Math.abs(invoiceTotal - poAmount);
  const hasRemision = Boolean(invoice?.remisionNumber || po?.stockRegistered);

  const isMatched = invoice?.threeWayMatchPassed && invoice?.estado === "APROBADA";

  const handleReverify = async () => {
    setRevalidating(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/verify-match`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Error al verificar Three-Way Match");
      }

      showToast(
        data.data.threeWayMatchPassed
          ? "Integración Tripartita verificada con éxito (0% tolerancia)"
          : "Discrepancia detectada en la validación tripartita",
        data.data.threeWayMatchPassed ? "success" : "info"
      );
      onMatchUpdated();
    } catch (err: any) {
      showToast(err.message || "Error en validación", "error");
    } finally {
      setRevalidating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl shadow-2xl p-6 relative flex flex-col max-h-[94vh]">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div
              className={`p-3 rounded-xl ${
                isMatched ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
              }`}
            >
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-slate-900">
                  Control de Integración Tripartita (Three-Way Match)
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                    isMatched
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      : "bg-amber-100 text-amber-800 border border-amber-300"
                  }`}
                >
                  {isMatched ? "APROBADA PARA PAGO" : "EN REVISIÓN / BLOQUEADA"}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Validación cruzada corporativa estilo SAP: Orden de Compra vs. Recepción en Pañol vs. Factura Fiscal
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tolerance & Status Banner */}
        <div className="my-4">
          <div
            className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
              isMatched
                ? "bg-emerald-50/70 border-emerald-200 text-emerald-950"
                : "bg-amber-50/70 border-amber-200 text-amber-950"
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs uppercase tracking-wide">
                  Regla de Negocio: Tolerancia del 0.00%
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/80 font-bold border border-slate-200">
                  Delta: ₲ {diff.toLocaleString("es-PY")}
                </span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">
                {invoice.matchNotes ||
                  (isMatched
                    ? "Los montos, precios acordados y la recepción física de mercaderías coinciden en un 100%."
                    : "Existe una divergencia en el importe o aún no se ha verificado el ingreso físico en el Pañol de obra.")}
              </p>
            </div>

            <button
              onClick={handleReverify}
              disabled={revalidating}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 text-xs font-bold shadow-xs transition shrink-0 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${revalidating ? "animate-spin text-blue-600" : ""}`} />
              <span>Re-evaluar Match</span>
            </button>
          </div>
        </div>

        {/* 3 Columns Comparison (The Tripartite Pillars) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1 overflow-y-auto pr-1">
          {/* Pillar 1: Purchase Order / Contract */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  <span className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    1. Orden de Compra
                  </span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-bold">
                  Pactado
                </span>
              </div>

              <div className="mt-3 space-y-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">N° de Documento:</span>
                  <p className="font-mono font-bold text-slate-900">
                    {po?.number || (invoice.certificacionId ? `Certificado #${invoice.certificacionId}` : "Sin O.C.")}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Proveedor Asignado:</span>
                  <p className="font-medium text-slate-800 truncate">
                    {po?.partner?.name || invoice.partner?.name || "-"}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Fecha de Emisión:</span>
                  <p className="font-mono text-slate-700">
                    {po?.issueDate ? formatDate(po.issueDate) : "Verificado en Contrato"}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Monto Autorizado:</span>
                  <p className="font-mono font-black text-sm text-blue-800">
                    {formatMoney(poAmount > 0 ? poAmount : invoiceTotal, "PYG")}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-2 rounded-lg bg-white border border-slate-200 text-[10px] text-slate-600 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Precios unitarios validados contra presupuesto base</span>
            </div>
          </div>

          {/* Pillar 2: Receiving / Site Delivery (Pañol / Báscula) */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-purple-600" />
                  <span className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    2. Recepción en Pañol
                  </span>
                </div>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${
                    hasRemision
                      ? "bg-purple-100 text-purple-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {hasRemision ? "Ingresado" : "Pendiente"}
                </span>
              </div>

              <div className="mt-3 space-y-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Nota de Remisión N°:</span>
                  <p className="font-mono font-bold text-purple-900">
                    {invoice.remisionNumber || (po?.stockRegistered ? "REGISTRADO EN ALMACÉN" : "Falta Remisión Física")}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Ubicación de Descarga:</span>
                  <p className="font-medium text-slate-800">
                    {project?.name || "Duplicación Ruta PY02"} (Frente 1 / Campamento)
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Responsable de Recepción:</span>
                  <p className="font-medium text-slate-700">Sr. Jorge Duarte (Almacén / Pañol)</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Estado de Control Físico:</span>
                  <p className="font-mono font-bold text-slate-800">
                    {hasRemision ? "Pesaje en Báscula Conforme (100%)" : "Sin verificación en sitio"}
                  </p>
                </div>
              </div>
            </div>

            <div
              className={`p-2 rounded-lg border text-[10px] flex items-center gap-2 ${
                hasRemision
                  ? "bg-white border-slate-200 text-slate-600"
                  : "bg-amber-100/60 border-amber-300 text-amber-900 font-semibold"
              }`}
            >
              {hasRemision ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Remito fiscal archivado con firma del pañolero</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Requiere comprobante físico antes de pagar</span>
                </>
              )}
            </div>
          </div>

          {/* Pillar 3: Provider Invoice */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-emerald-600" />
                  <span className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    3. Factura Fiscal
                  </span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                  Cobrado
                </span>
              </div>

              <div className="mt-3 space-y-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">N° Factura & Timbrado:</span>
                  <p className="font-mono font-bold text-slate-900">
                    {invoice.numeroFactura}
                  </p>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Timbrado: {invoice.timbrado}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Condición & Vencimiento:</span>
                  <p className="font-medium text-slate-800">
                    {invoice.condicionVenta} · {formatDate(invoice.fechaVencimiento)}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Liquidación IVA (10%):</span>
                  <p className="font-mono text-slate-700">
                    {formatMoney(Number(invoice.montoIva10 || 0), "PYG")}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Monto Total Facturado:</span>
                  <p className="font-mono font-black text-sm text-emerald-800">
                    {formatMoney(invoiceTotal, "PYG")}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-2 rounded-lg bg-white border border-slate-200 text-[10px] text-slate-600 flex items-center justify-between">
              <span>Estado Contable:</span>
              <span className="font-bold text-slate-900 font-mono">{invoice.estado}</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-4 pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {isMatched ? (
              <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Desembolso habilitado por Auditoría Financiera
              </span>
            ) : (
              <span className="text-rose-600 font-semibold flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-rose-500" />
                Pago bloqueado: Resuelva las discrepancias para habilitar
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={() => onViewA4(invoice)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Ver Factura Legal A4</span>
            </button>

            {isMatched && invoice.estado !== "PAGADA" && (
              <button
                onClick={() => onProceedPayment(invoice)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
              >
                <CreditCard className="w-4 h-4" />
                <span>Autorizar y Pagar</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold text-xs cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
