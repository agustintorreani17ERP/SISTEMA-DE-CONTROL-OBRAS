import React, { useState } from "react";
import {
  Printer,
  Send,
  X,
  CheckCircle2,
  AlertTriangle,
  Building2,
  FileCheck2,
  ShieldCheck,
  Download,
  Loader2,
  Mail,
} from "lucide-react";
import { formatMoney, formatDate } from "../utils/format";
import { numeroALetrasGuaranies } from "../utils/numberToWords";

interface LegalInvoiceA4ModalProps {
  invoice: any;
  project?: any;
  onClose: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const LegalInvoiceA4Modal: React.FC<LegalInvoiceA4ModalProps> = ({
  invoice,
  project,
  onClose,
  showToast,
}) => {
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailTo, setEmailTo] = useState(
    invoice?.partner?.email || "administracion@proveedor.com.py"
  );
  const [emailSubject, setEmailSubject] = useState(
    `Comprobante Legal - Factura N° ${invoice?.numeroFactura} - Obra ${project?.code || "CCC"}`
  );

  const total = Number(invoice?.total || 0);
  const subtotal = Number(invoice?.subtotal || total - (invoice?.montoIva10 || 0));
  const montoIva10 = Number(invoice?.montoIva10 || Math.round(total / 11));
  const montoIva5 = Number(invoice?.montoIva5 || 0);
  const montoExento = Number(invoice?.montoExento || 0);
  const totalIva = montoIva5 + montoIva10;

  const totalEnLetras = numeroALetrasGuaranies(total);

  const handlePrint = () => {
    window.print();
  };

