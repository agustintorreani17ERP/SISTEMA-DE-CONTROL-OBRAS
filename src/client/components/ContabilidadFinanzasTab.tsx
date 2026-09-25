import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  DollarSign,
  Receipt,
  FileCheck,
  Calendar,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Filter,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Building2,
  Layers,
  Search,
  Printer,
  FileText,
  CreditCard,
  Banknote,
  Send,
  Eye,
  Check,
  X,
  Sparkles,
  ShieldCheck,
  Lock,
  RefreshCw,
  FileCheck2,
  Truck,
  Loader2,
} from "lucide-react";
import {
  Project,
  Partner,
  PurchaseOrder,
  SubcontractorContract,
  FiscalInvoice,
  ClientBillableCertificate,
  PettyCashTransaction,
  PettyCashFund,
  BudgetItem,
} from "../types";
import { formatMoney, formatDate } from "../utils/format";
import { LegalInvoiceA4Modal } from "./LegalInvoiceA4Modal";
import { ThreeWayMatchModal } from "./ThreeWayMatchModal";
import { RegisterPaymentModal } from "./RegisterPaymentModal";
import { NewInvoiceModal } from "./NewInvoiceModal";

interface ContabilidadFinanzasTabProps {
  project?: Project | null;
  budgetItems: BudgetItem[];
  purchaseOrders: PurchaseOrder[];
  subcontracts: SubcontractorContract[];
  partners: Partner[];
  currency: "PYG" | "USD";
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  onRefresh: () => void;
  initialSubTab?: "facturas" | "auditoria-match" | "cuentas-pagar" | "cuentas-cobrar" | "caja-chica";
}

type SubTab = "facturas" | "auditoria-match" | "cuentas-pagar" | "cuentas-cobrar" | "caja-chica";

