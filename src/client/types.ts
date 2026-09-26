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
  | "MANUAL_ADJUSTMENT";

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
}

export interface CostControlData {
  project: { id: number; code: string; name: string; currency: string; contractAmount: number };
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
  budgetItemId: number;
  date: string;
  receiptNumber: string;
  supplierName: string;
  concept: string;
  amount: string | number;
  responsibleName?: string | null;
  status: "PENDIENTE_RENDICION" | "RENDIDO" | "RECHAZADO";
  rejectionReason?: string | null;
  budgetItem?: { id: number; code: string; name: string };
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

export interface WorkFront {
  id: number;
  projectId: number;
  code: string;
  name: string;
  chiefId?: number | null;
  chief?: Personnel | null;
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
  purchaseOrders?: { id: number; number: string; status: string }[];
  createdAt: string;
}

export interface PurchaseOrderDetail {
  id: number;
  materialId: number;
  budgetItemId: number;
  quantity: string | number;
  unitPrice: string | number;
  subtotal: string | number;
  material?: Material;
  budgetItem?: BudgetItem;
  requestDetail?: MaterialRequestDetail;
}

export interface PurchaseOrder {
  id: number;
  number: string;
  projectId: number;
  partnerId: number;
  materialRequestId?: number | null;
  issueDate?: string | null;
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

export interface StockMovement {
  id: number;
  projectId: number;
  materialId: number;
  movementType: "RECEIPT" | "CONSUMPTION" | "ADJUSTMENT";
  quantity: string | number;
  sourceType: string;
  sourceId?: number | null;
  note?: string | null;
  createdAt: string;
  project?: Project;
  material?: Material;
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
  budgetItemId: number;
  cantidadAnterior: number;
  cantidadPresente: number;
  cantidadAcumulada: number;
  precioUnitario: number;
  montoTotal: number;
  priceSource?: "VENTA" | "MANO_DE_OBRA";
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
  cash: { receivable: number; payable: number };
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
  budgetItemId: number | null;
  code: string;
  description: string;
  unit: string | null;
  unitPrice: number;
  salePrice: number | null;
  margin: number | null;
  budgetItem?: { id: number; code: string; name: string; unit: string | null } | null;
}

export interface LaborPreviewRow {
  code: string;
  description: string;
  unit: string;
  unitPrice: number;
  budgetItemId: number | null;
  matchedBy: "code" | "description" | "similar" | null;
  budgetItemLabel: string | null;
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
  priceSource: "VENTA" | "MANO_DE_OBRA";
  missingPrice: boolean;
  totalContractQuantity: number;
  cantidadAnterior: number;
  montoAnterior: number;
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
}
