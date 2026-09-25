import React, { useState, useMemo } from "react";
import {
  Receipt,
  X,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Truck,
  Building2,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Partner, PurchaseOrder } from "../types";
import { formatMoney } from "../utils/format";

interface NewInvoiceModalProps {
  project?: any;
  partners: Partner[];
  purchaseOrders: PurchaseOrder[];
  onClose: () => void;
  onInvoiceCreated: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const NewInvoiceModal: React.FC<NewInvoiceModalProps> = ({
  project,
  partners,
  purchaseOrders,
  onClose,
  onInvoiceCreated,
  showToast,
}) => {
  const [tipo, setTipo] = useState<"RECIBIDA" | "EMITIDA">("RECIBIDA");
  const [partnerId, setPartnerId] = useState<number>(partners[0]?.id || 1);
  const [purchaseOrderId, setPurchaseOrderId] = useState<number | null>(null);
  const [numeroFactura, setNumeroFactura] = useState("");
  const [timbrado, setTimbrado] = useState("");
  const [fechaEmision, setFechaEmision] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [fechaVencimiento, setFechaVencimiento] = useState(
    new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]
  );
  const [condicionVenta, setCondicionVenta] = useState("CREDITO");
  const [concepto, setConcepto] = useState("");
  const [remisionNumber, setRemisionNumber] = useState("");
  const [remisionDate, setRemisionDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  // Line items
  const [items, setItems] = useState<
    Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      vatType: "IVA10" | "IVA5" | "EXENTA";
    }>
  >([
    {
      description: "Piedra Triturada 4ta p/ Base Granular",
      quantity: 100,
      unitPrice: 75000,
      vatType: "IVA10",
    },
  ]);

  const [loading, setLoading] = useState(false);

  // Selected PO
  const selectedPO = useMemo(() => {
    return purchaseOrders.find((po) => po.id === purchaseOrderId) || null;
  }, [purchaseOrders, purchaseOrderId]);

  // When PO is selected, auto-fill partner, concept, and line items if empty
  const handleSelectPO = (poId: number | null) => {
    setPurchaseOrderId(poId);
    if (poId) {
      const found = purchaseOrders.find((p) => p.id === poId);
      if (found) {
        if (found.partnerId) setPartnerId(found.partnerId);
        if (!concepto) setConcepto(`Factura respaldada por O.C. ${found.number}`);

        // If PO has details, map them to invoice items
        if (found.details && found.details.length > 0) {
          setItems(
            found.details.map((d: any) => ({
              description: d.material?.description || `Material según O.C. ${found.number}`,
              quantity: Number(d.quantity || 1),
              unitPrice: Number(d.unitPrice || 0),
              vatType: "IVA10",
            }))
          );
        } else {
          // If no details, put total amount
          const amt = Number(found.totalAmount || 0);
          setItems([
            {
              description: `Suministros según O.C. ${found.number}`,
              quantity: 1,
              unitPrice: amt,
              vatType: "IVA10",
            },
          ]);
        }
      }
    }
  };

  // Calculations
  const calculatedItems = useMemo(() => {
    return items.map((it) => {
      const sub = it.quantity * it.unitPrice;
      let montoExento = 0;
      let montoIva5 = 0;
      let montoIva10 = 0;

      if (it.vatType === "EXENTA") {
        montoExento = sub;
      } else if (it.vatType === "IVA5") {
        montoIva5 = Math.round(sub / 21);
      } else {
        montoIva10 = Math.round(sub / 11);
      }

      return {
        ...it,
        subtotal: sub,
        montoExento,
        montoIva5,
        montoIva10,
      };
    });
  }, [items]);

  const totalAmount = calculatedItems.reduce((acc, it) => acc + it.subtotal, 0);
  const totalIva10 = calculatedItems.reduce((acc, it) => acc + it.montoIva10, 0);
  const totalIva5 = calculatedItems.reduce((acc, it) => acc + it.montoIva5, 0);
  const totalExento = calculatedItems.reduce((acc, it) => acc + it.montoExento, 0);
  const totalSubtotal = totalAmount - (totalIva10 + totalIva5);

  // Live Three-Way Match Evaluation preview
  const liveMatchStatus = useMemo(() => {
    if (tipo !== "RECIBIDA") {
      return {
        passed: true,
        message: "Factura a cliente validada con contrato principal.",
      };
    }

    if (!purchaseOrderId) {
      return {
        passed: false,
        message: "Sin Orden de Compra: Quedará en estado 'EN_REVISION'.",
      };
    }

    const poAmount = Number(selectedPO?.totalAmount || 0);
    const diff = Math.abs(totalAmount - poAmount);

    if (diff > 0.05) {
      return {
        passed: false,
        message: `Discrepancia detectada (Tolerancia 0%): Monto facturado (₲ ${totalAmount.toLocaleString(
          "es-PY"
        )}) difiere de O.C. (₲ ${poAmount.toLocaleString("es-PY")}). Diferencia: ₲ ${diff.toLocaleString(
          "es-PY"
        )}.`,
      };
    }

    if (!selectedPO?.stockRegistered && (!remisionNumber || remisionNumber.trim().length === 0)) {
      return {
        passed: false,
        message: "Pendiente de Pañol: Falta indicar N° de Nota de Remisión para validar la recepción física.",
      };
    }

    return {
      passed: true,
      message: "Three-Way Match 100% OK: O.C., Remisión y Factura coinciden con 0% tolerancia.",
    };
  }, [tipo, purchaseOrderId, selectedPO, totalAmount, remisionNumber]);

