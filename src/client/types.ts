export interface Project {
  id: number;
  code: string;
  name: string;
  location?: string | null;
  roadSection?: string | null;
  contractNumber?: string | null;
  clientName?: string | null;
  executionMonths?: number | null;
  currency?: string;
  globalBudget: string | number;
  montoContractualManual?: string | number | null;
  montoRealActualizado?: string | number | null;
  startDate?: string | null;
  endDate?: string | null;
  status: string;
  budgetItems?: BudgetItem[];
  workFronts?: WorkFront[];
}

export interface User {
  id: number;
  fullName: string;
  email: string;
  role: string;
  roleLabel: string;
  initials: string;
}

export type BudgetNodeKind = "RUBRO" | "SUBRUBRO" | "ITEM";

/**
 * Nodo del presupuesto. Solo los ITEM tienen cantidad/PU/monto propios; los montos de
 * rubros se obtienen sumando a sus hijos (ver CostControlData).
 * Las columnas cost*, subcontract* y certified* son el caché del libro mayor.
 */
export interface BudgetItem {
  id: number;
  projectId: number;
  parentId?: number | null;
  code: string;
  name: string;
  category: string;
  path?: string;
  nodeKind?: BudgetNodeKind;
  hierarchyLevel?: number;
  sortOrder?: number;
  isSystem?: boolean;
  unit?: string | null;
  totalQuantity?: string | number | null;
  unitPrice?: string | number | null;
  originalAmount: string | number;
  costCommittedAmount?: string | number;
  costActualAmount?: string | number;
  subcontractQuantity?: string | number;
  certifiedQuantity?: string | number;
  certifiedAmount?: string | number;
}

export interface BudgetWarning {
  budgetItemId: number;
  code: string;
  name: string;
  kind: "COST_OVER_BUDGET" | "QUANTITY_OVER_CONTRACT";
  message: string;
}

export type BudgetMovementSource =
  | "PURCHASE_ORDER"
  | "SUBCONTRACT"
  | "PETTY_CASH"
  | "CLIENT_CERTIFICATE"
  | "MANUAL_ADJUSTMENT"
  | "LABOR_COST"
  | "STOCK_TRANSFER"
  | "INVOICE";

export interface CostNode {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  nodeKind: BudgetNodeKind;
  level: number;
  isSystem: boolean;
  unit: string | null;
  totalQuantity: number;
  unitPrice: number;
  budget: number;
  committed: number;
  actual: number;
  certifiedAmount: number;
  certifiedQuantity: number;
  subcontractQuantity: number;
  balance: number;
  overBudget: boolean;
  progressPct: number | null;
  bySource: Partial<Record<BudgetMovementSource, number>>;
  executedQuantity: number;
  executedAmount: number;
  quantityExceeded: boolean;
  costoMetaUnit: number | null;
  costoMetaTotal: number;
  costoMetaFuente: "ACU" | "K" | null;
  metaMaterial: number;
  metaManoObra: number;
  metaEquipo: number;
  ventaSinIva: number;
  margenPrevisto: number;
  margenPct: number | null;
  acuComponentes: number;
  acuSuperaOferta: boolean;
  itemsSinCostoMeta: number;
  pareto: boolean;
}

/** Control de certificados de subcontratistas contra la medición oficial (por obra). */
export type ControlMedicionSub = "AVISAR" | "BLOQUEAR" | "NO_CONTROLAR";

export interface CostControlData {
  project: { id: number; code: string; name: string; currency: string; contractAmount: number; coeficienteK: number | null; ivaPct: number; controlMedicionSub: ControlMedicionSub };
  kpis: {
    budget: number;
    committed: number;
    actual: number;
    certified: number;
    balance: number;
    generalExpenses: number;
    generalExpensesShare: number;
    overBudgetItems: number;
    exceededItems: number;
    bySource: Partial<Record<BudgetMovementSource, number>>;
    costoMeta: number;
    ventaSinIva: number;
    margenPrevisto: number;
    margenPct: number | null;
    itemsConAcu: number;
    itemsSinCostoMeta: number;
    itemsSuperanOferta: number;
    itemsPareto: number;
  };
  nodes: CostNode[];
}

export interface BudgetMovement {
  id: number;
  budgetItemId: number;
  source: BudgetMovementSource;
  stage: "COMMITTED" | "ACTUAL";
  amount: string | number;
  quantity: string | number | null;
  sourceType: string;
  sourceId: number;
  sourceNumber: string | null;
  reversalOfId: number | null;
  overBudget: boolean;
  note: string | null;
  createdAt: string;
  budgetItem?: { id: number; code: string; name: string };
}

/** Partida hoja donde se puede imputar un gasto, con su saldo. */
export interface ImputableItem {
  id: number;
  code: string;
  name: string;
  unit: string | null;
  isSystem: boolean;
  rubro: string;
  budget: number;
  committed: number;
  balance: number;
}

export interface PettyCashExpense {
  id: number;
  fundId: number;
  budgetItemId: number | null;
  insumoId?: number | null;
  quantity?: number | null;
  insumo?: { id: number; code: string; description: string; unit: string; tipo: InsumoTipo } | null;
  date: string;
  receiptNumber: string;
  supplierName: string;
  concept: string;
  amount: string | number;
  responsibleName?: string | null;
  status: "PENDIENTE_RENDICION" | "RENDIDO" | "RECHAZADO";
  rejectionReason?: string | null;
  budgetItem?: { id: number; code: string; name: string } | null;
}

