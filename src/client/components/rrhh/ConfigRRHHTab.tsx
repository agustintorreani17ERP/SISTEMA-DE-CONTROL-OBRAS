import React, { useState, useEffect } from "react";
import { Save } from "lucide-react";
import { api } from "../../api";
import { Project, RRHHConfig } from "../../types";
import { Page, Card, Field, Button, inputClass } from "../../ui";

interface Props {
  project: Project;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const ConfigRRHHTab: React.FC<Props> = ({ project, showToast }) => {
  const [cfg, setCfg] = useState<RRHHConfig>({
    pctIpsObrero: 9,
    pctIpsPatronal: 16.5,
    factorHoraExtra: 1.5,
    horasDiasLaborales: 8,
    bonificacionFamiliar: 0,
    aguinaldoMeses: 12,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getRRHHConfig(project.id).then((c) => {
      if (c) setCfg(c);
    });
  }, [project.id]);

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
        },
        project.id
      );
      showToast("Configuración guardada", "success");
    } catch (e: any) {
      showToast(e.message || "Error al guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof RRHHConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCfg({ ...cfg, [k]: e.target.value });

  return (
    <div className="max-w-lg space-y-4">
      <Card title="Parámetros de liquidación" action={
        <Button variant="primary" icon={<Save className="w-4 h-4" />} onClick={handleSave} disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      }>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="IPS obrero (%)" hint="Ej: 9">
            <input type="number" step="0.01" className={inputClass} value={Number(cfg.pctIpsObrero)} onChange={set("pctIpsObrero")} />
          </Field>
          <Field label="IPS patronal (%)" hint="Ej: 16.5">
            <input type="number" step="0.01" className={inputClass} value={Number(cfg.pctIpsPatronal)} onChange={set("pctIpsPatronal")} />
          </Field>
          <Field label="Factor hora extra" hint="1.5 = 150% del valor normal">
            <input type="number" step="0.1" className={inputClass} value={Number(cfg.factorHoraExtra)} onChange={set("factorHoraExtra")} />
          </Field>
          <Field label="Horas diarias laborales" hint="Ej: 8">
            <input type="number" step="0.5" className={inputClass} value={Number(cfg.horasDiasLaborales)} onChange={set("horasDiasLaborales")} />
          </Field>
          <Field label="Bonificación familiar estándar (Gs.)" hint="Se suma al subtotal de cada liquidación si no se modifica">
            <input type="number" className={inputClass} value={Number(cfg.bonificacionFamiliar)} onChange={set("bonificacionFamiliar")} />
          </Field>
          <Field label="Divisor aguinaldo" hint="12 = 1/12 del subtotal anual">
            <input type="number" className={inputClass} value={Number(cfg.aguinaldoMeses)} onChange={set("aguinaldoMeses")} />
          </Field>
        </div>
      </Card>

      <Card title="Referencias legales (Paraguay)">
        <ul className="space-y-1 text-xs text-slate-600 list-disc pl-5">
          <li>IPS obrero: 9% sobre salario imponible (Art. 13, Ley 1286/87)</li>
          <li>IPS patronal: 16,5% sobre salario imponible</li>
          <li>Aguinaldo: 1/12 del salario mensual devengado (Art. 243, Cód. Laboral)</li>
          <li>Hora extra diurna: ≥ 150% del valor hora normal (Art. 230, Cód. Laboral)</li>
          <li>Preaviso y liquidación final se calculan manualmente y se ingresan como "Otros bonos"</li>
        </ul>
      </Card>
    </div>
  );
};