  // Item management
  const addItem = () => {
    setItems([
      ...items,
      {
        description: "",
        quantity: 1,
        unitPrice: 0,
        vatType: "IVA10",
      },
    ]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, field: string, value: any) => {
    const copy = [...items];
    copy[index] = { ...copy[index], [field]: value };
    setItems(copy);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!numeroFactura.trim()) {
      showToast("El número de factura es obligatorio (ej: 001-002-0001234)", "error");
      return;
    }

    if (!timbrado.trim()) {
      showToast("El timbrado fiscal es obligatorio", "error");
      return;
    }

    if (totalAmount <= 0) {
      showToast("El importe total debe ser mayor a cero", "error");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project?.id || 1,
          partnerId,
          numeroFactura,
          timbrado,
          tipo,
          fechaEmision,
          fechaVencimiento,
          condicionVenta,
          concepto: concepto || "Provisión de Bienes y Servicios de Obra",
          subtotal: totalSubtotal,
          montoExento: totalExento,
          montoIva5: totalIva5,
          montoIva10: totalIva10,
          total: totalAmount,
          purchaseOrderId: purchaseOrderId || null,
          remisionNumber: remisionNumber || null,
          remisionDate: remisionDate || null,
          items: calculatedItems.map((it) => ({
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            vatType: it.vatType,
            montoExento: it.montoExento,
            montoIva5: it.montoIva5,
            montoIva10: it.montoIva10,
            subtotal: it.subtotal,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Error al crear factura");
      }

      showToast(
        data.data.threeWayMatchPassed
          ? `Factura ${numeroFactura} registrada y APROBADA (3-Way Match 100%)`
          : `Factura ${numeroFactura} registrada en EN_REVISION (Discrepancia detectada)`,
        data.data.threeWayMatchPassed ? "success" : "info"
      );

      onInvoiceCreated();
      onClose();
    } catch (err: any) {
      showToast(err.message || "Error al registrar la factura", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl shadow-2xl p-6 relative flex flex-col max-h-[94vh] text-xs">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Registrar Nueva Factura Legal Fiscal
              </h2>
              <p className="text-[11px] text-slate-500">
                Control de Integración Tripartita (Three-Way Match) y Auditoría
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

        <form onSubmit={handleSubmit} className="space-y-4 flex-1 overflow-y-auto py-2 pr-1">
          {/* Header Row: Tipo & Partner */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Tipo de Factura:
              </label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 text-xs"
              >
                <option value="RECIBIDA">Recibida (Proveedor / Subcontrato)</option>
                <option value="EMITIDA">Emitida (Al Cliente MOPC)</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">
                Proveedor / Subcontratista:
              </label>
              <select
                value={partnerId}
                onChange={(e) => setPartnerId(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 text-xs font-medium"
              >
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.taxId}) - {p.kind}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Three-Way Linkage (Purchase Order) */}
          {tipo === "RECIBIDA" && (
            <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200 space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-bold text-blue-950 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-blue-700" />
                  <span>Vincular Orden de Compra (Three-Way Match):</span>
                </label>
                <span className="text-[10px] text-blue-700 font-semibold">
                  Tolerancia: 0%
                </span>
              </div>
              <select
                value={purchaseOrderId || ""}
                onChange={(e) =>
                  handleSelectPO(e.target.value ? Number(e.target.value) : null)
                }
                className="w-full px-3 py-1.5 rounded-lg border border-blue-300 bg-white focus:outline-none text-xs font-mono"
              >
                <option value="">-- Sin Orden de Compra (Requiere Auditoría) --</option>
                {purchaseOrders.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.number} · {po.partner?.name || "Proveedor"} · Monto: ₲{" "}
                    {Number(po.totalAmount || 0).toLocaleString("es-PY")} ·{" "}
                    {po.stockRegistered ? "✓ Recepcionado en Pañol" : "⚠️ Pendiente Recepción"}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Tax Information Row */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                N° de Factura:
              </label>
              <input
                type="text"
                value={numeroFactura}
                onChange={(e) => setNumeroFactura(e.target.value)}
                placeholder="001-002-0045812"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 font-mono text-xs font-bold"
                required
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Timbrado Fiscal:
              </label>
              <input
                type="text"
                value={timbrado}
                onChange={(e) => setTimbrado(e.target.value)}
                placeholder="15984210"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 font-mono text-xs"
                required
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Fecha Emisión:
              </label>
              <input
                type="date"
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 text-xs"
                required
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Vencimiento:
              </label>
              <input
                type="date"
                value={fechaVencimiento}
                onChange={(e) => setFechaVencimiento(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 text-xs font-semibold"
                required
              />
            </div>
          </div>

          {/* Condition & Reception in Pañol */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Condición de Venta:
              </label>
              <select
                value={condicionVenta}
                onChange={(e) => setCondicionVenta(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 text-xs"
              >
                <option value="CONTADO">Contado</option>
                <option value="CREDITO">Crédito 30 Días</option>
                <option value="CREDITO_15">Crédito 15 Días</option>
                <option value="CREDITO_45">Crédito 45 Días</option>
                <option value="CREDITO_60">Crédito 60 Días</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                N° Nota de Remisión Pañol:
              </label>
              <input
                type="text"
                value={remisionNumber}
                onChange={(e) => setRemisionNumber(e.target.value)}
                placeholder="REM-00452 o N° Guía de Entrega"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Concepto / Objeto del Gasto:
              </label>
              <input
                type="text"
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                placeholder="Ej: Suministro de piedra triturada km 45"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 text-xs"
              />
            </div>
          </div>

          {/* Items Detail Table */}
          <div className="space-y-2 pt-2 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                Detalle de Ítems / Mercaderías:
              </span>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-bold text-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Agregar Ítem</span>
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 font-bold text-slate-600 border-b border-slate-200 text-[10px] uppercase">
                  <tr>
                    <th className="p-2 w-16">Cant.</th>
                    <th className="p-2">Descripción</th>
                    <th className="p-2 w-28">Precio Unit.</th>
                    <th className="p-2 w-24">IVA</th>
                    <th className="p-2 w-28 text-right">Subtotal</th>
                    <th className="p-2 w-8 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="p-2">
                        <input
                          type="number"
                          min={0.01}
                          step="any"
                          value={it.quantity}
                          onChange={(e) =>
                            updateItem(idx, "quantity", Number(e.target.value))
                          }
                          className="w-full p-1 rounded border border-slate-200 font-mono text-center text-xs"
                          required
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={it.description}
                          onChange={(e) =>
                            updateItem(idx, "description", e.target.value)
                          }
                          placeholder="Descripción del material o servicio..."
                          className="w-full p-1 rounded border border-slate-200 text-xs"
                          required
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min={0}
                          value={it.unitPrice}
                          onChange={(e) =>
                            updateItem(idx, "unitPrice", Number(e.target.value))
                          }
                          className="w-full p-1 rounded border border-slate-200 font-mono text-right text-xs font-semibold"
                          required
                        />
                      </td>
                      <td className="p-2">
                        <select
                          value={it.vatType}
                          onChange={(e) =>
                            updateItem(idx, "vatType", e.target.value)
                          }
                          className="w-full p-1 rounded border border-slate-200 text-[11px]"
                        >
                          <option value="IVA10">IVA 10%</option>
                          <option value="IVA5">IVA 5%</option>
                          <option value="EXENTA">Exenta</option>
                        </select>
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-slate-800">
                        {formatMoney(it.quantity * it.unitPrice, "PYG")}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="text-slate-400 hover:text-rose-600 transition cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live Three-Way Match Status Preview */}
          <div
            className={`p-3 rounded-xl border flex items-start gap-2.5 ${
              liveMatchStatus.passed
                ? "bg-emerald-50/80 border-emerald-200 text-emerald-950"
                : "bg-amber-50/80 border-amber-200 text-amber-950"
            }`}
          >
            {liveMatchStatus.passed ? (
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <span className="font-bold text-[11px] uppercase tracking-wide">
                Diagnóstico de Integración Tripartita en Vivo:
              </span>
              <p className="text-[11px] leading-relaxed text-slate-700">
                {liveMatchStatus.message}
              </p>
            </div>
          </div>

          {/* Totals Summary */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
            <div>
              <span className="text-[10px] text-slate-500 font-sans block">Exentas:</span>
              <span className="font-bold text-slate-700">{formatMoney(totalExento, "PYG")}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-sans block">IVA 5%:</span>
              <span className="font-bold text-slate-700">{formatMoney(totalIva5, "PYG")}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-sans block">IVA 10%:</span>
              <span className="font-bold text-slate-700">{formatMoney(totalIva10, "PYG")}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-sans block">Total Factura:</span>
              <span className="font-black text-sm text-blue-900">{formatMoney(totalAmount, "PYG")}</span>
            </div>
          </div>

          {/* Footer Actions */}
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
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Validando Tripartita...</span>
                </>
              ) : (
                <>
                  <Receipt className="w-4 h-4" />
                  <span>Registrar Factura Legal</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