export interface PettyCashFund {
  id: number;
  projectId: number;
  name: string;
  responsibleName: string;
  assignedAmount: string | number;
  active: boolean;
  pendingAmount: number;
  currentBalance: number;
  expenses: PettyCashExpense[];
}

export interface CuentaFinanciera {
  id: number;
  projectId: number;
  nombre: string;
  tipo: "BANCO" | "CAJA";
  moneda: string;
  banco?: string | null;
  numeroCuenta?: string | null;
  cuentaContableId?: number | null;
  cuentaContable?: { id: number; codigo: string; nombre: string } | null;
  saldoInicial: number;
  saldoActual: number;
  active: boolean;
}

export interface MovimientoCuentaFinanciera {
  id: number;
  cuentaFinancieraId: number;
  fecha: string;
  tipo: "INGRESO" | "EGRESO";
  monto: number;
  concepto: string;
  confirmado: boolean;
  sourceType: string;
  sourceId: number;
  saldoAcumulado: number;
}

export interface Cheque {
  id: number;
  cuentaFinancieraId: number;
  tipo: "EMITIDO" | "RECIBIDO";
  numero: string;
  monto: number;
  fechaEmision: string;
  fechaPago: string;
  estado: "PENDIENTE" | "DEPOSITADO" | "ACREDITADO" | "RECHAZADO" | "ANULADO";
  partnerId?: number | null;
  partner?: { id: number; name: string } | null;
  cuenta?: { id: number; nombre: string } | null;
  notas?: string | null;
}

export type AgingBucket = "A_VENCER" | "0-30" | "31-60" | "61-90" | "+90";

export interface FacturaCuentaCorriente {
  id: number;
  numeroFactura: string;
  tipo: "EMITIDA" | "RECIBIDA";
  estado: string;
  partner?: { id: number; name: string; taxId: string } | null;
  fechaEmision: string;
  fechaVencimiento: string;
  total: number;
  montoRetenido: number;
  totalPagado: number;
  saldo: number;
  bucket: AgingBucket | null;
  diasVencido: number;
}

export interface Anticipo {
  id: number;
  projectId: number;
  partnerId?: number | null;
  partner?: { id: number; name: string } | null;
  tipo: "OTORGADO" | "RECIBIDO";
  monto: number;
  fecha: string;
  concepto?: string | null;
  saldoAplicado: number;
  saldoPendiente: number;
  estado: "PENDIENTE" | "PARCIAL" | "LIBERADO";
}

export interface RetencionFondo {
  id: number;
  projectId: number;
  partnerId?: number | null;
  partner?: { id: number; name: string } | null;
  tipo: "FONDO_REPARO" | "RETENCION_GARANTIA";
  monto: number;
  fecha: string;
  sourceType: string;
  sourceId: number;
  saldoLiberado: number;
  saldoPendiente: number;
  estado: "PENDIENTE" | "PARCIAL" | "LIBERADO";
  notas?: string | null;
}

export interface ConfigRetencionesAnticipos {
  projectId: number;
  pctFondoReparo: number;
  pctRetencionGarantia: number;
  pctAnticipo: number;
}

export interface WorkFront {
  id: number;
  projectId: number;
  /** Número del Área ("2" de "Área: 2) BLOQUE 6") o código automático del auxiliar. */
  codigo?: string | null;
  orden?: number;
  tipo?: "AREA" | "AUXILIAR";
  name: string;
  chiefId?: number | null;
  chief?: Personnel | null;
  /** Rubro raíz del presupuesto que generó este frente automáticamente; null = frente manual. */
  budgetItemId?: number | null;
}

export interface Personnel {
  id: number;
  fullName: string;
  role: "JEFE_FRENTE" | "COMPRAS" | "GERENCIA" | "ALMACEN";
  email?: string | null;
}

export interface Partner {
  id: number;
  kind: "SUPPLIER" | "SUBCONTRACTOR" | "BOTH";
  name: string;
  taxId: string;
  fiscalAddress?: string | null;
  phone?: string | null;
  email?: string | null;
  classification?: string | null;
  active?: boolean;
}

export interface Material {
  id: number;
  code: string;
  description: string;
  unit: string;
  category: string;
  estimatedCost: string | number;
  tipo?: InsumoTipo;
  categoria?: InsumoCategoria;
}

export interface MaterialRequestDetail {
  id: number;
  materialId: number;
  budgetItemId?: number | null;
  quantity: string | number;
  material?: Material;
  budgetItem?: BudgetItem | null;
}

export interface MaterialRequest {
  id: number;
  number: string;
  projectId: number;
  workFrontId?: number | null;
  requestedById?: number | null;
  requestedDate?: string | null;
  status: "BORRADOR" | "APROBADO_PARA_COMPRA" | "EMITIDA" | "RECIBIDO" | "ANULADO";
  notes?: string | null;
  project?: Project;
  workFront?: WorkFront | null;
  requestedBy?: Personnel | null;
  details?: MaterialRequestDetail[];
  purchaseOrders?: { id: number; number: string; status: MaterialRequest["status"] }[];
  createdAt: string;
}

