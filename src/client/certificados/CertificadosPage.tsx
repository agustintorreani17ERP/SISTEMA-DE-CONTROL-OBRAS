import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Eye, Plus, Ruler, Trash2 } from "lucide-react";
import { api } from "../api";
import { BudgetItem, Certification, Partner, Project, SubcontractorContract } from "../types";
import { Badge, Button, Card, EmptyState, Page, PageHeader, Tabs } from "../ui";
import { ActionBar, MoreMenu } from "../ui/actions";
import { formatMoney } from "../utils/format";
import { SubcontractsTab } from "../components/SubcontractsTab";
import { MeasurementWizard } from "./MeasurementWizard";
import { CertificateDetail } from "./CertificateDetail";
import { CERT_STATUS, destinoLabel, periodLabel } from "./status";

export type CertificadosIntent = { action: "new-measurement" | "new-contract"; nonce: number } | null;

interface CertificadosPageProps {
  project: Project;
  budgetItems: BudgetItem[];
  partners: Partner[];
  subcontracts: SubcontractorContract[];
  currency: "PYG" | "USD";
  intent?: CertificadosIntent;
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

type Sub = "mediciones" | "certificados" | "contratos";
type Destino = "ALL" | "OBRA" | "SUB";

/** Certificados: 1. Mediciones → 2. Certificados (formato Medición N / Cert N) · Contratos de subcontratistas. */
export function CertificadosPage({ project, budgetItems, partners, subcontracts, currency, intent, onRefresh, showToast }: CertificadosPageProps) {
  const [sub, setSub] = useState<Sub>("mediciones");
  const [certs, setCerts] = useState<Certification[]>([]);
  const [wizard, setWizard] = useState(false);
  const [openContract, setOpenContract] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [destino, setDestino] = useState<Destino>("ALL");
  const [status, setStatus] = useState<"ALL" | "CERTIFICADO_BORRADOR" | "APROBADO">("ALL");
  const [search, setSearch] = useState("");
  const money = (v: unknown) => formatMoney(Number(v || 0), currency);

  const load = useCallback(async () => {
    try {
      setCerts(await api.getCertifications({ projectId: project.id }));
    } catch (err: any) {
      showToast(err.message || "No se pudieron cargar los certificados", "error");
    }
  }, [project.id, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!intent) return;
    if (intent.action === "new-measurement") {
      setSub("mediciones");
      setWizard(true);
    } else {
      setSub("contratos");
      setOpenContract(intent.nonce);
    }
  }, [intent?.nonce]);

  const measurements = certs.filter((c) => c.estado === "MEDICION_BORRADOR" || c.estado === "MEDICION_CERRADA");
  const certificates = certs.filter((c) => c.estado === "CERTIFICADO_BORRADOR" || c.estado === "APROBADO");

  const filtered = useMemo(() => {
    const base = sub === "mediciones" ? measurements : certificates;
    const q = search.trim().toLowerCase();
    return base.filter(
      (c) =>
        (destino === "ALL" || (destino === "SUB" ? !!c.partnerId : !c.partnerId)) &&
        (sub === "mediciones" || status === "ALL" || c.estado === status) &&
        (!q || `${c.numero} ${destinoLabel(c)}`.toLowerCase().includes(q))
    );
  }, [sub, measurements, certificates, destino, status, search]);

  const afterChange = () => {
    load();
    onRefresh();
  };

  const remove = async (c: Certification) => {
    if (!window.confirm(`¿Borrar la ${c.estado === "MEDICION_BORRADOR" ? "medición" : "certificación"} N° ${c.numero}?`)) return;
    try {
      await api.deleteCertification(c.id);
      showToast("Borrado");
      afterChange();
    } catch (err: any) {
      showToast(err.message || "No se pudo borrar", "error");
    }
  };

  const nextAction = (c: Certification) => {
    if (c.estado === "MEDICION_BORRADOR")
      return (
        <Button size="sm" variant="primary" onClick={() => setDetailId(c.id)}>
          Revisar y crear cert.
        </Button>
      );
    if (c.estado === "CERTIFICADO_BORRADOR")
      return (
        <Button size="sm" variant="primary" onClick={() => setDetailId(c.id)}>
          Revisar y aprobar
        </Button>
      );
    return (
      <Button size="sm" variant="ghost" onClick={() => setDetailId(c.id)}>
        Ver
      </Button>
    );
  };