export const ContabilidadFinanzasTab: React.FC<ContabilidadFinanzasTabProps> = ({
  project,
  budgetItems,
  purchaseOrders,
  subcontracts,
  partners,
  currency,
  showToast,
  onRefresh,
  initialSubTab = "facturas",
}) => {
  const [subTab, setSubTab] = useState<SubTab>(initialSubTab);

  // API Invoices State
  const [apiInvoices, setApiInvoices] = useState<any[]>([]);
  const [loadingApiInvoices, setLoadingApiInvoices] = useState(false);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<"ALL" | "APROBADA" | "EN_REVISION" | "PAGADA">("ALL");
  const [invoiceSearch, setInvoiceSearch] = useState("");

  // Modal selections
  const [selectedInvoiceA4, setSelectedInvoiceA4] = useState<any | null>(null);
  const [selectedInvoiceMatch, setSelectedInvoiceMatch] = useState<any | null>(null);
  const [selectedInvoicePay, setSelectedInvoicePay] = useState<any | null>(null);
  const [showNewInvoiceModal, setShowNewInvoiceModal] = useState(false);

  // Local storage fallback / secondary modules
  const storageKeyClientCerts = `infratrack_fin_client_certs_${project?.id || 0}`;
  const storageKeyPettyCash = `infratrack_fin_petty_cash_${project?.id || 0}`;

  // Fetch real invoices from backend API
  const fetchInvoices = useCallback(async () => {
    setLoadingApiInvoices(true);
    try {
      const res = await fetch(`/api/invoices?projectId=${project?.id || 1}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.data) {
          setApiInvoices(data.data);
        }
      }
    } catch (err) {
      console.error("Error al obtener facturas de la API:", err);
    } finally {
      setLoadingApiInvoices(false);
    }
  }, [project?.id]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  // Client Certificates / Invoices to Collect (MOPC / Itaipú / Cliente)
  const [clientCerts, setClientCerts] = useState<ClientBillableCertificate[]>(() => {
    try {
      const saved = localStorage.getItem(storageKeyClientCerts);
      if (saved) return JSON.parse(saved);
    } catch {}

    return [
      {
        id: "CERT-CLI-01",
        projectId: project?.id || 1,
        certificateNumber: "CERT-OBRA-01",
        periodName: "Mes 1 - Movimiento de Suelos & Sub-base",
        issueDate: "2026-08-31",
        dueDate: "2026-09-30",
        clientName: project?.clientName || "MOPC - Ministerio de Obras Públicas",
        contractNumber: project?.contractNumber || "CT-2026/89",
        certifiedAmountGross: 185000000,
        advanceDeduction: 18500000, // 10% anticipo amortizado
        guaranteeRetention: 9250000, // 5% fondo de reparo retenido
        netAmountToCollect: 157250000,
        status: "PRESENTADO_FISCAL",
        invoiceNumber: "001-001-0000312",
        notes: "Carátula aprobada por Fiscal de Obras. En trámite de orden de pago en tesorería central.",
      },
      {
        id: "CERT-CLI-02",
        projectId: project?.id || 1,
        certificateNumber: "CERT-OBRA-02",
        periodName: "Mes 2 - Base Granular & Pavimento Asfáltico",
        issueDate: "2026-09-15",
        dueDate: "2026-10-15",
        clientName: project?.clientName || "MOPC - Ministerio de Obras Públicas",
        contractNumber: project?.contractNumber || "CT-2026/89",
        certifiedAmountGross: 320000000,
        advanceDeduction: 32000000,
        guaranteeRetention: 16000000,
        netAmountToCollect: 272000000,
        status: "PENDIENTE_APROBACION",
        invoiceNumber: "001-001-0000318",
        notes: "Medición de campo verificada. Pendiente de firma de fiscalización.",
      },
    ];
  });

  // Petty Cash (Fondo Fijo de Obra)
  const [pettyCashFund, setPettyCashFund] = useState<PettyCashFund>(() => {
    return {
      id: "FF-01",
      projectId: project?.id || 1,
      assignedAmount: 10000000, // 10.000.000 Gs de fondo fijo asignado
      currentBalance: 7850000,
      responsiblePerson: "Ing. Carlos Benítez (Jefe de Frente)",
      lastSettlementDate: "2026-09-14",
    };
  });

  const [pettyCashTx, setPettyCashTx] = useState<PettyCashTransaction[]>(() => {
    try {
      const saved = localStorage.getItem(storageKeyPettyCash);
      if (saved) return JSON.parse(saved);
    } catch {}

    return [
      {
        id: "TX-01",
        projectId: project?.id || 1,
        date: "2026-09-18",
        receiptNumber: "TKT-89412",
        supplierOrBeneficiary: "Petrobras San Lorenzo",
        concept: "Combustible urgente generador de pista de hormigonado",
        category: "COMBUSTIBLE",
        amount: 850000,
        responsibleName: "Carlos Benítez",
        settlementStatus: "PENDIENTE_RENDICION",
      },
      {
        id: "TX-02",
        projectId: project?.id || 1,
        date: "2026-09-19",
        receiptNumber: "FAC-003-4512",
        supplierOrBeneficiary: "Ferretería La Central",
        concept: "Alambre de atar, discos de corte y clavos de 2 pulg",
        category: "FERRETERIA",
        amount: 680000,
        responsibleName: "Jorge Duarte",
        settlementStatus: "PENDIENTE_RENDICION",
      },
      {
        id: "TX-03",
        projectId: project?.id || 1,
        date: "2026-09-20",
        receiptNumber: "BOL-1209",
        supplierOrBeneficiary: "Hielo & Agua Cristalina",
        concept: "Hielo y agua potable para personal de pista",
        category: "OTROS",
        amount: 320000,
        responsibleName: "Ana Urbina",
        settlementStatus: "PENDIENTE_RENDICION",
      },
    ];
  });

  // Local storage saves
  const saveClientCerts = (newCerts: ClientBillableCertificate[]) => {
    setClientCerts(newCerts);
    try {
      localStorage.setItem(storageKeyClientCerts, JSON.stringify(newCerts));
    } catch {}
  };

  const savePettyCash = (newTxs: PettyCashTransaction[]) => {
    setPettyCashTx(newTxs);
    const spentPending = newTxs
      .filter((t) => t.settlementStatus === "PENDIENTE_RENDICION")
      .reduce((acc, t) => acc + t.amount, 0);
    setPettyCashFund((prev) => ({
      ...prev,
      currentBalance: Math.max(0, prev.assignedAmount - spentPending),
    }));
    try {
      localStorage.setItem(storageKeyPettyCash, JSON.stringify(newTxs));
    } catch {}
  };

  // Other Modals
  const [showNewClientCertModal, setShowNewClientCertModal] = useState(false);
  const [showNewPettyTxModal, setShowNewPettyTxModal] = useState(false);
  const [showRendicionModal, setShowRendicionModal] = useState(false);

  // New Client Cert Form
  const [clientCertForm, setClientCertForm] = useState({
    certificateNumber: `CERT-OBRA-0${clientCerts.length + 1}`,
    periodName: `Mes ${clientCerts.length + 1} - Avance Certificado`,
    issueDate: new Date().toISOString().split("T")[0],
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    clientName: project?.clientName || "MOPC",
    contractNumber: project?.contractNumber || "CT-2026/89",
    certifiedAmountGross: 250000000,
    advanceDeduction: 25000000,
    guaranteeRetention: 12500000,
    notes: "",
  });

  // New Petty Cash Form
  const [pettyForm, setPettyForm] = useState({
    receiptNumber: "",
    supplierOrBeneficiary: "",
    concept: "",
    category: "COMBUSTIBLE" as PettyCashTransaction["category"],
    amount: 150000,
    responsibleName: "Ing. Carlos Benítez",
    budgetItemId: budgetItems[0]?.id,
  });

  // Filter state for Accounts Payable (Corrida semanal)
  const [apFilter, setApFilter] = useState<"ALL" | "VENCIDAS" | "ESTA_SEMANA" | "PROX_15" | "MAS_30">("ALL");

  // Helper date calculations for Corrida de Pagos
  const todayStr = new Date().toISOString().split("T")[0];
  const next7DaysStr = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
  const next15DaysStr = new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0];

  // Invoices filtered by search and status
  const filteredInvoices = useMemo(() => {
    return apiInvoices.filter((inv) => {
      const pName = inv.partner?.name || inv.partnerName || "";
      const pTax = inv.partner?.taxId || inv.partnerTaxId || "";
      const poNum = inv.purchaseOrder?.number || inv.sourceReference || "";
      const invNum = inv.numeroFactura || inv.invoiceNumber || "";
      const remNum = inv.remisionNumber || "";

      const matchesSearch =
        invNum.toLowerCase().includes(invoiceSearch.toLowerCase()) ||
        pName.toLowerCase().includes(invoiceSearch.toLowerCase()) ||
        pTax.toLowerCase().includes(invoiceSearch.toLowerCase()) ||
        poNum.toLowerCase().includes(invoiceSearch.toLowerCase()) ||
        remNum.toLowerCase().includes(invoiceSearch.toLowerCase());

      if (!matchesSearch) return false;

      if (invoiceStatusFilter === "APROBADA") {
        return inv.estado === "APROBADA" && inv.threeWayMatchPassed;
      }
      if (invoiceStatusFilter === "EN_REVISION") {
        return inv.estado === "EN_REVISION" || !inv.threeWayMatchPassed;
      }
      if (invoiceStatusFilter === "PAGADA") {
        return inv.estado === "PAGADA";
      }

      return true;
    });
  }, [apiInvoices, invoiceSearch, invoiceStatusFilter]);

  // Invoices filtered for Corrida Semanal de Pagos
  const apInvoices = useMemo(() => {
    return apiInvoices.filter((inv) => {
      if (inv.estado === "PAGADA") return false;
      const due = inv.fechaVencimiento || inv.dueDate || todayStr;

      if (apFilter === "VENCIDAS") {
        return due < todayStr;
      }
      if (apFilter === "ESTA_SEMANA") {
        return due >= todayStr && due <= next7DaysStr;
      }
      if (apFilter === "PROX_15") {
        return due > next7DaysStr && due <= next15DaysStr;
      }
      if (apFilter === "MAS_30") {
        return due > next15DaysStr;
      }
      return true;
    });
  }, [apiInvoices, apFilter, todayStr, next7DaysStr, next15DaysStr]);

  // Financial KPIs Calculations
  const totalCuentasPorPagar = useMemo(() => {
    return apiInvoices
      .filter((inv) => inv.estado !== "PAGADA")
      .reduce((acc, inv) => acc + (Number(inv.remainingBalance ?? inv.total ?? inv.totalAmount) || 0), 0);
  }, [apiInvoices]);

  const totalVencido = useMemo(() => {
    return apiInvoices
      .filter((inv) => inv.estado !== "PAGADA" && (inv.fechaVencimiento || inv.dueDate) < todayStr)
      .reduce((acc, inv) => acc + (Number(inv.remainingBalance ?? inv.total ?? inv.totalAmount) || 0), 0);
  }, [apiInvoices, todayStr]);

  const totalEstaSemana = useMemo(() => {
    return apiInvoices
      .filter(
        (inv) =>
          inv.estado !== "PAGADA" &&
          (inv.fechaVencimiento || inv.dueDate) >= todayStr &&
          (inv.fechaVencimiento || inv.dueDate) <= next7DaysStr
      )
      .reduce((acc, inv) => acc + (Number(inv.remainingBalance ?? inv.total ?? inv.totalAmount) || 0), 0);
  }, [apiInvoices, todayStr, next7DaysStr]);

  const countAprobadasMatch = useMemo(() => {
    return apiInvoices.filter((inv) => inv.threeWayMatchPassed && inv.estado === "APROBADA").length;
  }, [apiInvoices]);

  const countEnRevisionMatch = useMemo(() => {
    return apiInvoices.filter((inv) => inv.estado === "EN_REVISION" || !inv.threeWayMatchPassed).length;
  }, [apiInvoices]);

  const totalCuentasPorCobrar = useMemo(() => {
    const certsTotal = clientCerts
      .filter((c) => c.status !== "COBRADO")
      .reduce((acc, c) => acc + c.netAmountToCollect, 0);

    const emitidasTotal = apiInvoices
      .filter((inv) => inv.tipo === "EMITIDA" && inv.estado !== "PAGADA")
      .reduce((acc, inv) => acc + (Number(inv.remainingBalance ?? inv.total) || 0), 0);

    return certsTotal + emitidasTotal;
  }, [clientCerts, apiInvoices]);

  // Action: Create Client Certificate
  const handleCreateClientCert = (e: React.FormEvent) => {
    e.preventDefault();
    const gross = Number(clientCertForm.certifiedAmountGross) || 0;
    const adv = Number(clientCertForm.advanceDeduction) || 0;
    const guar = Number(clientCertForm.guaranteeRetention) || 0;
    const net = gross - adv - guar;

    const newCert: ClientBillableCertificate = {
      id: `CERT-CLI-${Date.now()}`,
      projectId: project?.id || 1,
      certificateNumber: clientCertForm.certificateNumber,
      periodName: clientCertForm.periodName,
      issueDate: clientCertForm.issueDate,
      dueDate: clientCertForm.dueDate,
      clientName: clientCertForm.clientName,
      contractNumber: clientCertForm.contractNumber,
      certifiedAmountGross: gross,
      advanceDeduction: adv,
      guaranteeRetention: guar,
      netAmountToCollect: net,
      status: "PRESENTADO_FISCAL",
      notes: clientCertForm.notes,
    };

    saveClientCerts([newCert, ...clientCerts]);
    setShowNewClientCertModal(false);
    showToast(`Certificado ${newCert.certificateNumber} registrado en Cuentas por Cobrar`);
  };

  // Action: Collect Client Certificate
  const handleCollectClientCert = (certId: string) => {
    const updated = clientCerts.map((c) =>
      c.id === certId
        ? { ...c, status: "COBRADO" as const, notes: `${c.notes || ""} - Cobro acreditado en cuenta BNF.` }
        : c
    );
    saveClientCerts(updated);
    showToast("Cobro de certificado confirmado y acreditado en cuenta");
  };

  // Action: Create Petty Cash Expense
  const handleCreatePettyTx = (e: React.FormEvent) => {
    e.preventDefault();
    if (pettyForm.amount <= 0) {
      showToast("El monto debe ser mayor a 0", "error");
      return;
    }

    const newTx: PettyCashTransaction = {
      id: `TX-${Date.now()}`,
      projectId: project?.id || 1,
      date: new Date().toISOString().split("T")[0],
      receiptNumber: pettyForm.receiptNumber || `TKT-${Math.floor(Math.random() * 90000 + 10000)}`,
      supplierOrBeneficiary: pettyForm.supplierOrBeneficiary || "Gasto Menor",
      concept: pettyForm.concept || "Gasto operativo en obra",
      category: pettyForm.category,
      amount: Number(pettyForm.amount),
      responsibleName: pettyForm.responsibleName,
      budgetItemId: pettyForm.budgetItemId,
      settlementStatus: "PENDIENTE_RENDICION",
    };

    savePettyCash([newTx, ...pettyCashTx]);
    setShowNewPettyTxModal(false);
    showToast(`Gasto de caja chica por ${formatMoney(newTx.amount, currency)} registrado`);
  };

  // Action: Close Weekly Petty Cash Settlement
  const handleCerrarRendicionSemanal = () => {
    const pendingTxs = pettyCashTx.filter((t) => t.settlementStatus === "PENDIENTE_RENDICION");
    if (pendingTxs.length === 0) {
      showToast("No hay comprobantes pendientes de rendición en el fondo fijo", "info");
      return;
    }

    const updatedTxs = pettyCashTx.map((t) => ({
      ...t,
      settlementStatus: "RENDIDO" as const,
    }));

    setPettyCashTx(updatedTxs);
    setPettyCashFund((prev) => ({
      ...prev,
      currentBalance: prev.assignedAmount,
      lastSettlementDate: todayStr,
    }));

    try {
      localStorage.setItem(storageKeyPettyCash, JSON.stringify(updatedTxs));
    } catch {}

    setShowRendicionModal(false);
    showToast("Rendición semanal cerrada con éxito. Fondo Fijo restituido al 100%");
  };

  return (
    <div className="space-y-6 pb-12 text-slate-800">
      {/* Top Header Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100 shadow-xs">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">
                  Contabilidad y Finanzas de Obra
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800 border border-blue-200">
                  ESTILO SAP · THREE-WAY MATCH
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Control de caja, registro de facturas fiscales, validación tripartita con 0% de tolerancia y corrida semanal de pagos.
              </p>
            </div>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowNewInvoiceModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ Registrar Factura Fiscal</span>
          </button>
          <button
            onClick={() => setShowNewPettyTxModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-bold transition cursor-pointer"
          >
            <Banknote className="w-4 h-4 text-emerald-600" />
            <span>+ Gasto Caja Chica</span>
          </button>
          <button
            onClick={fetchInvoices}
            disabled={loadingApiInvoices}
            className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition cursor-pointer"
            title="Recargar facturas"
          >
            <RefreshCw className={`w-4 h-4 ${loadingApiInvoices ? "animate-spin text-blue-600" : ""}`} />
          </button>
        </div>
      </div>

      {/* Financial KPIs Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* KPI 1: Cuentas por Pagar Total */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Cuentas por Pagar
            </span>
            <span className="p-1 rounded-lg bg-rose-50 text-rose-600">
              <ArrowDownLeft className="w-4 h-4" />
            </span>
          </div>
          <p className="text-xl font-extrabold text-slate-900 font-mono">
            {formatMoney(totalCuentasPorPagar, currency)}
          </p>
          <p className="text-[11px] text-rose-600 font-semibold flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{formatMoney(totalVencido, currency)} vencido</span>
          </p>
        </div>

        {/* KPI 2: Aprobadas por Three-Way Match */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              3-Way Match Aprobadas
            </span>
            <span className="p-1 rounded-lg bg-emerald-50 text-emerald-600">
              <ShieldCheck className="w-4 h-4" />
            </span>
          </div>
          <p className="text-xl font-extrabold text-emerald-700 font-mono">
            {countAprobadasMatch} <span className="text-xs font-normal text-slate-500">facturas</span>
          </p>
          <p className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Listas para desembolso</span>
          </p>
        </div>

        {/* KPI 3: En Revisión (Discrepancia 0%) */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              En Revisión / Alerta
            </span>
            <span className="p-1 rounded-lg bg-amber-50 text-amber-600">
              <Lock className="w-4 h-4" />
            </span>
          </div>
          <p className="text-xl font-extrabold text-amber-700 font-mono">
            {countEnRevisionMatch} <span className="text-xs font-normal text-slate-500">bloqueadas</span>
          </p>
          <p className="text-[11px] text-amber-700 font-semibold flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Desvío &gt; 0% o sin pañol</span>
          </p>
        </div>

        {/* KPI 4: Cuentas por Cobrar (Cliente) */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Cuentas por Cobrar
            </span>
            <span className="p-1 rounded-lg bg-emerald-50 text-emerald-600">
              <ArrowUpRight className="w-4 h-4" />
            </span>
          </div>
          <p className="text-xl font-extrabold text-emerald-700 font-mono">
            {formatMoney(totalCuentasPorCobrar, currency)}
          </p>
          <p className="text-[11px] text-slate-500 truncate">
            {project?.clientName || "MOPC"} · Certificaciones
          </p>
        </div>

        {/* KPI 5: Fondo Fijo / Caja Chica */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Fondo Fijo Disponible
            </span>
            <span className="p-1 rounded-lg bg-blue-50 text-blue-600">
              <Banknote className="w-4 h-4" />
            </span>
          </div>
          <p className="text-xl font-extrabold text-blue-900 font-mono">
            {formatMoney(pettyCashFund.currentBalance, currency)}
          </p>
          <p className="text-[11px] text-slate-500">
            Asignado: {formatMoney(pettyCashFund.assignedAmount, currency)}
          </p>
        </div>
      </div>

      {/* Navigation Subtabs Bar */}
      <div className="border-b border-slate-200 pb-2">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          <button
            onClick={() => setSubTab("facturas")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "facturas"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Recepción de Facturas Fiscales</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
              {apiInvoices.length}
            </span>
          </button>

          <button
            onClick={() => setSubTab("auditoria-match")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "auditoria-match"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Auditoría Three-Way Match (Matriz)</span>
            {countEnRevisionMatch > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                {countEnRevisionMatch}
              </span>
            )}
          </button>

          <button
            onClick={() => setSubTab("cuentas-pagar")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "cuentas-pagar"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Cuentas por Pagar (Corrida)</span>
            {totalVencido > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                Alerta
              </span>
            )}
          </button>

          <button
            onClick={() => setSubTab("cuentas-cobrar")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "cuentas-cobrar"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <FileCheck className="w-4 h-4" />
            <span>Cuentas por Cobrar (Cliente)</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
              {clientCerts.length}
            </span>
          </button>

          <button
            onClick={() => setSubTab("caja-chica")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "caja-chica"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Banknote className="w-4 h-4" />
            <span>Fondo Fijo / Caja Chica</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: RECEPCION DE FACTURAS FISCALES & THREE-WAY MATCH */}
      {subTab === "facturas" && (
        <div className="space-y-4">
          {/* Policy Banner */}
          <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed text-slate-700">
                <strong className="text-blue-900">Control de Integración Tripartita (Three-Way Match):</strong> Solo
                se autoriza el pago a proveedores si existe coincidencia exacta al 100% (margen de tolerancia 0%)
                entre la <strong>Orden de Compra / Contrato</strong>, la <strong>Recepción en Pañol (Remisión)</strong> y
                la <strong>Factura Fiscal</strong>.
              </div>
            </div>

            <button
              onClick={() => setSubTab("auditoria-match")}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white border border-blue-200 text-blue-800 font-bold text-xs shadow-xs hover:bg-blue-50 transition shrink-0 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Ver Matriz Comparativa</span>
            </button>
          </div>

          {/* Table Container */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            {/* Search and Filters */}
            <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Buscar por Factura, Timbrado, Proveedor o Remisión..."
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setInvoiceStatusFilter("ALL")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    invoiceStatusFilter === "ALL"
                      ? "bg-slate-800 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  Todas ({apiInvoices.length})
                </button>
                <button
                  onClick={() => setInvoiceStatusFilter("APROBADA")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    invoiceStatusFilter === "APROBADA"
                      ? "bg-emerald-600 text-white"
                      : "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Aprobadas ({countAprobadasMatch})</span>
                </button>
                <button
                  onClick={() => setInvoiceStatusFilter("EN_REVISION")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    invoiceStatusFilter === "EN_REVISION"
                      ? "bg-amber-600 text-white"
                      : "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>En Revisión ({countEnRevisionMatch})</span>
                </button>
                <button
                  onClick={() => setInvoiceStatusFilter("PAGADA")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    invoiceStatusFilter === "PAGADA"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  Pagadas
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-3">TIPO</th>
                    <th className="p-3">N° FACTURA & TIMBRADO</th>
                    <th className="p-3">PROVEEDOR / RAZÓN SOCIAL</th>
                    <th className="p-3">VÍNCULO O.C. & REMISIÓN</th>
                    <th className="p-3 text-center">CONDICIÓN & VTO</th>
                    <th className="p-3 text-right">TOTAL FACTURA</th>
                    <th className="p-3 text-center">INTEGRACIÓN TRIPARTITA</th>
                    <th className="p-3 text-center">ACCIONES</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400">
                        No se encontraron facturas con los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((inv) => {
                      const isVencida =
                        inv.estado !== "PAGADA" && (inv.fechaVencimiento || inv.dueDate) < todayStr;
                      const partnerName = inv.partner?.name || inv.partnerName || "Proveedor";
                      const partnerTax = inv.partner?.taxId || inv.partnerTaxId || "-";
                      const totalAmt = Number(inv.total ?? inv.totalAmount ?? 0);
                      const isPassed = inv.threeWayMatchPassed && inv.estado === "APROBADA";
                      const isPaid = inv.estado === "PAGADA";

                      return (
                        <tr key={inv.id} className="hover:bg-slate-50/80 transition">
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                inv.tipo === "EMITIDA"
                                  ? "bg-purple-50 text-purple-700 border border-purple-200"
                                  : "bg-blue-50 text-blue-700 border border-blue-200"
                              }`}
                            >
                              {inv.tipo || "RECIBIDA"}
                            </span>
                          </td>
                          <td className="p-3 font-mono">
                            <div className="font-bold text-slate-900">{inv.numeroFactura || inv.invoiceNumber}</div>
                            <div className="text-[10px] text-slate-500">Timb: {inv.timbrado}</div>
                          </td>
                          <td className="p-3">
                            <div className="font-bold text-slate-800">{partnerName}</div>
                            <div className="text-[10px] text-slate-500 font-mono">RUC: {partnerTax}</div>
                          </td>
                          <td className="p-3 font-mono text-[11px]">
                            {inv.purchaseOrder?.number ? (
                              <span className="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 font-bold">
                                {inv.purchaseOrder.number}
                              </span>
                            ) : inv.sourceReference ? (
                              <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                {inv.sourceReference}
                              </span>
                            ) : (
                              <span className="text-slate-400">Sin O.C.</span>
                            )}
                            {inv.remisionNumber && (
                              <div className="text-[10px] text-purple-700 font-medium mt-0.5">
                                Remisión: {inv.remisionNumber}
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <div className="font-semibold text-slate-700">
                              {inv.condicionVenta || inv.paymentCondition || "CRÉDITO"}
                            </div>
                            <div
                              className={`text-[11px] font-mono font-bold ${
                                isVencida ? "text-rose-600" : "text-slate-500"
                              }`}
                            >
                              {formatDate(inv.fechaVencimiento || inv.dueDate)}
                              {isVencida && " ⚠️"}
                            </div>
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-slate-900 text-sm">
                            <div>{formatMoney(totalAmt, currency)}</div>
                            {inv.remainingBalance !== undefined && inv.remainingBalance < totalAmt && (
                              <div className="text-[10px] text-emerald-600 font-normal">
                                Saldo: {formatMoney(inv.remainingBalance, currency)}
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() => setSelectedInvoiceMatch(inv)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold transition cursor-pointer ${
                                isPaid
                                  ? "bg-slate-100 text-slate-700 border border-slate-300"
                                  : isPassed
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200"
                                  : "bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200"
                              }`}
                              title="Click para ver detalle del Three-Way Match"
                            >
                              {isPaid ? (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>PAGADA</span>
                                </>
                              ) : isPassed ? (
                                <>
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>✓ 3-WAY MATCH 100%</span>
                                </>
                              ) : (
                                <>
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                                  <span>EN REVISIÓN</span>
                                </>
                              )}
                            </button>
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {/* View Legal A4 Invoice */}
                              <button
                                onClick={() => setSelectedInvoiceA4(inv)}
                                className="p-1.5 rounded-lg border border-slate-200 hover:bg-blue-50 hover:text-blue-700 text-slate-600 transition cursor-pointer"
                                title="Ver / Imprimir Factura Legal A4"
                              >
                                <Printer className="w-4 h-4" />
                              </button>

                              {/* Three-Way Match Comparison */}
                              <button
                                onClick={() => setSelectedInvoiceMatch(inv)}
                                className="p-1.5 rounded-lg border border-slate-200 hover:bg-purple-50 hover:text-purple-700 text-slate-600 transition cursor-pointer"
                                title="Auditoría Tripartita (Three-Way Match)"
                              >
                                <ShieldCheck className="w-4 h-4" />
                              </button>

                              {/* Pay Invoice Button */}
                              {!isPaid ? (
                                <button
                                  onClick={() => setSelectedInvoicePay(inv)}
                                  className={`px-3 py-1 rounded-lg font-bold text-xs shadow-xs transition cursor-pointer ${
                                    isPassed
                                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                      : "bg-slate-200 hover:bg-slate-300 text-slate-700"
                                  }`}
                                  title={
                                    isPassed
                                      ? "Registrar pago"
                                      : "Validación Tripartita pendiente: el pago será bloqueado hasta superar 0% de tolerancia"
                                  }
                                >
                                  Pagar
                                </button>
                              ) : (
                                <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-0.5">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Listo
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: AUDITORIA TRIPARTITA (MATRIZ COMPARATIVA ESTILO SAP) */}
      {subTab === "auditoria-match" && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-900 to-indigo-900 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-6 h-6 text-emerald-400" />
                <h2 className="text-base font-bold">
                  Matriz de Integración Tripartita (Three-Way Match)
                </h2>
              </div>
              <p className="text-xs text-blue-200 mt-1 max-w-2xl leading-relaxed">
                Control estricto de desembolsos: El motor audita en tiempo real que cada guaraní facturado
                tenga respaldo en una <strong>Orden de Compra formal</strong> y en una{" "}
                <strong>Recepción Física verificada en el Pañol de obra</strong>, aplicando tolerancia 0.00%.
              </p>
            </div>

            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-xs p-3 rounded-xl border border-white/20 shrink-0">
              <div className="text-center">
                <span className="block text-[10px] uppercase font-bold text-blue-200">Tolerancia</span>
                <span className="text-sm font-mono font-black text-white">0.00%</span>
              </div>
              <div className="h-7 w-px bg-white/20"></div>
              <div className="text-center">
                <span className="block text-[10px] uppercase font-bold text-blue-200">Aprobadas</span>
                <span className="text-sm font-mono font-black text-emerald-300">{countAprobadasMatch}</span>
              </div>
              <div className="h-7 w-px bg-white/20"></div>
              <div className="text-center">
                <span className="block text-[10px] uppercase font-bold text-blue-200">Bloqueadas</span>
                <span className="text-sm font-mono font-black text-amber-300">{countEnRevisionMatch}</span>
              </div>
            </div>
          </div>

          {/* Cards Grid Comparing The 3 Pillars */}
          <div className="grid grid-cols-1 gap-4">
            {apiInvoices.map((inv) => {
              const po = inv.purchaseOrder;
              const poAmount = Number(po?.totalAmount || 0);
              const invTotal = Number(inv.total || inv.totalAmount || 0);
              const diff = Math.abs(invTotal - poAmount);
              const hasRemision = Boolean(inv.remisionNumber || po?.stockRegistered);
              const isPassed = inv.threeWayMatchPassed && inv.estado === "APROBADA";

              return (
                <div
                  key={inv.id}
                  className={`bg-white border-2 rounded-2xl p-5 shadow-xs transition ${
                    isPassed
                      ? "border-slate-200 hover:border-emerald-300"
                      : "border-amber-300 bg-amber-50/20"
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2.5 rounded-xl shrink-0 ${
                          isPassed
                            ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                            : "bg-amber-50 text-amber-600 border border-amber-200"
                        }`}
                      >
                        <ShieldCheck className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm text-slate-900">
                            Factura {inv.numeroFactura || inv.invoiceNumber}
                          </h3>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                              isPassed
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {isPassed ? "3-WAY MATCH APROBADO (0% DESVÍO)" : "DISCREPANCIA / EN REVISIÓN"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 font-medium">
                          Proveedor: <strong className="text-slate-800">{inv.partner?.name || inv.partnerName}</strong> ·
                          RUC: {inv.partner?.taxId || inv.partnerTaxId}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end lg:self-center">
                      <button
                        onClick={() => setSelectedInvoiceMatch(inv)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Ver Auditoría Completa</span>
                      </button>
                      <button
                        onClick={() => setSelectedInvoiceA4(inv)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold transition cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Factura A4</span>
                      </button>
                    </div>
                  </div>

                  {/* 3 Columns Comparison */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-4 text-xs">
                    {/* Pillar 1 */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                      <div className="flex items-center justify-between font-bold text-slate-700">
                        <span className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-blue-600" />
                          1. Orden de Compra
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-100 text-blue-800">
                          {po?.number || "Directo"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Monto Acordado:</span>
                        <span className="font-mono font-bold text-slate-800">
                          {formatMoney(poAmount > 0 ? poAmount : invTotal, currency)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Estado O.C.:</span>
                        <span className="font-bold text-emerald-700">
                          {po ? "Aprobada por Gerencia" : "Contrato Marco"}
                        </span>
                      </div>
                    </div>

                    {/* Pillar 2 */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                      <div className="flex items-center justify-between font-bold text-slate-700">
                        <span className="flex items-center gap-1.5">
                          <Truck className="w-3.5 h-3.5 text-purple-600" />
                          2. Recepción Pañol
                        </span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold ${
                            hasRemision
                              ? "bg-purple-100 text-purple-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {hasRemision ? "Verificado" : "Falta Remito"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">N° Remisión:</span>
                        <span className="font-mono font-bold text-slate-800">
                          {inv.remisionNumber || (po?.stockRegistered ? "STOCK EN PAÑOL" : "Pendiente")}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Pesaje / Báscula:</span>
                        <span className="font-semibold text-slate-700">
                          {hasRemision ? "Conforme (100%)" : "Sin verificación"}
                        </span>
                      </div>
                    </div>

                    {/* Pillar 3 */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                      <div className="flex items-center justify-between font-bold text-slate-700">
                        <span className="flex items-center gap-1.5">
                          <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                          3. Factura Fiscal
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-bold">
                          Cobrado
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Monto Facturado:</span>
                        <span className="font-mono font-bold text-slate-900">
                          {formatMoney(invTotal, currency)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Diferencia (Delta):</span>
                        <span
                          className={`font-mono font-bold ${
                            diff === 0 ? "text-emerald-600" : "text-rose-600 font-black"
                          }`}
                        >
                          ₲ {diff.toLocaleString("es-PY")} ({diff === 0 ? "0.00%" : "Desvío"})
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Audit Note */}
                  {inv.matchNotes && (
                    <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-slate-600 flex items-center gap-2">
                      <span className="font-bold text-slate-700">Dictamen Auditoría:</span>
                      <span>{inv.matchNotes}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 3: CUENTAS POR PAGAR (CORRIDA SEMANAL DE VENCIMIENTOS) */}
      {subTab === "cuentas-pagar" && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200 flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed text-slate-700">
              <strong className="text-amber-900">Corrida Semanal de Vencimientos:</strong> Calendario financiero de
              obligaciones fiscales con proveedores y subcontratistas. Permite planificar el flujo de caja de la obra
              para evitar desabastecimientos de materiales o penalizaciones contractuales.
            </div>
          </div>

          {/* Quick Date Horizon Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setApFilter("ALL")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                apFilter === "ALL"
                  ? "bg-slate-800 text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Todas las Obligaciones
            </button>
            <button
              onClick={() => setApFilter("VENCIDAS")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                apFilter === "VENCIDAS"
                  ? "bg-rose-600 text-white"
                  : "bg-white border border-rose-200 text-rose-700 hover:bg-rose-50"
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>🚨 Vencidas ({formatMoney(totalVencido, currency)})</span>
            </button>
            <button
              onClick={() => setApFilter("ESTA_SEMANA")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                apFilter === "ESTA_SEMANA"
                  ? "bg-amber-600 text-white"
                  : "bg-white border border-amber-200 text-amber-700 hover:bg-amber-50"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>📅 Esta Semana ({formatMoney(totalEstaSemana, currency)})</span>
            </button>
            <button
              onClick={() => setApFilter("PROX_15")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                apFilter === "PROX_15"
                  ? "bg-blue-600 text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Próximos 15 días
            </button>
            <button
              onClick={() => setApFilter("MAS_30")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                apFilter === "MAS_30"
                  ? "bg-blue-600 text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Más de 30 días
            </button>
          </div>

          {/* Accounts Payable Table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-3">FECHA VENCIMIENTO</th>
                    <th className="p-3">PROVEEDOR / BENEFICIARIO</th>
                    <th className="p-3">COMPROBANTE & TIMBRADO</th>
                    <th className="p-3">REFERENCIA O.C.</th>
                    <th className="p-3 text-right">MONTO A PAGAR</th>
                    <th className="p-3 text-center">ESTADO 3-WAY MATCH</th>
                    <th className="p-3 text-center">ACCIÓN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {apInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        No hay obligaciones pendientes en este rango de fechas.
                      </td>
                    </tr>
                  ) : (
                    apInvoices.map((inv) => {
                      const due = inv.fechaVencimiento || inv.dueDate || todayStr;
                      const isVencida = due < todayStr;
                      const pName = inv.partner?.name || inv.partnerName || "Proveedor";
                      const pTax = inv.partner?.taxId || inv.partnerTaxId || "-";
                      const invNum = inv.numeroFactura || inv.invoiceNumber;
                      const amt = Number(inv.remainingBalance ?? inv.total ?? inv.totalAmount ?? 0);
                      const isApproved = inv.threeWayMatchPassed && inv.estado === "APROBADA";

                      return (
                        <tr key={inv.id} className="hover:bg-slate-50 transition">
                          <td className="p-3">
                            <span
                              className={`font-mono font-bold ${
                                isVencida ? "text-rose-600 font-extrabold" : "text-slate-800"
                              }`}
                            >
                              {formatDate(due)}
                            </span>
                            {isVencida && (
                              <span className="block text-[10px] text-rose-600 font-bold">VENCIDA</span>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="font-bold text-slate-900">{pName}</div>
                            <div className="text-[10px] text-slate-500 font-mono">RUC: {pTax}</div>
                          </td>
                          <td className="p-3 font-mono">
                            <div className="font-bold text-slate-800">{invNum}</div>
                            <div className="text-[10px] text-slate-500">Timb: {inv.timbrado}</div>
                          </td>
                          <td className="p-3 font-mono text-slate-600">
                            {inv.purchaseOrder?.number || inv.sourceReference || "Directo"}
                          </td>
                          <td className="p-3 text-right font-mono font-extrabold text-slate-900 text-sm">
                            {formatMoney(amt, currency)}
                          </td>
                          <td className="p-3 text-center">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                isApproved
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                  : "bg-amber-100 text-amber-800 border border-amber-300"
                              }`}
                            >
                              {isApproved ? "✓ HABILITADA" : "⚠️ BLOQUEADA"}
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() => setSelectedInvoicePay(inv)}
                              className={`px-3 py-1 rounded-lg font-bold text-xs shadow-xs transition cursor-pointer ${
                                isApproved
                                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                  : "bg-slate-200 hover:bg-slate-300 text-slate-700"
                              }`}
                            >
                              Ejecutar Pago
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 4: CUENTAS POR COBRAR (CLIENTE / ENTE CONTRATANTE) */}
      {subTab === "cuentas-cobrar" && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-200 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <FileCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed text-slate-700">
                <strong className="text-emerald-900">Seguimiento de Certificaciones al Cliente:</strong> Registra las
                facturas de venta y certificados emitidos al comitente ({project?.clientName || "MOPC"}). Aplica
                automáticamente las deducciones contractuales de <strong>amortización de anticipo (10%)</strong> y la{" "}
                <strong>retención de garantía / fondo de reparo (5%)</strong> para reflejar el importe neto a cobrar.
              </div>
            </div>
            <button
              onClick={() => setShowNewClientCertModal(true)}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Nuevo Certificado al Cliente</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {clientCerts.map((cert) => (
              <div
                key={cert.id}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-5"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono font-bold text-xs">
                      {cert.certificateNumber}
                    </span>
                    <span className="text-sm font-bold text-slate-900">{cert.periodName}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        cert.status === "COBRADO"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-blue-50 text-blue-700 border border-blue-200"
                      }`}
                    >
                      {cert.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    <div>
                      Cliente: <strong className="text-slate-800">{cert.clientName}</strong>
                    </div>
                    <div>
                      Contrato: <strong className="text-slate-800">{cert.contractNumber}</strong>
                    </div>
                    <div>
                      Presentado: <strong className="text-slate-800">{formatDate(cert.issueDate)}</strong>
                    </div>
                    {cert.invoiceNumber && (
                      <div>
                        Factura Fiscal N°: <strong className="font-mono text-slate-800">{cert.invoiceNumber}</strong>
                      </div>
                    )}
                  </div>

                  {cert.notes && <p className="text-xs text-slate-600 italic">{cert.notes}</p>}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-6 border-t sm:border-t-0 sm:border-l border-slate-200 pt-3 sm:pt-0 sm:pl-6 shrink-0">
                  <div className="space-y-1 text-right sm:text-right">
                    <div className="text-[11px] text-slate-400">
                      Monto Bruto: {formatMoney(cert.certifiedAmountGross, currency)}
                    </div>
                    <div className="text-[11px] text-rose-500">
                      - Anticipo (10%): -{formatMoney(cert.advanceDeduction, currency)}
                    </div>
                    <div className="text-[11px] text-amber-600">
                      - Fondo Reparo (5%): -{formatMoney(cert.guaranteeRetention, currency)}
                    </div>
                    <div className="text-base font-mono font-extrabold text-emerald-700 pt-1 border-t border-slate-100">
                      Líquido: {formatMoney(cert.netAmountToCollect, currency)}
                    </div>
                  </div>

                  {cert.status !== "COBRADO" ? (
                    <button
                      onClick={() => handleCollectClientCert(cert.id)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Check className="w-4 h-4" />
                      <span>Registrar Cobro</span>
                    </button>
                  ) : (
                    <div className="text-right">
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                        <CheckCircle2 className="w-4 h-4" />
                        Acreditado en Banco
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 5: FONDO FIJO / CAJA CHICA */}
      {subTab === "caja-chica" && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Banknote className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-sm text-slate-900">
                  Estado del Fondo Fijo Operativo de Obra
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                Custodio: <strong>{pettyCashFund.responsiblePerson}</strong> · Último cierre:{" "}
                {formatDate(pettyCashFund.lastSettlementDate)}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowRendicionModal(true)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition cursor-pointer flex items-center gap-1.5"
              >
                <FileCheck2 className="w-4 h-4" />
                <span>Cerrar Rendición Semanal</span>
              </button>
            </div>
          </div>

          {/* Transactions list */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700">
                Comprobantes Menores de la Semana
              </h4>
              <span className="text-xs text-slate-500">
                Pendientes de rendición:{" "}
                <strong>
                  {pettyCashTx.filter((t) => t.settlementStatus === "PENDIENTE_RENDICION").length}
                </strong>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-3">FECHA</th>
                    <th className="p-3">COMPROBANTE</th>
                    <th className="p-3">PROVEEDOR / COMERCIO</th>
                    <th className="p-3">CONCEPTO / DESTINO</th>
                    <th className="p-3">CATEGORÍA</th>
                    <th className="p-3 text-right">MONTO</th>
                    <th className="p-3 text-center">ESTADO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {pettyCashTx.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50 transition">
                      <td className="p-3 font-mono">{formatDate(tx.date)}</td>
                      <td className="p-3 font-mono font-bold text-slate-900">{tx.receiptNumber}</td>
                      <td className="p-3 font-medium text-slate-800">{tx.supplierOrBeneficiary}</td>
                      <td className="p-3 text-slate-600">{tx.concept}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold">
                          {tx.category}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900">
                        {formatMoney(tx.amount, currency)}
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            tx.settlementStatus === "RENDIDO"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {tx.settlementStatus === "RENDIDO" ? "Rendido" : "Pendiente"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: REGISTRAR NUEVA FACTURA LEGAL (API) */}
      {showNewInvoiceModal && (
        <NewInvoiceModal
          project={project}
          partners={partners}
          purchaseOrders={purchaseOrders}
          onClose={() => setShowNewInvoiceModal(false)}
          onInvoiceCreated={() => {
            fetchInvoices();
            onRefresh();
          }}
          showToast={showToast}
        />
      )}

      {/* MODAL 2: VISTA FACTURA LEGAL A4 OFICIAL (DNIT / PARAGUAY) */}
      {selectedInvoiceA4 && (
        <LegalInvoiceA4Modal
          invoice={selectedInvoiceA4}
          project={project}
          onClose={() => setSelectedInvoiceA4(null)}
          showToast={showToast}
        />
      )}

      {/* MODAL 3: AUDITORIA TRIPARTITA (THREE-WAY MATCH COMPARISON) */}
      {selectedInvoiceMatch && (
        <ThreeWayMatchModal
          invoice={selectedInvoiceMatch}
          project={project}
          onClose={() => setSelectedInvoiceMatch(null)}
          onViewA4={(inv) => {
            setSelectedInvoiceMatch(null);
            setSelectedInvoiceA4(inv);
          }}
          onProceedPayment={(inv) => {
            setSelectedInvoiceMatch(null);
            setSelectedInvoicePay(inv);
          }}
          onMatchUpdated={() => {
            fetchInvoices();
            onRefresh();
          }}
          showToast={showToast}
        />
      )}

      {/* MODAL 4: REGISTRAR PAGO / DESEMBOLSO FINANCIERO */}
      {selectedInvoicePay && (
        <RegisterPaymentModal
          invoice={selectedInvoicePay}
          onClose={() => setSelectedInvoicePay(null)}
          onPaymentSuccess={() => {
            fetchInvoices();
            onRefresh();
          }}
          showToast={showToast}
        />
      )}

      {/* MODAL 5: NUEVO CERTIFICADO DE CLIENTE */}
      {showNewClientCertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 shadow-xl relative text-xs">
            <button
              onClick={() => setShowNewClientCertModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <FileCheck className="w-5 h-5 text-emerald-600" />
              <h3 className="text-base font-bold text-slate-900">
                Nuevo Certificado de Avance al Cliente
              </h3>
            </div>

            <form onSubmit={handleCreateClientCert} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">N° Certificado:</label>
                  <input
                    type="text"
                    required
                    value={clientCertForm.certificateNumber}
                    onChange={(e) =>
                      setClientCertForm({ ...clientCertForm, certificateNumber: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Período / Tramo:</label>
                  <input
                    type="text"
                    required
                    value={clientCertForm.periodName}
                    onChange={(e) =>
                      setClientCertForm({ ...clientCertForm, periodName: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Monto Bruto Certificado (Gs.):</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={clientCertForm.certifiedAmountGross}
                  onChange={(e) =>
                    setClientCertForm({
                      ...clientCertForm,
                      certifiedAmountGross: Number(e.target.value),
                      advanceDeduction: Math.round(Number(e.target.value) * 0.1),
                      guaranteeRetention: Math.round(Number(e.target.value) * 0.05),
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-sm font-bold text-slate-900"
                />
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1 font-mono text-[11px]">
                <div className="flex justify-between text-slate-500">
                  <span>- Amortización Anticipo (10%):</span>
                  <span className="text-rose-600 font-bold">
                    -{formatMoney(clientCertForm.advanceDeduction, currency)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>- Retención Fondo de Reparo (5%):</span>
                  <span className="text-amber-600 font-bold">
                    -{formatMoney(clientCertForm.guaranteeRetention, currency)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-900 font-extrabold text-xs pt-1 border-t border-slate-200">
                  <span>Líquido a Percibir:</span>
                  <span className="text-emerald-700">
                    {formatMoney(
                      clientCertForm.certifiedAmountGross -
                        clientCertForm.advanceDeduction -
                        clientCertForm.guaranteeRetention,
                      currency
                    )}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowNewClientCertModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-xs cursor-pointer"
                >
                  Registrar Certificado
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 6: REGISTRAR GASTO CAJA CHICA */}
      {showNewPettyTxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-xl relative text-xs">
            <button
              onClick={() => setShowNewPettyTxModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <Banknote className="w-5 h-5 text-emerald-600" />
              <h3 className="text-base font-bold text-slate-900">Registrar Comprobante de Caja Chica</h3>
            </div>

            <form onSubmit={handleCreatePettyTx} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">N° Comprobante / Ticket:</label>
                  <input
                    type="text"
                    required
                    placeholder="FAC-001-841"
                    value={pettyForm.receiptNumber}
                    onChange={(e) => setPettyForm({ ...pettyForm, receiptNumber: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Categoría:</label>
                  <select
                    value={pettyForm.category}
                    onChange={(e) =>
                      setPettyForm({ ...pettyForm, category: e.target.value as any })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                  >
                    <option value="COMBUSTIBLE">Combustible</option>
                    <option value="FERRETERIA">Ferretería</option>
                    <option value="ALIMENTACION">Alimentación</option>
                    <option value="TRANSPORTE">Transporte / Flete</option>
                    <option value="OTROS">Otros Gastos</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Comercio / Proveedor:</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Ferretería El Tornillo"
                  value={pettyForm.supplierOrBeneficiary}
                  onChange={(e) =>
                    setPettyForm({ ...pettyForm, supplierOrBeneficiary: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Concepto del Gasto:</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Clavos, alambre y bolsas de cemento urgente"
                  value={pettyForm.concept}
                  onChange={(e) => setPettyForm({ ...pettyForm, concept: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Monto Pagado (Gs.):</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={pettyForm.amount}
                  onChange={(e) => setPettyForm({ ...pettyForm, amount: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-sm font-bold text-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowNewPettyTxModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs cursor-pointer"
                >
                  Confirmar Egreso de Caja
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 7: CERRAR RENDICION SEMANAL */}
      {showRendicionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-xl relative text-xs">
            <button
              onClick={() => setShowRendicionModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-3">
              <Banknote className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">Cierre de Rendición Semanal</h3>
            </div>

            <p className="text-slate-600 mb-4 leading-relaxed">
              Esta acción agrupa todos los comprobantes menores de la semana, genera el informe de rendición para
              Auditoría y <strong>restituye el saldo del Fondo Fijo</strong> a{" "}
              <strong>{formatMoney(pettyCashFund.assignedAmount, currency)}</strong>.
            </p>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2 mb-4 font-mono">
              <div className="flex items-center justify-between text-slate-600">
                <span>Comprobantes a rendir:</span>
                <span className="font-bold">
                  {pettyCashTx.filter((t) => t.settlementStatus === "PENDIENTE_RENDICION").length}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-900 font-bold text-sm pt-2 border-t border-slate-200">
                <span>Monto a Reembolsar:</span>
                <span className="text-blue-700">
                  {formatMoney(
                    pettyCashTx
                      .filter((t) => t.settlementStatus === "PENDIENTE_RENDICION")
                      .reduce((acc, t) => acc + t.amount, 0),
                    currency
                  )}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRendicionModal(false)}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCerrarRendicionSemanal}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs cursor-pointer"
              >
                Aprobar y Reembolsar Fondo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