export interface PurchaseOrderDetail {
  id: number;
  materialId: number;
  budgetItemId: number | null;
  tipo?: InsumoTipo;
  quantity: string | number;
  unitPrice: string | number;
  subtotal: string | number;
  material?: Material;
  budgetItem?: BudgetItem | null;
  requestDetail?: MaterialRequestDetail;
}

export interface PurchaseOrder {
  id: number;
  number: string;
  projectId: number;
  partnerId: number;
  materialRequestId?: number | null;
  fecha?: string;
  issueDate?: string | null;
  receivedDate?: string | null;
  receiptNumber?: string | null;
  expectedDate?: string | null;
  status: "BORRADOR" | "APROBADO_PARA_COMPRA" | "EMITIDA" | "RECIBIDO" | "ANULADO";
  totalAmount: string | number;
  stockRegistered: boolean;
  partner?: Partner;
  project?: Project;
  materialRequest?: MaterialRequest;
  details?: PurchaseOrderDetail[];
  createdAt: string;
}

export interface SubcontractCertificate {
  id: number;
  subcontractId: number;
  number: string;
  issueDate: string;
  amount: string | number;
  status: "BORRADOR" | "APROBADO_PARA_COMPRA" | "EMITIDA" | "RECIBIDO" | "ANULADO";
  advancePercentage?: string | number | null;
  notes?: string | null;
}

export interface SubcontractorContract {
  id: number;
  number: string;
  projectId: number;
  partnerId: number;
  budgetItemId: number;
  description: string;
  contractAmount: string | number;
  certifiedAmount?: string | number;
  paidAmount?: string | number;
  status: "BORRADOR" | "ACTIVO" | "CERRADO" | "CANCELADO";
  startDate?: string | null;
  endDate?: string | null;
  partner?: Partner;
  project?: Project;
  budgetItem?: BudgetItem;
  certificates?: SubcontractCertificate[];
}

export interface WarehouseStock {
  id: number;
  projectId: number;
  materialId: number;
  currentStock: string | number;
  reservedStock: string | number;
  project?: Project;
  material?: Material;
}

export type StockMovementKind =
  | "RECEIPT"
  | "CONSUMPTION"
  | "ADJUSTMENT"
  | "REVERSAL"
  | "DIRECT_ISSUE"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "INVENTORY_ADJUSTMENT";

export interface StockMovement {
  id: number;
  projectId: number;
  materialId: number;
  kind: StockMovementKind;
  movementType: StockMovementKind;
  quantity: string | number;
  fecha: string;
  budgetItemId?: number | null;
  counterpartProjectId?: number | null;
  unitCost?: string | number | null;
  sourceType: string;
  sourceId?: number | null;
  note?: string | null;
  createdAt: string;
  project?: Project;
  material?: Material;
  budgetItem?: { id: number; code: string; name: string } | null;
  counterpartProject?: { id: number; code: string; name: string } | null;
}

export interface ConteoInventario {
  id: number;
  projectId: number;
  materialId: number;
  fecha: string;
  cantidadContada: number;
  stockTeorico: number;
  diferencia: number;
  fotoUrl?: string | null;
  nota?: string | null;
  createdBy?: string | null;
  createdAt: string;
  material?: { id: number; code: string; description: string; unit: string; tipo: InsumoTipo };
}

export interface DashboardData {
  kpis: {
    globalBudget: number;
    originalBudget: number;
    realSpend: number;
    committed: number;
    available: number;
    variance: number;
    issuedPurchaseOrders: number;
    subcontractCertified: number;
    subcontractPaid: number;
    contractualAmount: number;
    realUpdated: number;
    totalSpent: number;
    availableReal: number;
  };
  budgetByItem: {
    id: number;
    code: string;
    name: string;
    category: string;
    originalAmount?: number;
    committedAmount?: number;
    executedAmount?: number;
    available?: number;
    original?: number;
    committed?: number;
    executed?: number;
    remaining?: number;
  }[];
  issuedOrders: {
    id: number;
    number: string;
    partnerName: string;
    issueDate: string;
    totalAmount: number;
  }[];
  subcontractors: {
    id: number;
    number: string;
    partnerName: string;
    description: string;
    contractAmount: number;
    status: string;
    certifiedAmount: number;
  }[];
  recentCertificates: {
    id: number;
    number: string;
    subcontractNumber: string;
    partnerName: string;
    issueDate: string;
    amount: number;
    status: string;
  }[];
}

export interface Certificacion {
  id: number;
  projectId?: number | null;
  partnerId?: number | null;
  budgetItemId?: number | null;
  subcontratista?: string | null;
  rubro?: string | null;
  unidad?: string | null;
  cantidad_medida: number;
  monto_total: number;
  estado: "BORRADOR" | "EN_REVISION" | "APROBADA" | "RECHAZADA";
  evidencia?: string | null;
  esAdenda: boolean;
  project?: Project;
  partner?: Partner;
  budgetItem?: BudgetItem;
  createdAt?: string;
  updatedAt?: string;
}

export interface MachineryEquipment {
  id: string;
  code: string;
  name: string;
  type: "PESADA" | "TRANSPORTE" | "COMPACTACION" | "ASFALTO" | "MENOR";
  brandModel: string;
  plateOrSeries: string;
  workFrontId?: number;
  operatorName: string;
  status: "OPERATIVO" | "MANTENIMIENTO" | "STANDBY";
  fuelConsumptionPerHour: number; // liters/hour
  hourMeter: number;
}