  const newButton = (
    <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setWizard(true)}>
      Nueva medición
    </Button>
  );

  return (
    <Page>
      <PageHeader title="Certificados" help="Medí en obra, generá el certificado y aprobalo. Al aprobar se descuenta del presupuesto." />
      <Tabs
        value={sub}
        onChange={setSub}
        items={[
          { value: "mediciones", label: "1. Mediciones", count: measurements.length },
          { value: "certificados", label: "2. Certificados", count: certificates.filter((c) => c.estado === "CERTIFICADO_BORRADOR").length },
          { value: "contratos", label: "Contratos de subcontratistas" },
        ]}
      />

      {sub === "contratos" ? (
        <SubcontractsTab
          key={openContract}
          project={project}
          subcontracts={subcontracts.filter((s) => s.projectId === project.id)}
          partners={partners}
          budgetItems={budgetItems}
          currency={currency}
          onRefresh={onRefresh}
          showToast={showToast}
          openNewModalByDefault={openContract > 0}
        />
      ) : (
        <>
          <ActionBar
            chips={
              sub === "certificados"
                ? [
                    { value: "ALL", label: "Todos", count: certificates.length },
                    { value: "CERTIFICADO_BORRADOR", label: "Por aprobar", count: certificates.filter((c) => c.estado === "CERTIFICADO_BORRADOR").length },
                    { value: "APROBADO", label: "Aprobados", count: certificates.filter((c) => c.estado === "APROBADO").length },
                  ]
                : undefined
            }
            chip={status}
            onChip={(v) => setStatus(v as typeof status)}
            search={search}
            onSearch={setSearch}
            secondary={[
              { label: "Ver todos los destinos", onClick: () => setDestino("ALL") },
              { label: "Solo avance de obra", onClick: () => setDestino("OBRA") },
              { label: "Solo subcontratistas", onClick: () => setDestino("SUB") },
            ]}
            primary={newButton}
          />

          {filtered.length === 0 ? (
            <EmptyState
              icon={sub === "mediciones" ? <Ruler className="h-10 w-10" /> : <ClipboardCheck className="h-10 w-10" />}
              title={sub === "mediciones" ? "No hay mediciones en borrador" : "Todavía no hay certificados"}
              help={
                sub === "mediciones"
                  ? "Una medición registra lo ejecutado en el período, con su cómputo y fotos. Después se convierte en certificado."
                  : "Los certificados salen de una medición revisada."
              }
              action={newButton}
            />
          ) : (
            <Card padded={false}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr className="border-b border-slate-100">
                      <th className="px-5 py-3">N°</th>
                      <th className="px-3 py-3">Destino</th>
                      <th className="px-3 py-3">Período</th>
                      <th className="px-3 py-3 text-right">Monto</th>
                      {sub === "certificados" && <th className="px-3 py-3 text-right">Neto</th>}
                      <th className="px-3 py-3">Estado</th>
                      <th className="px-3 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr key={c.id} onClick={() => setDetailId(c.id)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-5 py-3 font-medium text-slate-900">{String(c.numero).padStart(2, "0")}</td>
                        <td className="px-3 py-3">
                          <p className="text-slate-800">{destinoLabel(c)}</p>
                          <p className="text-xs text-slate-400">{c.items?.length ?? 0} rubro(s)</p>
                        </td>
                        <td className="px-3 py-3 text-slate-600">{periodLabel(c)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(c.montoTotal)}</td>
                        {sub === "certificados" && <td className="px-3 py-3 text-right font-medium tabular-nums">{money(c.netAmount ?? c.montoTotal)}</td>}
                        <td className="px-3 py-3">
                          <Badge tone={CERT_STATUS[c.estado].tone}>{CERT_STATUS[c.estado].label}</Badge>
                        </td>
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {nextAction(c)}
                            <MoreMenu
                              items={[
                                { label: "Ver detalle", icon: <Eye className="h-4 w-4" />, onClick: () => setDetailId(c.id) },
                                ...(c.estado !== "APROBADO"
                                  ? [{ label: "Borrar", icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => remove(c) }]
                                  : []),
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {wizard && (
        <MeasurementWizard
          project={project}
          partners={partners}
          subcontracts={subcontracts}
          currency={currency}
          onClose={() => setWizard(false)}
          onCreated={(id, asCertificate) => {
            setWizard(false);
            setSub(asCertificate ? "certificados" : "mediciones");
            afterChange();
            setDetailId(id);
          }}
          showToast={showToast}
        />
      )}

      {detailId && (
        <CertificateDetail
          certificationId={detailId}
          project={project}
          currency={currency}
          onClose={() => setDetailId(null)}
          onChanged={afterChange}
          showToast={showToast}
        />
      )}
    </Page>
  );
}
