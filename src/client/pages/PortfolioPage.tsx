import React, { useCallback, useEffect, useState } from "react";
import { Building2, ChevronRight, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { Health, Portfolio } from "../types";
import { DualBar } from "../ui/charts";
import { Button, Card, compactMoney, Dot, EmptyState, Page, PageHeader, pct, Stat, StatGrid, Tone } from "../ui";

export const HEALTH_TONE: Record<Health, Tone> = { good: "good", warn: "warn", bad: "bad", none: "neutral" };
export const HEALTH_LABEL: Record<Health, string> = {
  good: "En línea",
  warn: "Atención",
  bad: "Costo por encima del avance",
  none: "Sin presupuesto",
};

interface PortfolioPageProps {
  currency: "PYG" | "USD";
  userName?: string;
  onOpenProject: (id: number) => void;
  onCreateProject: () => void;
  onArchiveProject: (id: number, name: string) => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  refreshKey?: number;
}

/** Inicio: todas las obras con su semáforo. Un clic entra al resumen de la obra. */
export const PortfolioPage: React.FC<PortfolioPageProps> = ({
  currency,
  userName,
  onOpenProject,
  onCreateProject,
  onArchiveProject,
  showToast,
  refreshKey,
}) => {
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const money = (v: number) => compactMoney(v, currency);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getPortfolio());
    } catch (err: any) {
      showToast(err.message || "No se pudo cargar la cartera", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const t = data?.totals;

  return (
    <Page>
      <PageHeader
        eyebrow={userName ? `Hola, ${userName.split(" ")[0]}` : undefined}
        title="Todas las obras"
        help="Cómo viene cada obra: cuánto avanzó, cuánto costó y si da ganancia."
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onCreateProject}>
            Nueva obra
          </Button>
        }
      />

      {t && t.projects > 0 && (
        <StatGrid>
          <Stat label="Contratado" value={money(t.contract)} hint={`${t.projects} obra(s)`} />
          <Stat label="Certificado al cliente" value={money(t.certified)} hint={pct(t.budget > 0 ? t.certified / t.budget : 0) + " del presupuesto"} />
          <Stat
            label="Resultado a la fecha"
            value={money(t.result)}
            tone={t.result >= 0 ? "good" : "bad"}
            hint="Certificado menos costo incurrido"
          />
          <Stat
            label="Obras en riesgo"
            value={t.atRisk}
            tone={t.atRisk > 0 ? "bad" : "good"}
            hint="Costo más de 5 puntos por encima del avance"
          />
        </StatGrid>
      )}

      {!loading && data && data.projects.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title="Todavía no hay obras"
          help="Creá la primera obra e importá su presupuesto desde Excel."
          action={
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onCreateProject}>
              Nueva obra
            </Button>
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs font-medium text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-5 py-3">Obra</th>
                  <th className="px-3 py-3 text-right">Contrato</th>
                  <th className="w-56 px-3 py-3">Avance / costo</th>
                  <th className="px-3 py-3 text-right">Resultado</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-3 py-3 text-right">Pendientes</th>
                  <th className="w-16 px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {loading && !data && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                      Cargando obras…
                    </td>
                  </tr>
                )}
                {data?.projects.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => onOpenProject(p.id)}
                    className="group cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-slate-900">{p.name}</p>
                      <p className="text-xs text-slate-500">
                        {p.code}
                        {p.clientName ? ` · ${p.clientName}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3.5 text-right tabular-nums text-slate-700">
                      {p.contract > 0 ? money(p.contract) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-3.5">
                      {p.budget > 0 ? (
                        <div className="space-y-1">
                          <DualBar progress={p.progress} cost={p.costPct} />
                          <p className="text-[11px] text-slate-500">
                            Avance {pct(p.progress)} · Costo {pct(p.costPct)}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Falta importar el presupuesto</span>
                      )}
                    </td>
                    <td className={`px-3 py-3.5 text-right font-medium tabular-nums ${p.result >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {p.budget > 0 ? money(p.result) : "—"}
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="flex items-center gap-2 text-xs text-slate-700">
                        <Dot tone={HEALTH_TONE[p.health]} />
                        {HEALTH_LABEL[p.health]}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      {p.pendingCount > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{p.pendingCount}</span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`¿Archivar la obra "${p.name}"?`)) onArchiveProject(p.id, p.name);
                          }}
                          className="rounded-lg p-1.5 text-slate-300 opacity-0 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                          title="Archivar obra"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="text-xs text-slate-400">
        Barra superior: avance físico certificado. Barra inferior: costo incurrido (verde si va por debajo del avance, rojo si lo supera).
      </p>
    </Page>
  );
};