export interface DailySiteLog {
  id: string;
  date: string;
  workFrontId: number;
  weather: "DESPEJADO" | "NUBLADO" | "LLUVIA_LEVE" | "LLUVIA_INTENSA_PARALIZADA";
  temperatureC: number;
  workStatus: "NORMAL" | "PARCIAL" | "SUSPENDIDA";
  directLaborCount: number;
  subcontractorLaborCount: number;
  hoursWorked: number;
  activitiesDescription: string;
  incidentsOrDelays?: string;
  supervisorName: string;
}

// ----------------------------------------------------
// CONTABILIDAD & FINANZAS TYPES
// ----------------------------------------------------

export interface FiscalInvoice {
  id: string;
  projectId: number;
  type: "PROVEEDOR" | "SUBCONTRATISTA" | "CLIENTE";
  invoiceNumber: string;
  timbrado: string;
  issueDate: string;
  dueDate: string;
  paymentCondition: "CONTADO" | "CREDITO_15" | "CREDITO_30" | "CREDITO_45" | "CREDITO_60";
  partnerId?: number;
  partnerName: string;
  partnerTaxId?: string;
  sourceType: "PURCHASE_ORDER" | "SUBCONTRACT_CERTIFICATE" | "CLIENT_CERTIFICATE" | "DIRECTO";
  sourceReference: string; // e.g., "OC-002" or "CERT-SUB-04" or "CERT-CLIENT-02"
  currency: "PYG" | "USD";
  subtotal: number;
  taxAmount: number; // IVA 10% or 5%
  retentionAmount: number; // Retención IVA / Renta / Fondo de reparo
  totalAmount: number; // Neto a pagar / cobrar
  status: "PENDIENTE" | "PROGRAMADO_PAGO" | "PAGADO" | "COBRADO" | "ANULADO";
  paidDate?: string;
  paymentMethod?: string;
  notes?: string;
  documentUrl?: string;
}

export interface ClientBillableCertificate {
  id: string;
  projectId: number;
  certificateNumber: string;
  periodName: string;
  issueDate: string;
  dueDate: string;
  clientName: string;
  contractNumber: string;
  certifiedAmountGross: number;
  advanceDeduction: number; // Descuento de anticipo
  guaranteeRetention: number; // Retención de fondo de reparo (5%)
  netAmountToCollect: number;
  status: "BORRADOR" | "PRESENTADO_FISCAL" | "APROBADO_PARA_PAGO" | "COBRADO";
  invoiceNumber?: string;
  collectedDate?: string;
  notes?: string;
}

// ----------------------------------------------------
// MÓDULO: MEDICIONES Y CERTIFICACIONES AVANZADAS
// ----------------------------------------------------
export type CertificationStatus =
  | "MEDICION_BORRADOR"
  | "MEDICION_CERRADA"
  | "CERTIFICADO_BORRADOR"
  | "APROBADO";

export interface AuxiliaryCalculation {
  id?: number;
  certificationItemId?: number;
  descripcion: string;
  largo: number;
  ancho: number;
  alto: number;
  factor_repeticion: number;
  subtotal: number;
  location?: string | null;
  isDeduction?: boolean;
  needsReview?: boolean;
  createdAt?: string;
}

export interface ItemPhoto {
  id?: number;
  certificationItemId?: number;
  url: string;
  comentario?: string | null;
  fechaCaptura?: string;
}

export interface CertificationItem {
  id?: number;
  certificationId?: number;
  /** Null: renglón de subcontratista todavía sin rubro presupuestario (solo borrador). */
  budgetItemId: number | null;
  planillaLineaId?: number | null;
  planillaLinea?: SubPlanillaLinea | null;
  cantidadAnterior: number;
  cantidadPresente: number;
  cantidadAcumulada: number;
  precioUnitario: number;
  montoTotal: number;
  priceSource?: "VENTA" | "MANO_DE_OBRA";
  precioSugerido?: number | string | null;
  precioFuente?: "LISTA_OBRA" | "ACU_MO" | null;
  insumoId?: number | null;
  budgetItem?: BudgetItem;
  auxiliaryCalculations?: AuxiliaryCalculation[];
  photos?: ItemPhoto[];
}

export interface Certification {
  id: number;
  projectId: number;
  partnerId?: number | null;
  numero: number;
  fecha: string;
  estado: CertificationStatus;
  montoTotal: number;
  notes?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  contractId?: number | null;
  retentionPct?: number | string;
  retentionAmount?: number | string;
  netAmount?: number | string;
  project?: Project;
  partner?: Partner | null;
  contract?: SubcontractorContract | null;
  items: CertificationItem[];
  invoices?: any[];
  createdAt?: string;
  updatedAt?: string;
}



// ----------------------------------------------------
// DASHBOARD: CARTERA Y RESUMEN DE OBRA
// ----------------------------------------------------
export type Health = "good" | "warn" | "bad" | "none";

export interface ProjectKpis {
  contract: number;
  budget: number;
  committed: number;
  actual: number;
  certified: number;
  balance: number;
  progress: number; // certificado ÷ presupuesto
  costPct: number; // costo incurrido ÷ presupuesto
  result: number; // certificado − costo
  deviation: number; // costo % − avance %
  health: Health;
  overBudgetItems: number;
}

