import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { api } from "../api";
import { fmtDate } from "../compras/status";

/** "Cerrado hasta dd/mm/aaaa": lo cerrado no se edita y los documentos tardíos entran el día siguiente. */
export function CierreBanner({ projectId, refreshKey }: { projectId: number; refreshKey?: number }) {
  const [hasta, setHasta] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    api
      .getCerradoHasta(projectId)
      .then((r) => vivo && setHasta(r.hasta))
      .catch(() => vivo && setHasta(null));
    return () => {
      vivo = false;
    };
  }, [projectId, refreshKey]);
  if (!hasta) return null;
  return (
    <div className="mx-auto mb-4 flex max-w-7xl items-center gap-2 border border-slate-300 px-3 py-2 text-sm text-slate-900">
      <Lock className="h-4 w-4" />
      <span className="font-semibold">Cerrado hasta {fmtDate(hasta)}</span>
      <span className="text-slate-600">
        · Partes y mediciones anteriores no se editan; compras y documentos con fecha anterior se contabilizan el día siguiente al cierre.
      </span>
    </div>
  );
}
