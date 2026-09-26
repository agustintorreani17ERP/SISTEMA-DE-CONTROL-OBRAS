import React, { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { api } from "../api";
import { PendingItem, Project, ProjectOverview } from "../types";
import { LineChart } from "../ui/charts";
import { Button, Card, compactMoney, Dot, EmptyState, Page, PageHeader, pct, ProgressBar, Stat, StatGrid } from "../ui";
import { HEALTH_LABEL, HEALTH_TONE } from "./PortfolioPage";

interface OverviewPageProps {
  project: Project;
  currency: "PYG" | "USD";
  onNavigate: (tab: PendingItem["tab"], subTab?: string) => void;
  onImportBudget: () => void;
  refreshKey?: number;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

/**
 * Resumen de la obra para el jefe. Cuatro preguntas: ¿cuánto avancé?, ¿cuánto gasté?,
 * ¿gano o pierdo? y ¿cuánto me queda? Más lo que se está pasando y lo que hay que resolver.
 */
export const OverviewPage: React.FC<OverviewPageProps> = ({
  project,
  currency,
  onNavigate,
  onImportBudget,
  refreshKey,
  showToast,
}) => {
  const [data, setData] = useState<ProjectOverview | null>(null);
  const money = (v: number) => compactMoney(v, currency);

  const load = useCallback(async () => {
    try {
      setData(await api.getProjectOverview(project.id));
    } catch (err: any) {
      showToast(err.message || "No se pudo cargar el resumen", "error");
    }
  }, [project.id, showToast]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const header = (
    <PageHeader
      eyebrow={`${project.code}${project.clientName ? ` · ${project.clientName}` : ""}`}
      title={project.name}
      help={data?.kpis.contract ? `Contrato ${money(data.kpis.contract)}` : undefined}
    />
  );

  if (!data) {
    return (
      <Page>
        {header}
        <p className="text-sm text-slate-400">Cargando resumen…</p>
      </Page>
    );
  }

  if (!data.hasBudget) {
    return (
      <Page>
        {header}
        <EmptyState
          icon={<FileSpreadsheet className="h-10 w-10" />}
          title="Importá el presupuesto para empezar"
          help="Con el presupuesto cargado se fija el monto del contrato y se empiezan a descontar compras, certificados y gastos."
          action={
            <Button variant="primary" onClick={onImportBudget}>
              Importar presupuesto
            </Button>
          }
        />
      </Page>
    );
  }

  const k = data.kpis;
  return (
    <Page>
      {header}

      <StatGrid>
        <Stat label="Avance físico" value={pct(k.progress)} tone="brand" hint={`${money(k.certified)} certificados`}>
          <ProgressBar value={k.progress} tone="brand" />
        </Stat>
        <Stat
          label="Costo ejecutado"
          value={pct(k.costPct)}
          tone={HEALTH_TONE[k.health]}
          hint={`${money(k.actual)} gastados · ${HEALTH_LABEL[k.health].toLowerCase()}`}
        >
          <ProgressBar value={k.costPct} tone={HEALTH_TONE[k.health]} />
        </Stat>
        <Stat
          label="Resultado a la fecha"
          value={money(k.result)}
          tone={k.result >= 0 ? "good" : "bad"}
          hint="Certificado menos costo. Puede ser negativo al inicio por acopio."
        />
        <Stat
          label="Saldo del presupuesto"
          value={money(k.balance)}
          tone={k.balance < 0 ? "bad" : "neutral"}
          hint={k.overBudgetItems ? `${k.overBudgetItems} partida(s) excedida(s)` : "Sin partidas excedidas"}
        />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Certificado vs. costo (acumulado)" className="lg:col-span-2">
          <LineChart
            points={data.curve}
            format={money}
            series={[
              { key: "certified", label: "Certificado al cliente", color: "stroke-brand-500", fill: "bg-brand-500" },
              { key: "cost", label: "Costo incurrido", color: "stroke-amber-500", fill: "bg-amber-500" },
            ]}
          />
          <p className="mt-2 text-xs text-slate-500">Si la línea naranja pasa a la azul, la obra está gastando más de lo que certifica.</p>
        </Card>

        <Card title="Para resolver">
          {data.pending.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Nada pendiente.
            </p>
          ) : (
            <ul className="-my-1 divide-y divide-slate-100">
              {data.pending.map((p) => (
                <li key={p.key}>
                  <button
                    onClick={() => onNavigate(p.tab, p.subTab)}
                    className="group flex w-full items-center gap-3 py-2.5 text-left text-sm"
                  >
                    <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">
                      {p.count}
                    </span>
                    <span className="flex-1 text-slate-700 group-hover:text-slate-900">{p.label}</span>
                    <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-brand-600" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title="Rubros con más consumo"
          className="lg:col-span-2"
          action={
            <Button size="sm" variant="ghost" onClick={() => onNavigate("centro-costos")}>
              Ver centro de costos
            </Button>
          }
        >
          {data.topRubros.length === 0 ? (
            <p className="text-sm text-slate-400">Todavía no hay compras ni certificados imputados.</p>
          ) : (
            <ul className="space-y-3">
              {data.topRubros.map((r) => {
                const tone = r.overBudget ? "bad" : r.usage - r.progress > 0.05 ? "warn" : "good";
                return (
                  <li key={r.id} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <Dot tone={tone} />
                        <span className="truncate text-slate-800">{r.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        {money(r.committed)} de {money(r.budget)} · <strong className="text-slate-800">{pct(r.usage)}</strong>
                      </span>
                    </div>
                    <ProgressBar value={Math.min(1, r.usage)} tone={tone} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Caja">
          <dl className="space-y-4">
            <div>
              <dt className="text-xs text-slate-500">Por cobrar al comitente</dt>
              <dd className="text-xl font-semibold tabular-nums text-slate-900">{money(data.cash.receivable)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Por pagar a proveedores</dt>
              <dd className="text-xl font-semibold tabular-nums text-slate-900">{money(data.cash.payable)}</dd>
            </div>
          </dl>
          <Button size="sm" variant="ghost" className="mt-3 -ml-2" onClick={() => onNavigate("contabilidad-finanzas")}>
            Ver finanzas
          </Button>
        </Card>
      </div>
    </Page>
  );
};
