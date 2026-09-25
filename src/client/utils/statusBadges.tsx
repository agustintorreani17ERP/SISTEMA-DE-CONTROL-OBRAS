import React from "react";
import { CheckCircle2, Clock, AlertTriangle, XCircle, ShieldCheck, ArrowDownLeft, ArrowUpRight, SlidersHorizontal } from "lucide-react";

export function getStatusBadge(status?: string | null) {
  switch (status) {
    case "BORRADOR":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-stone-100 text-stone-700 border border-stone-300">
          <Clock className="w-3 h-3 text-stone-500" />
          Borrador
        </span>
      );
    case "APROBADO_PARA_COMPRA":
    case "APROBADA":
    case "APROBADO":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <ShieldCheck className="w-3 h-3 text-blue-600" />
          Aprobado para Compra
        </span>
      );
    case "EMITIDA":
    case "CERTIFICADO":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300">
          <Clock className="w-3 h-3 text-amber-600" />
          Emitida / Comprometida
        </span>
      );
    case "RECIBIDO":
    case "PAGADO":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          Recibido / Ejecutado
        </span>
      );
    case "ANULADO":
    case "CANCELADO":
    case "RECHAZADA":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          <XCircle className="w-3 h-3 text-rose-500" />
          Anulado
        </span>
      );
    case "ACTIVO":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          Activo
        </span>
      );
    case "EN_REVISION":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-300">
          <Clock className="w-3 h-3 text-amber-600" />
          En Revisión
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-stone-100 text-stone-600">
          {status || "Sin estado"}
        </span>
      );
  }
}

export function getMovementBadge(type: string) {
  switch (type) {
    case "RECEIPT":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
          <ArrowDownLeft className="w-3 h-3" />
          Ingreso (OC)
        </span>
      );
    case "CONSUMPTION":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
          <ArrowUpRight className="w-3 h-3" />
          Salida a Frente
        </span>
      );
    case "ADJUSTMENT":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
          <SlidersHorizontal className="w-3 h-3" />
          Ajuste
        </span>
      );
    default:
      return <span className="text-xs text-stone-600">{type}</span>;
  }
}