  const handleSendEmail = async () => {
    setSendingEmail(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmail: emailTo,
          subject: emailSubject,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Error al enviar correo");
      }

      showToast(`Factura ${invoice.numeroFactura} enviada con éxito a ${emailTo}`, "success");
      setShowEmailDialog(false);
    } catch (err: any) {
      showToast(err.message || "No se pudo enviar el correo", "error");
    } finally {
      setSendingEmail(false);
    }
  };

  // Determine issuer & customer based on invoice type
  const isEmitida = invoice.tipo === "EMITIDA";
  const emisorNombre = isEmitida
    ? "CONSORCIO DE CONSTRUCCIONES CIVILES S.A. (CCC S.A.)"
    : invoice.partner?.name || "PROVEEDOR VIAL S.A.";
  const emisorRuc = isEmitida
    ? "80034567-8"
    : invoice.partner?.taxId || "80012345-6";
  const emisorDireccion = isEmitida
    ? "Avda. Aviadores del Chaco 2050 esq. Santa Teresa - Asunción, Paraguay"
    : invoice.partner?.fiscalAddress || "Ruta D027 km 38, Ypacaraí - Paraguay";
  const emisorTelefono = isEmitida ? "(+595 21) 612-400" : invoice.partner?.phone || "(+595 21) 582-410";

  const clienteNombre = isEmitida
    ? invoice.partner?.name || project?.clientName || "MOPC - Ministerio de Obras Públicas y Comunicaciones"
    : "CONSORCIO DE CONSTRUCCIONES CIVILES S.A. (CCC S.A.)";
  const clienteRuc = isEmitida ? invoice.partner?.taxId || "80024501-1" : "80034567-8";
  const clienteDireccion = isEmitida
    ? "Oliva y Alberdi, Asunción - Paraguay"
    : `Campamento de Obra ${project?.code || "Ruta PY02"}, km 45 - Cordillera`;

  const items =
    invoice.items && invoice.items.length > 0
      ? invoice.items
      : [
          {
            description: invoice.concepto || "Servicios y Materiales de Infraestructura Vial",
            quantity: 1,
            unitPrice: total,
            vatType: "IVA10",
            montoExento,
            montoIva5,
            montoIva10,
            subtotal: total,
          },
        ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto print:p-0 print:bg-white print:static">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-invoice, #printable-invoice * {
            visibility: visible;
          }
          #printable-invoice {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 20px;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="bg-slate-100 rounded-2xl w-full max-w-4xl max-h-[96vh] flex flex-col shadow-2xl border border-slate-300 print:border-none print:shadow-none print:max-w-none print:h-auto print:max-h-none print:bg-white">
        {/* Action Header - Not Printed */}
        <div className="no-print bg-white p-3 sm:px-6 sm:py-3.5 border-b border-slate-200 rounded-t-2xl flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <FileCheck2 className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Factura Legal Fiscal (Formato A4 Oficial DNIT)
              </h2>
              <p className="text-[11px] text-slate-500 font-mono">
                N° {invoice.numeroFactura} · Timbrado {invoice.timbrado}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEmailDialog(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-xs transition cursor-pointer"
              title="Enviar por correo electrónico"
            >
              <Mail className="w-4 h-4" />
              <span className="hidden sm:inline">Enviar por Email</span>
            </button>

            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir A4</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Document Container */}
        <div className="p-3 sm:p-6 overflow-y-auto flex justify-center print:p-0 print:overflow-visible">
          {/* A4 Sheet Container */}
          <div
            id="printable-invoice"
            className="w-full max-w-[800px] bg-white border border-slate-400 p-6 sm:p-8 shadow-md text-slate-900 font-sans text-xs print:shadow-none print:border-none print:p-4"
          >
            {/* Top Box: Issuer on Left, Tax Box on Right */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 pb-4 border-b-2 border-slate-900">
              {/* Left Column: Issuer Logo and Corporate Identity */}
              <div className="sm:col-span-7 flex flex-col justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-blue-900 text-white flex items-center justify-center font-black text-xl shadow-xs shrink-0">
                    CCC
                  </div>
                  <div>
                    <h1 className="font-extrabold text-sm text-slate-900 uppercase tracking-tight">
                      {emisorNombre}
                    </h1>
                    <p className="text-[10px] text-slate-600 font-medium">
                      Obras Viales · Asfaltos · Movimiento de Suelos · Hormigón
                    </p>
                  </div>
                </div>

                <div className="mt-3 text-[10px] text-slate-600 space-y-0.5">
                  <p>
                    <strong>Casa Central:</strong> {emisorDireccion}
                  </p>
                  <p>
                    <strong>Teléfono:</strong> {emisorTelefono} | <strong>Email:</strong> administracion@ccc-vial.com.py
                  </p>
                  <p>
                    <strong>Actividad Económica:</strong> Construcción de Obras de Ingeniería Civil y Vial
                  </p>
                </div>
              </div>

              {/* Right Column: Official Legal Tax Box (Timbrado & Invoice Number) */}
              <div className="sm:col-span-5 border-2 border-slate-900 p-3 rounded-lg text-center bg-slate-50/50 flex flex-col justify-center space-y-1">
                <div className="font-mono font-extrabold text-xs tracking-wider text-slate-900">
                  R.U.C.: {emisorRuc}
                </div>
                <div className="font-bold text-[11px] text-slate-700 uppercase">
                  TIMBRADO N°: <span className="font-mono">{invoice.timbrado}</span>
                </div>
                <div className="text-[9px] text-slate-500">
                  Inicio de Vigencia: 01/01/2026 · Vencimiento: 31/12/2026
                </div>
                <div className="text-[11px] font-black uppercase text-blue-900 pt-1 border-t border-slate-300">
                  FACTURA
                </div>
                <div className="font-mono font-black text-base text-slate-900 tracking-wider">
                  N° {invoice.numeroFactura}
                </div>
              </div>
            </div>

            {/* Customer & Transaction Meta Data */}
            <div className="mt-3 p-3 border border-slate-400 rounded-md text-[11px] space-y-2 bg-slate-50/30">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <div className="sm:col-span-4">
                  <span className="font-bold text-slate-700">Fecha de Emisión: </span>
                  <span className="font-mono font-semibold">
                    {formatDate(invoice.fechaEmision || new Date().toISOString())}
                  </span>
                </div>
                <div className="sm:col-span-5">
                  <span className="font-bold text-slate-700">Condición de Venta: </span>
                  <span className="font-bold uppercase text-slate-900">
                    {invoice.condicionVenta || "CRÉDITO 30 DÍAS"}
                  </span>
                </div>
                <div className="sm:col-span-3 text-sm:right">
                  <span className="font-bold text-slate-700">Vencimiento: </span>
                  <span className="font-mono font-semibold text-slate-800">
                    {formatDate(invoice.fechaVencimiento || new Date().toISOString())}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1 border-t border-slate-200">
                <div className="sm:col-span-8">
                  <span className="font-bold text-slate-700">Nombre / Razón Social: </span>
                  <span className="font-bold text-slate-900 uppercase">{clienteNombre}</span>
                </div>
                <div className="sm:col-span-4">
                  <span className="font-bold text-slate-700">R.U.C. / C.I.: </span>
                  <span className="font-mono font-bold text-slate-900">{clienteRuc}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <div className="sm:col-span-8">
                  <span className="font-bold text-slate-700">Dirección: </span>
                  <span className="text-slate-800">{clienteDireccion}</span>
                </div>
                <div className="sm:col-span-4">
                  <span className="font-bold text-slate-700">Nota de Remisión N°: </span>
                  <span className="font-mono font-bold text-blue-900">
                    {invoice.remisionNumber || "N/A - CERT. SERVICIOS"}
                  </span>
                </div>
              </div>

              {/* Order / Contract Reference */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1 border-t border-slate-200 text-[10px] text-slate-600">
                <div className="sm:col-span-6">
                  <strong>Referencia / Documento Origen: </strong>
                  <span className="font-mono font-bold text-slate-800">
                    {invoice.purchaseOrder?.number
                      ? `Orden de Compra ${invoice.purchaseOrder.number}`
                      : invoice.certificacionId
                      ? `Certificado de Avance #${invoice.certificacionId}`
                      : "Contrato Principal de Obra"}
                  </span>
                </div>
                <div className="sm:col-span-6">
                  <strong>Proyecto / Centro de Costos: </strong>
                  <span className="font-bold text-slate-800">
                    {project?.code || "OBRA-PY02"} · {project?.name || "Duplicación Ruta PY02"}
                  </span>
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="mt-3 border border-slate-900 rounded-sm overflow-hidden">
              <table className="w-full text-left text-[10px] border-collapse">
                <thead className="bg-slate-100 font-bold uppercase text-slate-800 border-b border-slate-900">
                  <tr>
                    <th className="p-2 border-r border-slate-300 w-14 text-center">Cant.</th>
                    <th className="p-2 border-r border-slate-300">Descripción / Concepto</th>
                    <th className="p-2 border-r border-slate-300 w-24 text-right">Precio Unit.</th>
                    <th className="p-2 border-r border-slate-300 w-20 text-right">Exentas</th>
                    <th className="p-2 border-r border-slate-300 w-20 text-right">5%</th>
                    <th className="p-2 w-24 text-right">10%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono">
                  {items.map((item: any, idx: number) => {
                    const isIva5 = item.vatType === "IVA5";
                    const isExento = item.vatType === "EXENTA";
                    const sub = Number(item.subtotal || item.quantity * item.unitPrice || 0);

                    return (
                      <tr key={idx} className="min-h-[28px]">
                        <td className="p-2 border-r border-slate-300 text-center">
                          {Number(item.quantity).toLocaleString("es-PY")}
                        </td>
                        <td className="p-2 border-r border-slate-300 font-sans text-[11px] text-slate-900">
                          {item.description}
                        </td>
                        <td className="p-2 border-r border-slate-300 text-right">
                          {formatMoney(Number(item.unitPrice), "PYG")}
                        </td>
                        <td className="p-2 border-r border-slate-300 text-right text-slate-400">
                          {isExento ? formatMoney(sub, "PYG") : "-"}
                        </td>
                        <td className="p-2 border-r border-slate-300 text-right text-slate-400">
                          {isIva5 ? formatMoney(sub, "PYG") : "-"}
                        </td>
                        <td className="p-2 text-right font-bold text-slate-900">
                          {!isExento && !isIva5 ? formatMoney(sub, "PYG") : "-"}
                        </td>
                      </tr>
                    );
                  })}

                  {/* Empty rows to complete visual layout height */}
                  {items.length < 3 &&
                    Array.from({ length: 3 - items.length }).map((_, i) => (
                      <tr key={`empty-${i}`} className="h-6">
                        <td className="border-r border-slate-300">&nbsp;</td>
                        <td className="border-r border-slate-300">&nbsp;</td>
                        <td className="border-r border-slate-300">&nbsp;</td>
                        <td className="border-r border-slate-300">&nbsp;</td>
                        <td className="border-r border-slate-300">&nbsp;</td>
                        <td>&nbsp;</td>
                      </tr>
                    ))}
                </tbody>
              </table>

              {/* Subtotal row */}
              <div className="flex border-t border-slate-900 bg-slate-50 text-[10px] font-mono">
                <div className="p-2 font-bold font-sans uppercase text-slate-700 flex-1">
                  SUBTOTALES:
                </div>
                <div className="w-20 p-2 border-l border-slate-300 text-right font-bold text-slate-600">
                  {montoExento > 0 ? formatMoney(montoExento, "PYG") : "-"}
                </div>
                <div className="w-20 p-2 border-l border-slate-300 text-right font-bold text-slate-600">
                  {montoIva5 > 0 ? formatMoney(montoIva5, "PYG") : "-"}
                </div>
                <div className="w-24 p-2 border-l border-slate-300 text-right font-bold text-slate-900">
                  {formatMoney(total, "PYG")}
                </div>
              </div>
            </div>

            {/* Total in Words & Numeric Total Box */}
            <div className="mt-3 border border-slate-900 rounded-sm p-2.5 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="space-y-1 flex-1">
                <div className="text-[9px] uppercase font-bold text-slate-500">
                  VALOR EN LETRAS (GUARANÍES):
                </div>
                <div className="font-extrabold text-[11px] text-slate-900 uppercase tracking-tight">
                  {totalEnLetras}
                </div>
              </div>

              <div className="border-2 border-slate-900 rounded-md p-2 bg-white text-right shrink-0 min-w-[200px]">
                <div className="text-[9px] uppercase font-bold text-slate-500">
                  TOTAL A PAGAR:
                </div>
                <div className="font-mono font-black text-base text-slate-900">
                  ₲ {total.toLocaleString("es-PY")}
                </div>
              </div>
            </div>

            {/* Liquidación del IVA */}
            <div className="mt-2 border border-slate-400 rounded-sm p-2 text-[10px] grid grid-cols-3 gap-2 font-mono bg-white">
              <div>
                <span className="font-sans font-bold text-slate-600">LIQUIDACIÓN IVA (5%): </span>
                <span className="font-bold text-slate-800">
                  {formatMoney(montoIva5, "PYG")}
                </span>
              </div>
              <div>
                <span className="font-sans font-bold text-slate-600">LIQUIDACIÓN IVA (10%): </span>
                <span className="font-bold text-slate-800">
                  {formatMoney(montoIva10, "PYG")}
                </span>
              </div>
              <div className="text-right">
                <span className="font-sans font-bold text-slate-600">TOTAL IVA: </span>
                <span className="font-extrabold text-slate-900">
                  {formatMoney(totalIva, "PYG")}
                </span>
              </div>
            </div>

            {/* THREE-WAY MATCH AUDIT SEAL & SIGNATURES */}
            <div className="mt-4 pt-3 border-t-2 border-dashed border-slate-400 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
              {/* Three-Way Match Verification Seal */}
              <div className="sm:col-span-7">
                <div
                  className={`p-3 rounded-xl border-2 flex items-start gap-3 ${
                    invoice.threeWayMatchPassed
                      ? "border-emerald-600 bg-emerald-50/60 text-emerald-950"
                      : "border-amber-500 bg-amber-50/60 text-amber-950"
                  }`}
                >
                  <div className="p-2 rounded-lg bg-white border border-slate-200 shadow-xs shrink-0">
                    <ShieldCheck
                      className={`w-6 h-6 ${
                        invoice.threeWayMatchPassed ? "text-emerald-600" : "text-amber-600"
                      }`}
                    />
                  </div>
                  <div className="space-y-0.5 text-[10px]">
                    <div className="font-black uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <span>INTEGRACIÓN TRIPARTITA (THREE-WAY MATCH)</span>
                      {invoice.threeWayMatchPassed ? (
                        <span className="px-1.5 py-0.2 bg-emerald-600 text-white rounded font-mono text-[9px]">
                          VALIDADO 100%
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.2 bg-amber-600 text-white rounded font-mono text-[9px]">
                          EN REVISIÓN
                        </span>
                      )}
                    </div>
                    <p className="leading-snug text-slate-700">
                      {invoice.matchNotes ||
                        (invoice.threeWayMatchPassed
                          ? "Orden de Compra, Remisión de Pañol y Factura verificadas con tolerancia 0%."
                          : "Pendiente de validación cruzada con Pañol o Contrato.")}
                    </p>
                    <div className="text-[9px] text-slate-500 font-mono pt-1">
                      Hash Auditoría: SHA-256: 8F4C2...E912 · Fiscalización de Obra
                    </div>
                  </div>
                </div>
              </div>

              {/* Signatures Box */}
              <div className="sm:col-span-5 grid grid-cols-2 gap-2 text-center text-[9px] text-slate-600">
                <div className="border-t border-slate-400 pt-6">
                  <p className="font-bold uppercase text-slate-800">Ing. Ana Urbina</p>
                  <p>Jefe de Obra Vial</p>
                </div>
                <div className="border-t border-slate-400 pt-6">
                  <p className="font-bold uppercase text-slate-800">Lic. María Gómez</p>
                  <p>Auditoría / Pagos</p>
                </div>
              </div>
            </div>

            {/* Footer Notice */}
            <div className="mt-4 pt-2 border-t border-slate-200 text-[9px] text-slate-400 text-center uppercase tracking-wider">
              Original: Comprador / Archivo Contable · Duplicado: Proveedor / Emisor · Triplicado: Fiscalización
            </div>
          </div>
        </div>

        {/* Email Sending Dialog */}
        {showEmailDialog && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs no-print">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-blue-600" />
                  <h3 className="font-bold text-sm text-slate-900">
                    Enviar Factura Legal por Correo
                  </h3>
                </div>
                <button
                  onClick={() => setShowEmailDialog(false)}
                  className="text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Destinatario (Email):
                  </label>
                  <input
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 font-mono text-xs"
                    placeholder="ejemplo@proveedor.com.py"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Asunto del Correo:
                  </label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 text-xs"
                  />
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
                  <p>
                    Se adjuntará la <strong>Factura Legal N° {invoice.numeroFactura}</strong> en
                    formato PDF Oficial con el sello de auditoría{" "}
                    <strong>Three-Way Match</strong> y constancia de liquidación.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEmailDialog(false)}
                  className="px-3.5 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold text-xs cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSendEmail}
                  disabled={sendingEmail || !emailTo}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {sendingEmail ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Enviando...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Enviar Comprobante</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
