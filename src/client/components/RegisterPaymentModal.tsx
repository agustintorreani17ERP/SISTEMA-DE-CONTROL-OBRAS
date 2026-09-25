import React, { useState } from "react";
import {
  CreditCard,
  X,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Loader2,
  Banknote,
} from "lucide-react";
import { formatMoney, formatDate } from "../utils/format";

interface RegisterPaymentModalProps {
  invoice: any;
  onClose: () => void;
  onPaymentSuccess: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const RegisterPaymentModal: React.FC<RegisterPaymentModalProps> = ({
  invoice,
  onClose,
  onPaymentSuccess,
  showToast,
}) => {
  const totalAmount = Number(invoice.total || 0);
  const totalPaid = Number(invoice.totalPaid || 0);
  const remainingBalance = Math.max(0, totalAmount - totalPaid);

  const [monto, setMonto] = useState<number>(remainingBalance);
  const [metodo, setMetodo] = useState<"TRANSFERENCIA" | "CHEQUE" | "EFECTIVO">("TRANSFERENCIA");
  const [referenciaBanco, setReferenciaBanco] = useState("");
  const [fechaPago, setFechaPago] = useState(new Date().toISOString().split("T")[0]);
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(false);

  // Business Rule Check
  const canPay = invoice.estado === "APROBADA" || invoice.estado === "PAGADA";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canPay) {
      showToast(
        "No se puede autorizar el pago: La factura no cuenta con la Aprobación del Three-Way Match (Integración Tripartita).",
        "error"
      );
      return;
    }

    if (monto <= 0) {
      showToast("El importe a pagar debe ser mayor a 0", "error");
      return;
    }

    if (monto > remainingBalance + 10) {
      showToast("El monto no puede superar el saldo pendiente de la factura", "error");
      return;
    }

    if (!referenciaBanco.trim()) {
      showToast("Ingrese la referencia bancaria o N° de cheque/recibo", "error");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          montoPagado: monto,
          fechaPago,
          metodo,
          referenciaBanco,
          notas,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Error al registrar el pago");
      }

      showToast(
        `Pago de ₲ ${monto.toLocaleString("es-PY")} registrado exitosamente (${data.data.invoiceStatus})`,
        "success"
      );
      onPaymentSuccess();
      onClose();
    } catch (err: any) {
      showToast(err.message || "Error al procesar el pago", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-xs">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Registrar Pago / Desembolso Financiero
            </h3>
            <p className="text-[11px] text-slate-500">
              Gestión de Tesorería · Factura N° {invoice.numeroFactura}
            </p>
          </div>
        </div>

        {/* Blocking Alert if Not Approved */}
        {!canPay && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 space-y-1 mb-4">
            <div className="flex items-center gap-2 font-bold text-xs">
              <Lock className="w-4 h-4 text-rose-600" />
              <span>PAGO BLOQUEADO POR POLÍTICA THREE-WAY MATCH</span>
            </div>
            <p className="text-[11px] leading-relaxed text-rose-700">
              El estado actual de esta factura es <strong>"{invoice.estado}"</strong>. El
              sistema corporativo no permite autorizar desembolsos bancarios hasta que
              coincidan al 100% la Orden de Compra, la Recepción en Pañol y la Factura.
            </p>
          </div>
        )}

        {/* Invoice Summary Box */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 mb-4">
          <div className="flex justify-between">
            <span className="text-slate-500">Proveedor / Subcontratista:</span>
            <span className="font-bold text-slate-800 truncate max-w-[200px]">
              {invoice.partner?.name || invoice.partnerName}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Total Facturado:</span>
            <span className="font-mono font-bold text-slate-800">
              ₲ {totalAmount.toLocaleString("es-PY")}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Pagado Acumulado:</span>
            <span className="font-mono text-slate-600">
              ₲ {totalPaid.toLocaleString("es-PY")}
            </span>
          </div>
          <div className="flex justify-between pt-1 border-t border-slate-200">
            <span className="font-bold text-slate-700">Saldo Pendiente:</span>
            <span className="font-mono font-black text-sm text-emerald-700">
              ₲ {remainingBalance.toLocaleString("es-PY")}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Importe a Pagar (Guaraníes):
            </label>
            <input
              type="number"
              disabled={!canPay}
              min={1}
              max={remainingBalance}
              value={monto}
              onChange={(e) => setMonto(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 font-mono font-bold text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Método de Pago:
              </label>
              <select
                disabled={!canPay}
                value={metodo}
                onChange={(e) => setMetodo(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 text-xs text-slate-800 disabled:bg-slate-100"
              >
                <option value="TRANSFERENCIA">Transferencia SIPAP</option>
                <option value="CHEQUE">Cheque Bancario</option>
                <option value="EFECTIVO">Efectivo / Fondo Fijo</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Fecha de Pago:
              </label>
              <input
                type="date"
                disabled={!canPay}
                value={fechaPago}
                onChange={(e) => setFechaPago(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 text-xs disabled:bg-slate-100"
                required
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Referencia Bancaria / N° de Comprobante / N° Cheque:
            </label>
            <input
              type="text"
              disabled={!canPay}
              value={referenciaBanco}
              onChange={(e) => setReferenciaBanco(e.target.value)}
              placeholder="Ej: ITAU-TR-849102 o BNF CHQ 004812"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 font-mono text-xs disabled:bg-slate-100"
              required
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Notas de Tesorería (Opcional):
            </label>
            <textarea
              disabled={!canPay}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Detalle adicional de la orden de pago o retenciones..."
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 text-xs disabled:bg-slate-100"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canPay || loading}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Procesando...</span>
                </>
              ) : (
                <>
                  <CreditCard className="w-4 h-4" />
                  <span>Confirmar y Desembolsar</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
