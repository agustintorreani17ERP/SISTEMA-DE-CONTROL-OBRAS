import React from "react";
import { Printer } from "lucide-react";
import { Button, Modal } from "../ui";

export interface PrintLine {
  code?: string;
  description: string;
  unit?: string;
  quantity: string;
  unitPrice?: string;
  subtotal?: string;
  budget?: string;
}

/** Comprobante A4 genérico (pedido u orden de compra) con firmas. */
/** Imprime solo el área .print-area (el resto de la pantalla queda oculto). */
function printDocument() {
  document.body.classList.add("print-doc");
  window.addEventListener("afterprint", () => document.body.classList.remove("print-doc"), { once: true });
  window.print();
}

export function PrintableDocument({
  title,
  number,
  meta,
  lines,
  total,
  signatures,
  onClose,
}: {
  title: string;
  number: string;
  meta: { label: string; value: React.ReactNode }[];
  lines: PrintLine[];
  total?: string;
  signatures: string[];
  onClose: () => void;
}) {
  const withPrices = lines.some((l) => l.unitPrice);
  return (
    <Modal
      title={`${title} ${number}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cerrar</Button>
          <Button variant="primary" icon={<Printer className="h-4 w-4" />} onClick={printDocument}>
            Imprimir / PDF
          </Button>
        </>
      }
    >
      <div className="print-area space-y-5 text-sm text-slate-800">
        <div className="flex items-start justify-between border-b border-slate-300 pb-3">
          <div>
            <p className="text-lg font-semibold">{title}</p>
            <p className="text-slate-500">N° {number}</p>
          </div>
          <p className="text-xs text-slate-500">Emitido {new Date().toLocaleDateString("es-PY")}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          {meta.map((m) => (
            <div key={m.label} className="flex gap-2">
              <dt className="w-28 shrink-0 text-slate-500">{m.label}</dt>
              <dd className="font-medium">{m.value}</dd>
            </div>
          ))}
        </dl>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-y border-slate-300 bg-slate-50 text-left">
              <th className="px-2 py-1.5">Código</th>
              <th className="px-2 py-1.5">Descripción</th>
              <th className="px-2 py-1.5">Rubro</th>
              <th className="px-2 py-1.5 text-right">Cantidad</th>
              {withPrices && <th className="px-2 py-1.5 text-right">P. unit.</th>}
              {withPrices && <th className="px-2 py-1.5 text-right">Subtotal</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-slate-200">
                <td className="px-2 py-1.5">{l.code}</td>
                <td className="px-2 py-1.5">{l.description}</td>
                <td className="px-2 py-1.5 text-slate-500">{l.budget ?? "—"}</td>
                <td className="px-2 py-1.5 text-right">
                  {l.quantity} {l.unit}
                </td>
                {withPrices && <td className="px-2 py-1.5 text-right">{l.unitPrice}</td>}
                {withPrices && <td className="px-2 py-1.5 text-right">{l.subtotal}</td>}
              </tr>
            ))}
          </tbody>
          {total && (
            <tfoot>
              <tr>
                <td colSpan={withPrices ? 5 : 3} className="px-2 py-2 text-right font-semibold">
                  Total
                </td>
                <td className="px-2 py-2 text-right font-semibold">{total}</td>
              </tr>
            </tfoot>
          )}
        </table>
        <div className="grid grid-cols-3 gap-6 pt-12 text-center text-xs text-slate-500">
          {signatures.map((s) => (
            <div key={s} className="border-t border-slate-400 pt-1.5">
              {s}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