export interface PendingItem {
  key: string;
  label: string;
  count: number;
  tab: "suministros" | "ejecucion-certificaciones" | "contabilidad-finanzas" | "centro-costos";
  subTab?: string;
}

export interface ProjectOverview {
  project: { id: number; code: string; name: string; currency: string; contractAmount: number };
  hasBudget: boolean;
  kpis: ProjectKpis;
  topRubros: {
    id: number;
    code: string;
    name: string;
    budget: number;
    committed: number;
    usage: number;
    progress: number;
    overBudget: boolean;
  }[];
  pending: PendingItem[];
  /** requested = solicitudes de fondos sin pagar (saldo). */
  cash: { receivable: number; payable: number; requested: number };
  curve: { label: string; values: { certified: number; cost: number } }[];
}

export interface PortfolioRow extends ProjectKpis {
  id: number;
  code: string;
  name: string;
  clientName?: string | null;
  location?: string | null;
  status: string;
  pendingCount: number;
}

export interface Portfolio {
  totals: {
    projects: number;
    contract: number;
    budget: number;
    certified: number;
    actual: number;
    result: number;
    atRisk: number;
  };
  projects: PortfolioRow[];
}

// ----------------------------------------------------
// PRECIOS DE MANO DE OBRA Y CERTIFICADO (Medición N / Cert N)
// ----------------------------------------------------
export interface LaborPrice {
  id: number;
  projectId: number;
  code: string;
  description: string;
  unit: string | null;
  unitPrice: number;
  sector: string | null;
}

export interface LaborPreviewRow {
  rowNumber: number;
  code: string;
  description: string;
  unit: string;
  unitPrice: number | null;
  sector: string | null;
  errors: string[];
  warnings: string[];
}

export interface MeasurableItem {
  id: number;
  code: string;
  name: string;
  category: string;
  unit: string;
  unitPrice: number;
  salePrice: number;
  laborPrice: number | null;
  laborPriceSource?: "LISTA_OBRA" | "ACU_MO" | null;
  priceSource: "VENTA" | "MANO_DE_OBRA";
  missingPrice: boolean;
  totalContractQuantity: number;
  cantidadAnterior: number;
  montoAnterior: number;
  /** Planilla de subcontratista: Área (rubro raíz) y capítulo/planta del ítem. */
  areaId?: number | null;
  capitulo?: string;
}

export interface SubPlanillaLinea {
  id: number;
  projectId: number;
  partnerId: number;
  workFrontId: number;
  laborPriceId: number;
  budgetItemId: number | null;
  numero: string;
  correlativo: number;
  /** Acumulado aprobado del contratista en esta línea. */
  cantidadAnterior?: number;
  workFront?: { id: number; name: string; codigo: string | null };
  laborPrice?: { id: number; code: string; description: string; unit: string | null };
}

/** rubros-disponibles con destino subcontratista. */
export interface PlanillaSubData {
  tipo: "SUBCONTRATISTA";
  items: MeasurableItem[];
  frentes: { id: number; name: string; codigo: string | null; tipo: "AREA" | "AUXILIAR"; budgetItemId: number | null }[];
  listaMO: { id: number; code: string; description: string; unit: string | null; unitPrice: number; sector: string | null }[];
  lineas: SubPlanillaLinea[];
  historial: { id: number; workFrontId: number; laborPriceId: number; budgetItemId: number | null }[];
  gastosGenerales: { id: number; code: string; name: string; unit: string | null } | null;
}

export interface CertificateSummaryRow {
  code: string;
  name: string;
  unit: string;
  contractedQuantity: number;
  previousQuantity: number;
  periodQuantity: number;
  accumulatedQuantity: number;
  progress: number;
  overContract: boolean;
  unitPrice: number;
  contractedAmount: number;
  previousAmount: number;
  periodAmount: number;
  accumulatedAmount: number;
}

export interface CertificateSummaryData {
  certification: Certification;
  summary: {
    rows: CertificateSummaryRow[];
    contractAmount: number;
    previousAmount: number;
    periodAmount: number;
    accumulatedAmount: number;
    balance: number;
    retentionPct: number;
    retentionAmount: number;
    netAmount: number;
  };
  checks: {
    measurementMatchesCertificate: boolean;
    previousMatchesHistory: boolean;
    noPendingReview: boolean;
    pendingReview: number;
    overContract: string[];
    /** Subcontratista: precio distinto del sugerido de la lista de MO. */
    priceWarnings?: string[];
    /** Subcontratista: N° de líneas sin rubro presupuestario (impiden aprobar). */
    sinRubro?: string[];
    /** Subcontratista: supera la medición oficial acumulada. */
    overMeasured?: string[];
    controlMedicionSub?: ControlMedicionSub;
  };
}

// ═══════════════════════════════════════════
// RRHH
// ═══════════════════════════════════════════

export type EmpleadoTipo = "MENSUALERO" | "JORNALERO" | "DESTAJISTA";
export type AsistenciaEstado = "PRESENTE" | "AUSENTE" | "MEDIA_JORNADA" | "FERIADO";
export type LiquidacionEstado = "BORRADOR" | "APROBADA" | "PAGADA";

export interface EmpleadoDoc {
  id: number;
  empleadoId: number;
  tipo: string;
  url: string;
  nombre: string;
  createdAt?: string;
}

