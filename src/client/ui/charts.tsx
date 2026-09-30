/**
 * Gráficos livianos en SVG (sin dependencias). Pensados para leerse de un vistazo:
 * pocas series, etiquetas directas y colores con significado.
 */
import React, { useState } from "react";

export interface SeriesPoint {
  label: string; // ej. "2026-03"
  values: Record<string, number>;
}

export interface SeriesDef {
  key: string;
  label: string;
  color: string; // clase de trazo, ej. "stroke-emerald-500"
  fill: string; // clase de relleno para la leyenda, ej. "bg-emerald-500"
  /** Trazo discontinuo (ej. "6 4") para distinguir series sin usar color. */
  dash?: string;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y?.slice(2)}`;
}

/** Curva acumulada (por ejemplo certificado vs. costo). */
export function LineChart({
  points,
  series,
  format,
  height = 220,
  labelFormat = monthLabel,
}: {
  points: SeriesPoint[];
  series: SeriesDef[];
  format: (v: number) => string;
  height?: number;
  /** Texto del eje X a partir de la etiqueta del punto (por defecto "sep 26"). */
  labelFormat?: (label: string) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const pad = { top: 16, right: 16, bottom: 28, left: 8 };
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)));
  const x = (i: number) => pad.left + (points.length <= 1 ? 0.5 : i / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - v / max) * (height - pad.top - pad.bottom);

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">Todavía no hay movimientos para graficar.</p>;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.fill}`} />
            {s.label}
            {hover !== null && <strong className="tabular-nums text-slate-900">{format(points[hover].values[s.key] ?? 0)}</strong>}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={pad.left} x2={width - pad.right} y1={y(max * t)} y2={y(max * t)} className="stroke-slate-100" />
        ))}
        {series.map((s) => (
          <polyline
            key={s.key}
            fill="none"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={s.dash}
            className={s.color}
            points={points.map((p, i) => `${x(i)},${y(p.values[s.key] ?? 0)}`).join(" ")}
          />
        ))}
        {points.map((p, i) => (
          <g key={p.label}>
            <rect
              x={x(i) - (width / Math.max(points.length, 1)) / 2}
              y={0}
              width={width / Math.max(points.length, 1)}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            {(points.length <= 12 || i % Math.ceil(points.length / 12) === 0) && (
              <text x={x(i)} y={height - 8} textAnchor="middle" className="fill-slate-400 text-[11px]">
                {labelFormat(p.label)}
              </text>
            )}
          </g>
        ))}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom} className="stroke-slate-300" strokeDasharray="3 3" />
        )}
      </svg>
    </div>
  );
}

/** Dos barras horizontales superpuestas: avance (relleno) vs. costo (marca). */
export function DualBar({ progress, cost }: { progress: number; cost: number }) {
  const p = Math.max(0, Math.min(1, progress)) * 100;
  const c = Math.max(0, Math.min(1.2, cost)) * (100 / 1.2) * 1.2;
  const costTone = cost - progress > 0.05 ? "bg-rose-500" : cost - progress > 0 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${p}%` }} />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${costTone}`} style={{ width: `${Math.min(100, c)}%` }} />
      </div>
    </div>
  );
}
