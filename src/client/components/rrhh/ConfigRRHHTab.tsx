import React, { useState, useEffect, useCallback } from "react";
import { Save } from "lucide-react";
import { api } from "../../api";
import { CostoHoraData, Project, RRHHConfig } from "../../types";
import { Card, Field, Button, inputClass, cx } from "../../ui";
import { formatGs, formatQty } from "../../utils/numbers";

interface Props {
  project: Project;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

const TIPO = { MENSUALERO: "Mensualero", JORNALERO: "Jornalero", DESTAJISTA: "Destajista" } as const;

export const ConfigRRHHTab: React.FC<Props> = ({ project, showToast }) => {
  const [cfg, setCfg] = useState<RRHHConfig>({
    pctIpsObrero: 9,
    pctIpsPatronal: 16.5,
    factorHoraExtra: 1.5,
    horasDiasLaborales: 8,
    bonificacionFamiliar: 0,
    aguinaldoMeses: 12,
    pctVacaciones: 4.17,
    pctOtrasCargas: 0,
    diasLaboralesMes: 26,
  });
  const [saving, setSaving] = useState(false);
  const [costos, setCostos] = useState<CostoHoraData | null>(null);
  const [manual, setManual] = useState<Record<number, string>>({});

  const loadCostos = useCallback(() => {
    api
      .getCostoHora(project.id)
      .then(setCostos)
      .catch((e) => showToast(e.message, "error"));
  }, [project.id, showToast]);

  useEffect(() => {
    api.getRRHHConfig(project.id).then((c) => {
      if (c) setCfg((prev) => ({ ...prev, ...c }));
    });
    loadCostos();
  }, [project.id, loadCostos]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveRRHHConfig(
        {
          pctIpsObrero: Number(cfg.pctIpsObrero),
          pctIpsPatronal: Number(cfg.pctIpsPatronal),
          factorHoraExtra: Number(cfg.factorHoraExtra),
          horasDiasLaborales: Number(cfg.horasDiasLaborales),
          bonificacionFamiliar: Number(cfg.bonificacionFamiliar),
          aguinaldoMeses: Number(cfg.aguinaldoMeses),
          pctVacaciones: Number(cfg.pctVacaciones ?? 0),
          pctOtrasCargas: Number(cfg.pctOtrasCargas ?? 0),
          diasLaboralesMes: Number(cfg.diasLaboralesMes ?? 26),
        },
        project.id
      );
      showToast("Configuración guardada", "success");
      loadCostos();
    } catch (e: any) {
      showToast(e.message || "Error al guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveManual = async (id: number) => {
    const raw = (manual[id] ?? "").trim().replace(/\./g, "").replace(",", ".");
    const value = raw ? Number(raw) : null;
    if (value !== null && !(value > 0)) return showToast("Costo hora inválido", "error");
    try {
      await api.updateEmpleado(id, { costoHoraManual: value });
      setManual((m) => {
        const n = { ...m };
        delete n[id];
        return n;
      });
      loadCostos();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const set = (k: keyof RRHHConfig) => (e: React.ChangeEvent<HTMLInputElement>) => setCfg({ ...cfg, [k]: e.target.value });

  // Vista previa de las cargas con los valores del formulario (antes de guardar)
  const aguinaldoPct = Number(cfg.aguinaldoMeses) > 0 ? 100 / Number(cfg.aguinaldoMeses) : 0;
  const totalCargas = Number(cfg.pctIpsPatronal) + aguinaldoPct + Number(cfg.pctVacaciones ?? 0) + Number(cfg.pctOtrasCargas ?? 0);

  return (
    <div className="space-y-4 text-slate-900">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Parámetros de liquidación y costo hora"
          action={
            <Button variant="primary" icon={<Save className="w-4 h-4" />} onClick={handleSave} disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="IPS obrero (%)" hint="Ej: 9">
              <input type="number" step="0.01" className={inputClass} value={Number(cfg.pctIpsObrero)} onChange={set("pctIpsObrero")} />
            </Field>
            <Field label="IPS patronal (%)" hint="Carga del costo hora. Ej: 16,5">
              <input type="number" step="0.01" className={inputClass} value={Number(cfg.pctIpsPatronal)} onChange={set("pctIpsPatronal")} />
            </Field>
            <Field label="Divisor aguinaldo" hint={`12 = 1/12 → ${formatQty(aguinaldoPct, 2)} % de carga`}>
              <input type="number" className={inputClass} value={Number(cfg.aguinaldoMeses)} onChange={set("aguinaldoMeses")} />
            </Field>
            <Field label="Vacaciones (%)" hint="Ej: 12 días ÷ 288 trabajados = 4,17">
              <input type="number" step="0.01" className={inputClass} value={Number(cfg.pctVacaciones ?? 0)} onChange={set("pctVacaciones")} />
            </Field>
            <Field label="Otras cargas (%)" hint="Seguros, indemnización prevista, EPP…">
              <input type="number" step="0.01" className={inputClass} value={Number(cfg.pctOtrasCargas ?? 0)} onChange={set("pctOtrasCargas")} />
            </Field>
            <Field label="Días laborales por mes" hint="Mensualero: costo hora = salario ÷ días ÷ horas">
              <input type="number" step="0.5" className={inputClass} value={Number(cfg.diasLaboralesMes ?? 26)} onChange={set("diasLaboralesMes")} />
            </Field>
            <Field label="Horas diarias laborales" hint="Ej: 8">
              <input type="number" step="0.5" className={inputClass} value={Number(cfg.horasDiasLaborales)} onChange={set("horasDiasLaborales")} />
            </Field>
            <Field label="Factor hora extra" hint="1.5 = 150% del valor normal">
              <input type="number" step="0.1" className={inputClass} value={Number(cfg.factorHoraExtra)} onChange={set("factorHoraExtra")} />
            </Field>
            <Field label="Bonificación familiar estándar (Gs.)" hint="Se suma al subtotal de cada liquidación si no se modifica">
              <input type="number" className={inputClass} value={Number(cfg.bonificacionFamiliar)} onChange={set("bonificacionFamiliar")} />
            </Field>
          </div>
          <p className="mt-4 text-sm">
            Cargas sobre el salario: <strong className="tabular-nums">{formatQty(totalCargas, 2)} %</strong> (factor {formatQty(1 + totalCargas / 100, 4)})
          </p>
        </Card>

        <Card title="Referencias legales (Paraguay)">
          <ul className="space-y-1 text-xs text-slate-600 list-disc pl-5">
            <li>IPS obrero: 9% sobre salario imponible (Art. 13, Ley 1286/87)</li>
            <li>IPS patronal: 16,5% sobre salario imponible</li>
            <li>Aguinaldo: 1/12 del salario mensual devengado (Art. 243, Cód. Laboral)</li>
            <li>Vacaciones: 12 días hábiles hasta 5 años de antigüedad, 18 hasta 10, 30 después (Art. 218)</li>
            <li>Hora extra diurna: ≥ 150% del valor hora normal (Art. 230, Cód. Laboral)</li>
            <li>Preaviso y liquidación final se calculan manualmente y se ingresan como "Otros bonos"</li>
          </ul>
        </Card>
      </div>

      <Card title="Costo hora por empleado">
        <p className="mb-3 text-xs text-slate-600">
          Mensualero: salario ÷ días laborales ÷ horas por día. Jornalero y destajista: el salario base es el jornal diario ÷ horas por día. Luego × (1 + cargas).
          Es el peso de sus horas del parte diario al repartir los costos por tiempo (vía C). Un costo manual reemplaza al calculado.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                <th className="py-1.5 pr-2">Empleado</th>
                <th className="py-1.5 pr-2">Tipo</th>
                <th className="py-1.5 pr-2 text-right">Salario base</th>
                <th className="py-1.5 pr-2 text-right">Hora sin cargas</th>
                <th className="py-1.5 pr-2 text-right">Costo hora</th>
                <th className="py-1.5 text-right">Costo hora manual</th>
              </tr>
            </thead>
            <tbody>
              {costos?.empleados.map((e) => (
                <tr key={e.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2">{e.fullName}</td>
                  <td className="py-1.5 pr-2">{TIPO[e.tipo]}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatGs(e.salarioBase)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatGs(e.base)}</td>
                  <td className={cx("py-1.5 pr-2 text-right font-semibold tabular-nums")}>
                    {formatGs(e.costoHora)}
                    {e.manual && <span className="ml-1 text-xs font-normal">(manual)</span>}
                  </td>
                  <td className="py-1.5 text-right">
                    <input
                      className={cx(inputClass, "w-32 text-right")}
                      inputMode="numeric"
                      placeholder={e.manual ? "vaciar = calculado" : "—"}
                      value={manual[e.id] ?? (e.manual ? String(e.costoHora) : "")}
                      onChange={(ev) => setManual((m) => ({ ...m, [e.id]: ev.target.value }))}
                      onBlur={() => manual[e.id] !== undefined && saveManual(e.id)}
                      onKeyDown={(ev) => ev.key === "Enter" && (ev.target as HTMLInputElement).blur()}
                    />
                  </td>
                </tr>
              ))}
              {costos && !costos.empleados.length && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-500">
                    Sin empleados asignados a esta obra.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