export interface Empleado {
  id: number;
  personnelId?: number | null;
  projectId?: number | null;
  fullName: string;
  ci: string;
  oficio: string;
  tipo: EmpleadoTipo;
  fechaIngreso: string;
  salarioBase: number | string;
  nroIPS?: string | null;
  banco?: string | null;
  cuentaBanco?: string | null;
  activo: boolean;
  notas?: string | null;
  costoHoraManual?: number | string | null;
  project?: { id: number; name: string; code: string } | null;
  documentos?: EmpleadoDoc[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Asistencia {
  id: number;
  empleadoId: number;
  projectId: number;
  budgetItemId?: number | null;
  fecha: string;
  estado: AsistenciaEstado;
  horasNormales: number | string;
  horasExtra: number | string;
  jornal: number | string;
  notas?: string | null;
  empleado?: { id: number; fullName: string; tipo: EmpleadoTipo; salarioBase: number | string };
  budgetItem?: { id: number; code: string; name: string } | null;
}

export interface LiquidacionPersonal {
  id: number;
  empleadoId: number;
  projectId: number;
  periodo: string;
  estado: LiquidacionEstado;
  diasTrabajados: number | string;
  horasNormales: number | string;
  horasExtra: number | string;
  salarioBase: number | string;
  valorHoraExtra: number | string;
  montoHorasExtra: number | string;
  bonificacionFamiliar: number | string;
  otrosBonos: number | string;
  subTotal: number | string;
  ipsObrero: number | string;
  ipsPatronal: number | string;
  aguinaldo: number | string;
  anticipos: number | string;
  otrosDescuentos: number | string;
  netoAPagar: number | string;
  costoTotal: number | string;
  budgetItemId?: number | null;
  notas?: string | null;
  empleado?: { id: number; fullName: string; ci: string; tipo: EmpleadoTipo };
  project?: { id: number; name: string; code: string };
  budgetItem?: { id: number; code: string; name: string } | null;
}

export interface RRHHConfig {
  id?: number;
  projectId?: number | null;
  pctIpsObrero: number | string;
  pctIpsPatronal: number | string;
  factorHoraExtra: number | string;
  horasDiasLaborales: number | string;
  bonificacionFamiliar: number | string;
  aguinaldoMeses: number | string;
  pctVacaciones?: number | string;
  pctOtrasCargas?: number | string;
  diasLaboralesMes?: number | string;
}

export interface CostoHoraEmpleado {
  id: number;
  fullName: string;
  tipo: EmpleadoTipo;
  salarioBase: number;
  base: number;
  factor: number;
  costoHora: number;
  manual: boolean;
}

export interface CostoHoraData {
  cargas: { ipsPatronal: number; aguinaldo: number; vacaciones: number; otras: number; total: number };
  empleados: CostoHoraEmpleado[];
}

// ─── Parte diario ───────────────────────────────────────────────────────────

export interface ParteCatalogo {
  projectId: number;
  generadoEl: string;
  items: { id: number; code: string; name: string; unit: string }[];
  empleados: { id: number; fullName: string; oficio: string; tipo: EmpleadoTipo; costoHora: number }[];
  equipos: { id: number; code: string; description: string; unit: string; costoHora: number; consumoLh: number | null }[];
  materiales: { id: number; code: string; description: string; unit: string }[];
  frentes: { id: number; name: string }[];
}

/** Lo que el celular manda (y guarda en la cola si no hay conexión). */
export interface ParteDiarioInput {
  clientUuid: string;
  fecha: string;
  workFrontId?: number | null;
  clima?: string | null;
  estadoFaena: "NORMAL" | "PARCIAL" | "SUSPENDIDA";
  actividades?: string | null;
  observaciones?: string | null;
  supervisor?: string | null;
  personal: { empleadoId: number; budgetItemId: number | null; horas: number }[];
  equipos: { insumoId: number; budgetItemId: number | null; horas: number }[];
  combustible: { equipoId: number; litros: number; horometro: number | null; fotoUrl?: string | null; nota?: string | null }[];
  viajes: {
    equipoId: number | null;
    origen: string;
    destino: string;
    materialId: number | null;
    materialTexto?: string | null;
    cantidad: number;
    unidad: "M3" | "T";
    km: number | null;
    budgetItemId: number | null;
  }[];
}

type ItemRef = { code: string; name: string } | null;

export interface ParteDiarioRow {
  id: number;
  clientUuid: string;
  fecha: string;
  frente: string | null;
  clima: string | null;
  estadoFaena: string;
  actividades: string | null;
  observaciones: string | null;
  supervisor: string | null;
  personal: { id: number; empleado: string; item: ItemRef; horas: number }[];
  equipos: { id: number; equipo: { code: string; description: string }; item: ItemRef; horas: number }[];
  combustible: { id: number; equipo: { code: string; description: string }; litros: number; horometro: number | null; fotoUrl: string | null }[];
  viajes: { id: number; camion: string | null; origen: string; destino: string; material: string | null; cantidad: number; unidad: "M3" | "T"; km: number | null; item: ItemRef }[];
}

export type EstadoCombustible = "PRIMERA" | "OK" | "ALERTA" | "REVISAR" | "SIN_HORAS" | "SIN_TEORICO" | "HOROMETRO_INVALIDO";

export interface CombustibleData {
  cargas: {
    id: number;
    equipoId: number;
    fecha: string;
    litros: number;
    horometro: number | null;
    desdeFecha: string | null;
    horasHorometro: number | null;
    horasParte: number;
    horasUsadas: number | null;
    fuenteHoras: "HOROMETRO" | "PARTE" | null;
    consumoReal: number | null;
    consumoTeorico: number | null;
    desvioPct: number | null;
    estado: EstadoCombustible;
    alertaHoras: boolean;
    fotoUrl: string | null;
  }[];
  resumen: { equipoId: number; litros: number; horas: number; consumoReal: number | null; consumoTeorico: number | null; desvioPct: number | null; estado: EstadoCombustible; alertas: number }[];
  equipos: { id: number; code: string; description: string; unit: string; consumoLh: number | null; toleranciaPct: number }[];
}

export interface ViajesData {
  viajes: { id: number; fecha: string; parteId: number | null; camion: string | null; origen: string; destino: string; material: string | null; cantidad: number; unidad: "M3" | "T"; km: number | null; item: { id: number; code: string; name: string } | null }[];
  resumen: { item: { id: number; code: string; name: string } | null; viajes: number; m3: number; t: number; km: number }[];
}

// ─── Catálogo de insumos ────────────────────────────────────────────────────

export type InsumoTipo = "DIRECTO" | "COMUN" | "TIEMPO";
export type InsumoCategoria = "MATERIAL" | "MANO_OBRA" | "EQUIPO";

export interface Insumo {
  id: number;
  code: string;
  description: string;
  unit: string;
  category: string;
  tipo: InsumoTipo;
  categoria: InsumoCategoria;
  sector: string | null;
  toleranciaPct: number;
  /** Equipos: litros teóricos por hora. */
  consumoLh: number | null;
  active: boolean;
  estimatedCost: number;
  precio: number | null;
  vigenteDesde: string | null;
  proximoPrecio: { precio: number; desde: string } | null;
  cantidadPrecios: number;
}

export interface InsumoPrecio {
  id: number;
  materialId: number;
  price: number;
  validFrom: string;
  source: string | null;
  createdBy: string | null;
  createdAt: string;
}

export type MoImportStatus = "NUEVO" | "CAMBIA_PRECIO" | "ACTUALIZA_DATOS" | "SIN_CAMBIOS" | "ERROR";

export interface MoImportRow {
  rowNumber: number;
  sourceCode: string;
  code: string;
  description: string;
  unit: string;
  price: number | null;
  sector: string | null;
  errors: string[];
  warnings: string[];
  status: MoImportStatus;
  precioActual: number | null;
  insumoId: number | null;
}

export interface MoImportPreview {
  sheetName: string;
  vigenteDesde: string;
  rows: MoImportRow[];
  summary: { total: number; nuevos: number; cambiaPrecio: number; actualizaDatos: number; sinCambios: number; errores: number };
}

// ─── ACU (análisis de costo unitario) ───────────────────────────────────────

export type AcuGrupo = "MATERIAL" | "MANO_OBRA" | "EQUIPO";

export interface AcuLinea {
  id: number;
  insumoId: number;
  codigo: string;
  insumo: string;
  unidad: string;
  tipo: InsumoTipo;
  grupo: AcuGrupo;
  consumo: number;
  desperdicioPct: number;
  precio: number | null;
  vigenteDesde: string | null;
  parcial: number;
  sortOrder: number;
  nota: string | null;
}

export interface ItemAcuData {
  item: { id: number; code: string; name: string; unit: string | null; quantity: number; unitPrice: number; path: string };
  project: { id: number; code: string; name: string; coeficienteK: number | null; ivaPct: number };
  fecha: string;
  lineas: AcuLinea[];
}

export interface AcuBibliotecaItem {
  id: number;
  code: string;
  name: string;
  unit: string | null;
  project: { id: number; code: string; name: string };
  componentes: number;
  costoAcu: number | null;
  lineas: { codigo: string; insumo: string; unidad: string; consumo: number; grupo: AcuGrupo }[];
}

export type ReconFuente = "OC" | "SUBCONTRATO" | "CAJA_CHICA" | "FACTURA" | "PERSONAL" | "OTROS";

export interface ReconciliationData {
  desde: string;
  hasta: string;
  porFuente: { fuente: ReconFuente; documentos: number; libro: number; diferencia: number }[];
  partidas: {
    tipo: "SIN_ASIENTO" | "SIN_DOCUMENTO" | "DIFERENCIA" | "FUERA_DE_RANGO" | "FACTURA_DIFIERE" | "SIN_FACTURA";
    fuente: ReconFuente;
    numero: string;
    fecha: string | null;
    documento: number | null;
    libro: number | null;
    diferencia: number;
    detalle: string;
  }[];
  totales: { documentos: number; libro: number; diferencia: number };
  motor: {
    totalContable: number;
    imputado: number;
    perdidas: number;
    noImputado: number;
    a: number;
    b: number;
    c: number;
    ok: boolean;
    diferencia: number;
    diferenciaConLibro: number;
    avisos: string[];
  };
}

// ─── Presupuesto congelado, adendas y Previsto vs Ejecutado ─────────────────

export type AdendaEstado = "BORRADOR" | "APROBADA" | "ANULADA";

export interface AdendaLineaRow {
  id: number;
  adendaId: number;
  tipo: "VARIACION" | "EXTRA";
  budgetItemId: number | null;
  deltaQuantity: number;
  nota: string | null;
  codigo: string | null;
  nombre: string | null;
  unidad: string | null;
  parentId: number | null;
  precioUnitario: number | null;
  budgetItem?: { id: number; code: string; name: string; unit: string | null } | null;
}

export interface AdendaRow {
  id: number;
  projectId: number;
  numero: number;
  titulo: string;
  motivo: string | null;
  resolucion: string | null;
  fecha: string;
  estado: AdendaEstado;
  approvedAt: string | null;
  lineas: AdendaLineaRow[];
}

export interface AdendasData {
  congelado: boolean;
  adendas: AdendaRow[];
}

export interface AdendaLineaInput {
  tipo: "VARIACION" | "EXTRA";
  budgetItemId?: number | null;
  deltaQuantity: number;
  nota?: string | null;
  codigo?: string | null;
  nombre?: string | null;
  unidad?: string | null;
  parentId?: number | null;
  precioUnitario?: number | null;
}

export interface AdendaInput {
  titulo: string;
  motivo?: string | null;
  resolucion?: string | null;
  fecha: string;
  lineas: AdendaLineaInput[];
}

/** Fila de la planilla Previsto vs Ejecutado (cantidades solo en ítems; los montos de rubro los suma el cliente). */
export interface PrevistoRow {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  unit: string | null;
  nodeKind: "RUBRO" | "SUBRUBRO" | "ITEM";
  sortOrder: number;
  unitPrice: number | null;
  isExtra: boolean;
  extraAdendaNumero: number | null;
  contractQty: number | null;
  deltas: Record<number, number>;
  realQty: number | null;
  executedQty: number | null;
  saldoQty: number | null;
  pct: number | null;
  exceeded: boolean;
  contractAmount: number;
  realAmount: number;
  executedAmount: number;
  saldoAmount: number;
}

export interface PrevistoEjecutadoData {
  projectId: number;
  al: string;
  congelado: boolean;
  adendas: { id: number; numero: number; titulo: string; fecha: string; resolucion: string | null }[];
  rows: PrevistoRow[];
}

// ─── Motor de costos ───────────────────────────────────────────────────────

export type { EngineResult, ItemCost, MaterialResult, EstadoDesvio } from "../ecms/domain/costEngineMath";
import type { EngineResult } from "../ecms/domain/costEngineMath";

export interface CostEngineData extends EngineResult {
  projectId: number;
  generadoEl: string;
}

export interface ParteEquipoRow {
  id: number;
  fecha: string;
  insumoId: number;
  budgetItemId: number | null;
  horas: number;
  nota: string | null;
  insumo?: { code: string; description: string; unit: string };
  budgetItem?: { code: string; name: string } | null;
}

// Solicitudes de fondos (tesorería)
export type EstadoSolicitudFondo = "PENDIENTE" | "APROBADA" | "RECHAZADA" | "PROGRAMADA" | "PAGADA_PARCIAL" | "PAGADA" | "ANULADA";
export type OrigenSolicitudFondo = "CERT_SUBCONTRATISTA" | "ANTICIPO" | "FACTURA";

export interface SolicitudFondo {
  id: number;
  projectId: number;
  numero: number;
  origen: OrigenSolicitudFondo;
  sourceType: string;
  sourceId: number;
  partnerId: number;
  invoiceId?: number | null;
  anticipoId?: number | null;
  concepto: string;
  montoBruto: number;
  descuentoReparo: number;
  descuentoRetenciones: number;
  descuentoAnticipo: number;
  montoNeto: number;
  montoPagado: number;
  saldo: number;
  fechaVencimiento: string;
  fechaProgramada?: string | null;
  estado: EstadoSolicitudFondo;
  vencida: boolean;
  cuentaFinancieraId?: number | null;
  motivoRechazo?: string | null;
  creadoPor: string;
  aprobadoPor?: string | null;
  createdAt: string;
  project?: { id: number; code: string; name: string };
  partner?: { id: number; name: string; taxId: string };
  invoice?: { id: number; numeroFactura: string; estado: string } | null;
  cuentaFinanciera?: { id: number; nombre: string } | null;
}

export interface SolicitudesFondosFiltros {
  projectId?: number;
  estado?: EstadoSolicitudFondo[];
  origen?: OrigenSolicitudFondo | "";
  partnerId?: number;
  desde?: string;
  hasta?: string;
  vencidas?: "1" | "";
  montoMin?: number;
  montoMax?: number;
  page?: number;
  pageSize?: number;
}

export interface SolicitudesFondosPage {
  rows: SolicitudFondo[];
  total: number;
  page: number;
  pageSize: number;
  totales: Record<EstadoSolicitudFondo, { cantidad: number; neto: number; pagado: number; saldo: number }>;
  solicitadoSinPagar: number;
}

export interface PagoSolicitudInput {
  cuentaFinancieraId?: number | null;
  fecha?: string;
  metodo?: "TRANSFERENCIA" | "EFECTIVO";
  referencia: string;
}

export interface AnticipoOtorgado {
  id: number;
  projectId: number;
  partnerId: number | null;
  partner?: { id: number; name: string } | null;
  monto: number;
  fecha: string;
  concepto?: string | null;
  saldoAplicado: number;
  saldoPendiente: number;
  anuladoAt?: string | null;
  solicitud: { id: number; numero: number; estado: EstadoSolicitudFondo; montoPagado: number } | null;
}
