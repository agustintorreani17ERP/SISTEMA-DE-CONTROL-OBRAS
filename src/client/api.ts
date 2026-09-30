import {
  DashboardData,
  Project,
  Material,
  Partner,
  Personnel,
  WorkFront,
  BudgetItem,
  BudgetMovement,
  BudgetWarning,
  CostControlData,
  ImputableItem,
  Portfolio,
  LaborPrice,
  LaborPreviewRow,
  MeasurableItem,
  CertificateSummaryData,
  ProjectOverview,
  PettyCashFund,
  PettyCashExpense,
  CuentaFinanciera,
  MovimientoCuentaFinanciera,
  Cheque,
  MaterialRequest,
  PurchaseOrder,
  SubcontractorContract,
  WarehouseStock,
  StockMovement,
  ConteoInventario,
  ProgressReport,
  AvanceHecho,
  CierreResumen,
  PlanPreview,
  CostEngineData,
  ParteEquipoRow,
  ParteCatalogo,
  ParteDiarioInput,
  ParteDiarioRow,
  CombustibleData,
  ViajesData,
  CostoHoraData,
  ClientInvoicePreview,
  ReconciliationData,
  CostDashboardData,
  ItemDrillData,
  Insumo,
  InsumoPrecio,
  InsumoTipo,
  InsumoCategoria,
  MoImportPreview,
  ItemAcuData,
  AcuBibliotecaItem,
} from "./types";
import type {
  ArithmeticStrategy,
  BudgetImportPreview,
  CanonicalColumnRole,
  CommitBudgetResult,
  ImportRow,
  NumberFormat,
  SurchargeTreatment,
} from "../modules/budgets/engine/types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    const errorMsg =
      payload.error?.message ||
      payload.message ||
      (typeof payload.error === "string" ? payload.error : "Error en el servidor");
    // status: la cola sin conexión distingue "el servidor rechazó" (4xx) de "no hubo red"
    throw Object.assign(new Error(errorMsg), { status: response.status });
  }
  return payload.data as T;
}

export const api = {
  // Health
  getHealth: () => request<{ status: string; service: string }>("/health"),

  // Dashboard
  getDashboard: (projectId?: number) =>
    request<DashboardData>(`/api/dashboard${projectId ? `?projectId=${projectId}` : ""}`),

  // Catalogs
  getProjects: () => request<Project[]>("/api/projects"),
  clearAllProjects: () =>
    request<{ success: boolean; message: string }>("/api/projects/clear-all", {
      method: "POST",
    }),
  /** El monto contractual no se carga acá: lo fija la importación del presupuesto. */
  createProject: (body: {
    code: string;
    name: string;
    location: string;
    clientName: string;
    executionMonths: number;
    contractNumber?: string;
    currency?: "PYG" | "USD";
  }) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  archiveProject: (id: number) =>
    request<{ archived: boolean; id: number }>(`/api/projects/${id}`, {
      method: "DELETE",
    }),
  updateProject: (id: number, body: Partial<{
    name: string;
    code: string;
    location: string;
    clientName: string;
    globalBudget: number;
    montoContractualManual: number;
    montoRealActualizado: number;
  }>) =>
    request<Project>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  getMaterials: () => request<Material[]>("/api/materials"),
  createMaterial: (body: {
    code: string;
    description: string;
    unit: string;
    category: string;
    estimatedCost?: number;
  }) =>
    request<Material>("/api/materials", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateMaterial: (id: number, body: Partial<{
    code: string;
    description: string;
    unit: string;
    category: string;
    estimatedCost: number;
  }>) =>
    request<Material>(`/api/materials/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteMaterial: (id: number) =>
    request<{ deleted: boolean; id: number }>(`/api/materials/${id}`, {
      method: "DELETE",
    }),
  bulkCreateMaterials: (materials: Array<{
    code: string;
    description: string;
    unit: string;
    category: string;
    estimatedCost?: number;
  }>) =>
    request<{ count: number; materials: Material[] }>("/api/materials/bulk", {
      method: "POST",
      body: JSON.stringify({ materials }),
    }),

  getPartners: (kind?: string) =>
    request<Partner[]>(`/api/partners${kind ? `?kind=${kind}` : ""}`),
  createPartner: (body: {
    kind: "SUPPLIER" | "SUBCONTRACTOR" | "BOTH";
    name: string;
    taxId: string;
    fiscalAddress?: string;
    phone?: string;
    email?: string;
    classification?: string;
  }) =>
    request<Partner>("/api/partners", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updatePartner: (id: number, body: Partial<{
    kind: "SUPPLIER" | "SUBCONTRACTOR" | "BOTH";
    name: string;
    taxId: string;
    fiscalAddress: string;
    phone: string;
    email: string;
    classification: string;
    active: boolean;
  }>) =>
    request<Partner>(`/api/partners/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deletePartner: (id: number) =>
    request<{ deleted: boolean; id: number }>(`/api/partners/${id}`, {
      method: "DELETE",
    }),

  getPersonnel: () => request<Personnel[]>("/api/personnel"),
  getWorkFronts: (projectId?: number) =>
    request<WorkFront[]>(`/api/work-fronts${projectId ? `?projectId=${projectId}` : ""}`),
  getBudgetItems: (projectId?: number) =>
    request<BudgetItem[]>(`/api/budget-items${projectId ? `?projectId=${projectId}` : ""}`),
  updateBudgetItem: (id: number, body: Partial<{
    code: string;
    name: string;
    unit: string;
    totalQuantity: number;
    unitPrice: number;
    originalAmount: number;
  }>) =>
    request<BudgetItem>(`/api/budget-items/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteBudgetItem: (id: number) =>
    request<{ deleted: boolean; id: number }>(`/api/budget-items/${id}`, {
      method: "DELETE",
    }),
  deleteAllBudgetItems: (projectId: number) =>
    request<{ deletedAll: boolean; projectId: number }>(`/api/projects/${projectId}/budget-items`, {
      method: "DELETE",
    }),
  /** @deprecated El presupuesto se carga solo con el importador (previewBudgetImport/commitBudgetImport). */
  approvePlanillaMadre: (_projectId: number, _body: unknown): Promise<{ totalItems: number }> =>
    Promise.reject(new Error("Usá el importador de presupuesto del Centro de Costos")),

  // Material Requests
  getMaterialRequests: () => request<MaterialRequest[]>("/api/pedidos"),
  createMaterialRequest: (body: {
    projectId: number;
    workFrontId?: number | null;
    requestedById?: number | null;
    /** AAAA-MM-DD, obligatoria. */
    requestedDate: string;
    notes?: string;
    details: {
      materialId: number;
      budgetItemId?: number | null;
      quantity: number;
    }[];
  }) =>
    request<MaterialRequest>("/api/pedidos", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  approveMaterialRequest: (id: number) =>
    request<MaterialRequest>(`/api/pedidos/${id}/aprobar`, { method: "POST" }),
  deleteMaterialRequest: (id: number) =>
    request<{ deleted: boolean }>(`/api/pedidos/${id}`, { method: "DELETE" }),

  // Purchase Orders
  getPurchaseOrders: () => request<PurchaseOrder[]>("/api/compras"),
  createPurchaseOrder: (body: {
    materialRequestId: number;
    partnerId: number;
    /** AAAA-MM-DD, obligatoria. */
    fecha: string;
    expectedDate?: string;
    details: {
      requestDetailId: number;
      /** Ítem: obligatorio para insumos DIRECTOS, no va para COMUNES. */
      budgetItemId?: number | null;
      quantity: number;
      unitPrice: number;
    }[];
  }) =>
    request<PurchaseOrder>("/api/compras", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  approvePurchaseOrder: (id: number) =>
    request<PurchaseOrder>(`/api/compras/${id}/aprobar`, { method: "POST" }),
  issuePurchaseOrder: (id: number) =>
    request<PurchaseOrder & { budgetWarnings?: BudgetWarning[] }>(`/api/compras/${id}/emitir`, { method: "POST" }),
  receivePurchaseOrder: (id: number, body: { fecha: string; remito?: string }) =>
    request<PurchaseOrder>(`/api/compras/${id}/recibir`, { method: "POST", body: JSON.stringify(body) }),
  cancelPurchaseOrder: (id: number) =>
    request<PurchaseOrder>(`/api/compras/${id}/anular`, { method: "POST" }),
  deletePurchaseOrder: (id: number) =>
    request<{ deleted: boolean }>(`/api/compras/${id}`, { method: "DELETE" }),

  // Subcontracts
  getSubcontracts: () => request<SubcontractorContract[]>("/api/subcontratos"),
  createSubcontract: (body: {
    projectId: number;
    partnerId: number;
    budgetItemId: number;
    description: string;
    contractAmount: number;
    startDate?: string;
    endDate?: string;
  }) =>
    request<SubcontractorContract>("/api/subcontratos", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createSubcontractCertificate: (body: {
    subcontractId: number;
    amount: number;
    advancePercentage?: number;
    quantity?: number;
    notes?: string;
    periodFrom?: string;
    periodTo?: string;
    physicalProgressPct?: number;
  }) =>
    request<any>("/api/subcontratos/certificados", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  certifySubcontractCertificate: (id: number) =>
    request<any>(`/api/subcontratos/certificados/${id}/certificar`, { method: "POST" }),
  approveSubcontractCertificate: (id: number) =>
    request<any>(`/api/subcontratos/certificados/${id}/aprobar`, { method: "POST" }),
  paySubcontractCertificate: (id: number) =>
    request<any>(`/api/subcontratos/certificados/${id}/pagar`, { method: "POST" }),
  cancelSubcontractCertificate: (id: number) =>
    request<any>(`/api/subcontratos/certificados/${id}/anular`, { method: "POST" }),

  // Certificaciones de Avance de Obra
  getCertificaciones: (projectId?: number) =>
    request<any[]>(`/api/certificaciones${projectId ? `?projectId=${projectId}` : ""}`),
  createCertificacion: (body: {
    projectId?: number;
    partnerId?: number;
    budgetItemId?: number;
    subcontratista?: string;
    rubro?: string;
    unidad?: string;
    cantidad_medida: number;
    monto_total: number;
    estado?: string;
    evidencia?: string;
    esAdenda?: boolean;
  }) =>
    request<any>("/api/certificaciones", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCertificacionEstado: (id: number, estado: string) =>
    request<any>(`/api/certificaciones/${id}/estado`, {
      method: "PUT",
      body: JSON.stringify({ estado }),
    }),
  deleteCertificacion: (id: number) =>
    request<any>(`/api/certificaciones/${id}`, {
      method: "DELETE",
    }),
  createBudgetItem: (body: {
    projectId: number;
    parentId?: number;
    nodeKind?: "RUBRO" | "ITEM";
    code: string;
    name: string;
    unit?: string;
    totalQuantity?: number;
    unitPrice?: number;
    originalAmount?: number;
  }) =>
    request<BudgetItem>("/api/budget-items", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Importación de presupuesto (único camino)
  previewBudgetImport: async (
    projectId: number,
    data: {
      file?: File | null;
      pastedText?: string;
      googleSheetsUrl?: string;
      selectedSheets?: string[];
      headerRows?: Record<string, number>;
      columnMappings?: Record<string, Record<number, CanonicalColumnRole>>;
      numberFormat?: NumberFormat;
      includeHidden?: boolean;
    }
  ): Promise<BudgetImportPreview & { projectLocked: boolean }> => {
    const formData = new FormData();
    if (data.file) formData.append("file", data.file);
    if (data.pastedText) formData.append("pastedText", data.pastedText);
    if (data.googleSheetsUrl) formData.append("googleSheetsUrl", data.googleSheetsUrl);
    if (data.selectedSheets?.length) formData.append("selectedSheets", JSON.stringify(data.selectedSheets));
    if (data.headerRows) formData.append("headerRows", JSON.stringify(data.headerRows));
    if (data.columnMappings) formData.append("columnMappings", JSON.stringify(data.columnMappings));
    if (data.numberFormat) formData.append("numberFormat", data.numberFormat);
    if (data.includeHidden) formData.append("includeHidden", "true");
    const response = await fetch(`/api/projects/${projectId}/budget-import/preview`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error?.message || payload.message || "Error al analizar la planilla");
    }
    return payload.data;
  },
  commitBudgetImport: async (
    projectId: number,
    body: {
      rows: ImportRow[];
      surchargeTreatments: Record<string, SurchargeTreatment>;
      arithmeticStrategy: ArithmeticStrategy;
      acceptDifference: boolean;
      metadata: { fileName?: string; sourceType: string; sheets: string[]; numberFormat: NumberFormat; columnMappings?: unknown };
    }
  ): Promise<CommitBudgetResult> => {
    const response = await fetch(`/api/projects/${projectId}/budget-import/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok || payload.success === false) {
      const error = new Error(payload.error?.message || "Error al importar el presupuesto") as Error & {
        code?: string;
        details?: unknown;
      };
      error.code = payload.error?.code;
      error.details = payload.error?.details;
      throw error;
    }
    return payload.data;
  },

  // Frentes de obra
  createWorkFront: (body: { projectId: number; name: string; chiefId?: number | null }) =>
    request<WorkFront>("/api/work-fronts", { method: "POST", body: JSON.stringify(body) }),
  updateWorkFront: (id: number, body: { name?: string; chiefId?: number | null }) =>
    request<WorkFront>(`/api/work-fronts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteWorkFront: (id: number) => request<{ deleted: boolean }>(`/api/work-fronts/${id}`, { method: "DELETE" }),

  // Fotos (medición desde el celular)
  uploadImage: async (file: File): Promise<{ url: string; name: string }> => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/uploads", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok || payload.success === false) throw new Error(payload.error?.message || "No se pudo subir la imagen");
    return payload.data;
  },

  // Lista de precios de mano de obra
  getLaborPrices: (projectId: number) => request<LaborPrice[]>(`/api/projects/${projectId}/labor-prices`),
  previewLaborPrices: async (projectId: number, data: { file?: File | null; pastedText?: string }) => {
    const form = new FormData();
    if (data.file) form.append("file", data.file);
    if (data.pastedText) form.append("pastedText", data.pastedText);
    const response = await fetch(`/api/projects/${projectId}/labor-prices/preview`, { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok || payload.success === false) throw new Error(payload.error?.message || "No se pudo leer la planilla");
    return payload.data as { sheetName: string; rows: LaborPreviewRow[]; summary: { total: number; matched: number } };
  },
  commitLaborPrices: (projectId: number, rows: LaborPreviewRow[]) =>
    request<{ saved: number }>(`/api/projects/${projectId}/labor-prices/commit`, { method: "POST", body: JSON.stringify({ rows }) }),
  saveLaborPrice: (
    projectId: number,
    body: { code?: string; description: string; unit?: string; unitPrice: number; budgetItemId?: number | null }
  ) => request<LaborPrice>(`/api/projects/${projectId}/labor-prices`, { method: "POST", body: JSON.stringify(body) }),
  updateLaborPrice: (id: number, body: Partial<{ unitPrice: number; budgetItemId: number | null; description: string }>) =>
    request<LaborPrice>(`/api/labor-prices/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteLaborPrice: (id: number) => request<{ deleted: boolean }>(`/api/labor-prices/${id}`, { method: "DELETE" }),

  // Certificado (Medición N / Cert N)
  getCertificateSummary: (id: number) => request<CertificateSummaryData>(`/api/certifications/${id}/summary`),
  setCertificateRetention: (id: number, retentionPct: number) =>
    request<any>(`/api/certifications/${id}/retention`, { method: "PATCH", body: JSON.stringify({ retentionPct }) }),
  getMeasurableItems: (projectId: number, partnerId?: number | null) =>
    request<MeasurableItem[]>(`/api/certifications/rubros-disponibles?projectId=${projectId}&partnerId=${partnerId ?? "null"}`),

  // Dashboard: cartera de obras y resumen de una obra
  getPortfolio: () => request<Portfolio>("/api/portfolio"),
  getProjectOverview: (projectId: number) => request<ProjectOverview>(`/api/projects/${projectId}/overview`),

  // Control de costos y libro mayor presupuestario
  getCostControl: (projectId: number) => request<CostControlData>(`/api/projects/${projectId}/cost-control`),
  getBudgetMovements: (projectId: number, budgetItemId?: number) =>
    request<BudgetMovement[]>(
      `/api/projects/${projectId}/budget-movements${budgetItemId ? `?budgetItemId=${budgetItemId}` : ""}`
    ),
  getImputableItems: (projectId: number) => request<ImputableItem[]>(`/api/projects/${projectId}/imputable-items`),
  createBudgetAdjustment: (projectId: number, body: { budgetItemId: number; amount: number; note: string; createdBy?: string }) =>
    request<{ adjustmentId: number; budgetWarnings: BudgetWarning[] }>(`/api/projects/${projectId}/budget-adjustments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  rebuildBudgetLedger: (projectId: number) =>
    request<{ postedDocuments: number; skipped: string[]; items: number; movements: number }>(
      `/api/projects/${projectId}/budget-ledger/rebuild`,
      { method: "POST" }
    ),

  // Caja chica
  getPettyCash: (projectId: number) => request<PettyCashFund[]>(`/api/caja-chica?projectId=${projectId}`),
  createPettyCashFund: (body: { projectId: number; name?: string; responsibleName: string; assignedAmount: number }) =>
    request<PettyCashFund>("/api/caja-chica/fondos", { method: "POST", body: JSON.stringify(body) }),
  updatePettyCashFund: (id: number, body: Partial<{ name: string; responsibleName: string; assignedAmount: number; active: boolean }>) =>
    request<PettyCashFund>(`/api/caja-chica/fondos/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  createPettyCashExpense: (body: {
    fundId: number;
    insumoId: number;
    budgetItemId: number | null;
    quantity: number | null;
    date: string;
    receiptNumber: string;
    supplierName: string;
    concept: string;
    amount: number;
    responsibleName?: string;
  }) =>
    request<PettyCashExpense & { budgetWarnings: BudgetWarning[] }>("/api/caja-chica/gastos", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  settlePettyCashFund: (fundId: number) =>
    request<{ settled: number; avisos: string[] }>(`/api/caja-chica/fondos/${fundId}/rendicion`, { method: "POST", body: JSON.stringify({}) }),
  rejectPettyCashExpense: (id: number, reason: string) =>
    request<PettyCashExpense>(`/api/caja-chica/gastos/${id}/rechazar`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  // Bancos y cajas
  getCuentasFinancieras: (projectId: number) => request<CuentaFinanciera[]>(`/api/cuentas-financieras?projectId=${projectId}`),
  createCuentaFinanciera: (body: {
    projectId: number;
    nombre: string;
    tipo: "BANCO" | "CAJA";
    moneda?: string;
    banco?: string;
    numeroCuenta?: string;
    cuentaContableId?: number | null;
    saldoInicial?: number;
  }) => request<CuentaFinanciera>("/api/cuentas-financieras", { method: "POST", body: JSON.stringify(body) }),
  updateCuentaFinanciera: (
    id: number,
    body: Partial<{ nombre: string; banco: string; numeroCuenta: string; cuentaContableId: number | null; active: boolean; saldoInicial: number }>
  ) => request<CuentaFinanciera>(`/api/cuentas-financieras/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  getMovimientosCuenta: (id: number, desde?: string, hasta?: string) => {
    const params = new URLSearchParams();
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    const qs = params.toString();
    return request<{ cuenta: CuentaFinanciera; saldoInicialRango: number; movimientos: MovimientoCuentaFinanciera[]; saldoFinalRango: number }>(
      `/api/cuentas-financieras/${id}/movimientos${qs ? `?${qs}` : ""}`
    );
  },
  createTransferencia: (body: { cuentaOrigenId: number; cuentaDestinoId: number; monto: number; fecha: string; concepto?: string }) =>
    request<{ id: number }>("/api/cuentas-financieras/transferencias", { method: "POST", body: JSON.stringify(body) }),
  getCheques: (projectId: number, estado?: string) =>
    request<Cheque[]>(`/api/cuentas-financieras/cheques?projectId=${projectId}${estado ? `&estado=${estado}` : ""}`),
  updateChequeEstado: (id: number, estado: Cheque["estado"]) =>
    request<Cheque>(`/api/cuentas-financieras/cheques/${id}/estado`, { method: "PATCH", body: JSON.stringify({ estado }) }),


  // Authentication
  login: (credentials: { email: string; password?: string }) =>
    request<{ user: any; token: string; message: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    }),
  getMe: () => request<any>("/api/auth/me"),
  getUsers: () => request<any[]>("/api/auth/users"),
  logout: () => request<any>("/api/auth/logout", { method: "POST" }),

  // Warehouse Stock
  getStock: (projectId?: number, fecha?: string) => {
    const qs = new URLSearchParams();
    if (projectId) qs.set("projectId", String(projectId));
    if (fecha) qs.set("fecha", fecha);
    return request<WarehouseStock[]>(`/api/stock?${qs}`);
  },
  getStockMovements: (projectId?: number) =>
    request<StockMovement[]>(`/api/stock/movimientos${projectId ? `?projectId=${projectId}` : ""}`),
  /** Salida de stock. Con ítem es salida directa (obligatorio si el insumo es DIRECTO). */
  registerStockIssue: (
    projectId: number,
    body: { fecha: string; materialId: number; quantity: number; budgetItemId?: number | null; note?: string }
  ) => request<StockMovement>(`/api/stock/${projectId}/salidas`, { method: "POST", body: JSON.stringify(body) }),
  registerAdjustment: (body: { projectId: number; materialId: number; fecha: string; quantity: number; note: string }) =>
    request<StockMovement>("/api/stock/ajustes", { method: "POST", body: JSON.stringify(body) }),
  transferStock: (body: { fromProjectId: number; toProjectId: number; materialId: number; fecha: string; quantity: number; note?: string }) =>
    request<{ warnings: string[] }>("/api/stock/transferencias", { method: "POST", body: JSON.stringify(body) }),
  getStockTeorico: (projectId: number, materialId: number, fecha: string) =>
    request<{ stockTeorico: number }>(`/api/stock/teorico?projectId=${projectId}&materialId=${materialId}&fecha=${fecha}`),
  getConteos: (projectId: number) => request<ConteoInventario[]>(`/api/stock/conteos?projectId=${projectId}`),
  createConteo: (body: {
    projectId: number;
    materialId: number;
    fecha: string;
    cantidadContada: number;
    fotoUrl?: string | null;
    nota?: string | null;
    createdBy?: string | null;
  }) =>
    request<{ id: number; fecha: string; cantidadContada: number; stockTeorico: number; diferencia: number }>("/api/stock/conteos", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteConteo: (id: number) => request<{ deleted: boolean }>(`/api/stock/conteos/${id}`, { method: "DELETE" }),

  // Advanced Certifications & Measurements
  getCertifications: (params?: { projectId?: number; partnerId?: number | null; estado?: string }) => {
    const query = new URLSearchParams();
    if (params?.projectId) query.set("projectId", String(params.projectId));
    if (params?.partnerId !== undefined) query.set("partnerId", String(params.partnerId ?? "null"));
    if (params?.estado) query.set("estado", params.estado);
    const qs = query.toString();
    return request<any[]>(`/api/certifications${qs ? `?${qs}` : ""}`);
  },
  getCertification: (id: number) => request<any>(`/api/certifications/${id}`),
  getNextCertificationNumber: (projectId: number, partnerId?: number | null) => {
    const query = new URLSearchParams({ projectId: String(projectId) });
    if (partnerId !== undefined) query.set("partnerId", String(partnerId ?? "null"));
    return request<{ projectId: number; partnerId: number | null; nextNumber: number; displayLabel: string; tipo: string }>(
      `/api/certifications/next-number?${query.toString()}`
    );
  },
  getCertificationRubrosDisponibles: (projectId: number, partnerId?: number | null) => {
    const query = new URLSearchParams({ projectId: String(projectId) });
    if (partnerId !== undefined) query.set("partnerId", String(partnerId ?? "null"));
    return request<any[]>(`/api/certifications/rubros-disponibles?${query.toString()}`);
  },
  createCertification: (body: any) =>
    request<any>("/api/certifications", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCertification: (id: number, body: any) =>
    request<any>(`/api/certifications/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  closeCertificationMeasurement: (id: number) =>
    request<any>(`/api/certifications/${id}/close-measurement`, {
      method: "POST",
    }),
  approveCertification: (id: number) =>
    request<{ certification: any; invoice: any; budgetWarnings?: BudgetWarning[]; measurementWarnings?: string[] }>(`/api/certifications/${id}/approve`, {
      method: "POST",
    }),
  deleteCertification: (id: number) =>
    request<{ deleted: boolean; id: number }>(`/api/certifications/${id}`, {
      method: "DELETE",
    }),

  // RRHH
  getEmpleados: (projectId?: number) =>
    request<any[]>(`/api/rrhh/empleados${projectId ? `?projectId=${projectId}` : ""}`),
  getEmpleado: (id: number) => request<any>(`/api/rrhh/empleados/${id}`),
  createEmpleado: (body: any) =>
    request<any>("/api/rrhh/empleados", { method: "POST", body: JSON.stringify(body) }),
  updateEmpleado: (id: number, body: any) =>
    request<any>(`/api/rrhh/empleados/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  addEmpleadoDoc: (id: number, body: { tipo: string; url: string; nombre: string }) =>
    request<any>(`/api/rrhh/empleados/${id}/documentos`, { method: "POST", body: JSON.stringify(body) }),
  deleteEmpleadoDoc: (id: number) =>
    request<any>(`/api/rrhh/documentos/${id}`, { method: "DELETE" }),

  getAsistencias: (params?: { projectId?: number; fecha?: string; empleadoId?: number }) => {
    const q = new URLSearchParams();
    if (params?.projectId) q.set("projectId", String(params.projectId));
    if (params?.fecha) q.set("fecha", params.fecha);
    if (params?.empleadoId) q.set("empleadoId", String(params.empleadoId));
    return request<any[]>(`/api/rrhh/asistencias${q.toString() ? `?${q}` : ""}`);
  },
  saveAsistencia: (body: any) =>
    request<any>("/api/rrhh/asistencias", { method: "POST", body: JSON.stringify(body) }),
  saveAsistenciaBatch: (rows: any[]) =>
    request<any[]>("/api/rrhh/asistencias/batch", { method: "POST", body: JSON.stringify(rows) }),

  getLiquidaciones: (params?: { projectId?: number; periodo?: string; empleadoId?: number }) => {
    const q = new URLSearchParams();
    if (params?.projectId) q.set("projectId", String(params.projectId));
    if (params?.periodo) q.set("periodo", params.periodo);
    if (params?.empleadoId) q.set("empleadoId", String(params.empleadoId));
    return request<any[]>(`/api/rrhh/liquidaciones${q.toString() ? `?${q}` : ""}`);
  },
  getLiquidacion: (id: number) => request<any>(`/api/rrhh/liquidaciones/${id}`),
  calcularLiquidacion: (body: any) =>
    request<any>("/api/rrhh/liquidaciones/calcular", { method: "POST", body: JSON.stringify(body) }),
  createLiquidacion: (body: any) =>
    request<any>("/api/rrhh/liquidaciones", { method: "POST", body: JSON.stringify(body) }),
  aprobarLiquidacion: (id: number) =>
    request<any>(`/api/rrhh/liquidaciones/${id}/aprobar`, { method: "POST" }),
  pagarLiquidacion: (id: number) =>
    request<any>(`/api/rrhh/liquidaciones/${id}/pagar`, { method: "POST" }),

  getRRHHConfig: (projectId?: number) =>
    request<any>(`/api/rrhh/config${projectId ? `?projectId=${projectId}` : ""}`),
  saveRRHHConfig: (body: any, projectId?: number) =>
    request<any>(`/api/rrhh/config${projectId ? `?projectId=${projectId}` : ""}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  // Catálogo de insumos
  getInsumos: (params: { tipo?: InsumoTipo; categoria?: InsumoCategoria; q?: string; fecha?: string; inactivos?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.tipo) qs.set("tipo", params.tipo);
    if (params.categoria) qs.set("categoria", params.categoria);
    if (params.q) qs.set("q", params.q);
    if (params.fecha) qs.set("fecha", params.fecha);
    if (params.inactivos) qs.set("inactivos", "true");
    return request<Insumo[]>(`/api/insumos?${qs}`);
  },
  createInsumo: (body: {
    code: string;
    description: string;
    unit: string;
    category?: string;
    tipo: InsumoTipo;
    categoria: InsumoCategoria;
    sector?: string | null;
    toleranciaPct?: number;
    precio: number;
    vigenteDesde?: string;
  }) => request<Insumo>("/api/insumos", { method: "POST", body: JSON.stringify(body) }),
  updateInsumo: (
    id: number,
    body: Partial<Pick<Insumo, "code" | "description" | "unit" | "category" | "tipo" | "categoria" | "sector" | "toleranciaPct" | "consumoLh" | "active">>
  ) => request<Insumo>(`/api/insumos/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  getInsumoPrecios: (id: number) => request<InsumoPrecio[]>(`/api/insumos/${id}/precios`),
  addInsumoPrecio: (id: number, body: { precio: number; vigenteDesde: string }) =>
    request<InsumoPrecio>(`/api/insumos/${id}/precios`, { method: "POST", body: JSON.stringify(body) }),
  previewImportMO: async (data: { file?: File; pastedText?: string; vigenteDesde: string }) => {
    const form = new FormData();
    if (data.file) form.append("file", data.file);
    if (data.pastedText) form.append("pastedText", data.pastedText);
    form.append("vigenteDesde", data.vigenteDesde);
    const response = await fetch("/api/insumos/import-mo/preview", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok || payload.success === false) throw new Error(payload.error?.message || "No se pudo leer la planilla");
    return payload.data as MoImportPreview;
  },
  commitImportMO: (body: {
    vigenteDesde: string;
    fileName?: string;
    rows: { code: string; description: string; unit: string; price: number; sector: string | null }[];
  }) =>
    request<{ creados: number; actualizados: number; preciosNuevos: number }>("/api/insumos/import-mo/commit", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // Centro de costos: K de la obra y ACU por ítem
  saveCostParams: (projectId: number, body: { coeficienteK: number | null; ivaPct: number }) =>
    request<{ id: number; coeficienteK: number | null; ivaPct: number }>(`/api/projects/${projectId}/parametros-costo`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  getItemAcu: (budgetItemId: number, fecha?: string) =>
    request<ItemAcuData>(`/api/budget-items/${budgetItemId}/acu${fecha ? `?fecha=${fecha}` : ""}`),
  saveItemAcu: (
    budgetItemId: number,
    componentes: { insumoId: number; consumo: number; desperdicioPct: number; nota?: string | null }[]
  ) => request<unknown>(`/api/budget-items/${budgetItemId}/acu`, { method: "PUT", body: JSON.stringify({ componentes }) }),
  getAcuBiblioteca: (params: { q?: string; projectId?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.projectId) qs.set("projectId", String(params.projectId));
    return request<AcuBibliotecaItem[]>(`/api/acu/biblioteca?${qs}`);
  },
  copyAcu: (body: { sourceItemId: number; targetItemIds: number[]; modo: "REEMPLAZAR" | "AGREGAR" }) =>
    request<{ copiados: number; avisos: string[] }>("/api/acu/copiar", { method: "POST", body: JSON.stringify(body) }),
  // Avance fechado, cronograma y cierres
  getAvance: (projectId: number, params: { desde?: string; hasta?: string; oficial?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.desde) qs.set("desde", params.desde);
    if (params.hasta) qs.set("hasta", params.hasta);
    if (params.oficial) qs.set("oficial", "true");
    return request<ProgressReport>(`/api/projects/${projectId}/avance?${qs}`);
  },
  getAvanceHechos: (projectId: number, desde: string, hasta: string, budgetItemId?: number) =>
    request<AvanceHecho[]>(
      `/api/projects/${projectId}/avance/hechos?desde=${desde}&hasta=${hasta}${budgetItemId ? `&budgetItemId=${budgetItemId}` : ""}`
    ),
  savePartes: (projectId: number, body: { fecha: string; lineas: { budgetItemId: number; cantidad: number; nota?: string | null }[] }) =>
    request<{ creados: number }>(`/api/projects/${projectId}/avance/partes`, { method: "POST", body: JSON.stringify(body) }),
  deleteAvance: (id: number) => request<{ deleted: boolean }>(`/api/avance/${id}`, { method: "DELETE" }),
  previewPlan: (projectId: number, texto: string) =>
    request<PlanPreview>(`/api/projects/${projectId}/plan/preview`, { method: "POST", body: JSON.stringify({ texto }) }),
  savePlan: (projectId: number, body: { modo: "REEMPLAZAR" | "COMBINAR"; lineas: { budgetItemId: number; fecha: string; cantidad: number }[] }) =>
    request<{ guardados: number }>(`/api/projects/${projectId}/plan`, { method: "PUT", body: JSON.stringify(body) }),
  getCierres: (projectId: number) => request<CierreResumen[]>(`/api/projects/${projectId}/cierres`),
  getFacturaCierre: (cierreId: number) => request<ClientInvoicePreview>(`/api/cierres/${cierreId}/factura`),
  createFacturaCierre: (cierreId: number, body: { numeroFactura?: string | null; timbrado?: string | null; fechaEmision?: string; diasVencimiento?: number }) =>
    request<{ id: number; numeroFactura: string }>(`/api/cierres/${cierreId}/factura`, { method: "POST", body: JSON.stringify(body) }),
  getCostDashboard: (projectId: number, desde: string | null, hasta: string) =>
    request<CostDashboardData>(`/api/projects/${projectId}/dashboard?${desde ? `desde=${desde}&` : ""}hasta=${hasta}`),
  getItemDrill: (projectId: number, itemId: number, desde: string, hasta: string) =>
    request<ItemDrillData>(`/api/projects/${projectId}/dashboard/items/${itemId}?desde=${desde}&hasta=${hasta}`),
  getConciliacion: (projectId: number, desde: string, hasta: string) =>
    request<ReconciliationData>(`/api/projects/${projectId}/conciliacion?desde=${desde}&hasta=${hasta}`),
  imputarFactura: (invoiceId: number, items: { id: number; insumoId: number; budgetItemId: number | null }[]) =>
    request<{ invoice: any; avisos: string[] }>(`/api/invoices/${invoiceId}/imputar`, { method: "POST", body: JSON.stringify({ items }) }),
  getCierre: (id: number) => request<{ id: number; desde: string; hasta: string; notas: string | null; snapshot: any }>(`/api/cierres/${id}`),
  previewCierre: (projectId: number, body: { desde: string; hasta: string }) =>
    request<{ blockers: string[]; avisos: string[]; report: ProgressReport }>(`/api/projects/${projectId}/cierres/preview`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  closePeriodo: (projectId: number, body: { desde: string; hasta: string; notas?: string }) =>
    request<{ id: number; desde: string; hasta: string }>(`/api/projects/${projectId}/cierres`, { method: "POST", body: JSON.stringify(body) }),
  // Motor de costos
  getCostos: (projectId: number, desde: string, hasta: string, oficial?: boolean) =>
    request<CostEngineData>(`/api/projects/${projectId}/costos?desde=${desde}&hasta=${hasta}${oficial === undefined ? "" : `&oficial=${oficial}`}`),
  getPartesEquipo: (projectId: number, desde: string, hasta: string) =>
    request<ParteEquipoRow[]>(`/api/projects/${projectId}/partes-equipo?desde=${desde}&hasta=${hasta}`),
  savePartesEquipo: (
    projectId: number,
    body: { fecha: string; lineas: { insumoId: number; budgetItemId?: number | null; horas: number; nota?: string | null }[] }
  ) => request<{ creados: number }>(`/api/projects/${projectId}/partes-equipo`, { method: "POST", body: JSON.stringify(body) }),
  deleteParteEquipo: (id: number) => request<{ deleted: boolean }>(`/api/partes-equipo/${id}`, { method: "DELETE" }),

  // Parte diario de obra
  getParteCatalogo: (projectId: number) => request<ParteCatalogo>(`/api/projects/${projectId}/parte-diario/catalogo`),
  getPartesDiarios: (projectId: number, desde: string, hasta: string) =>
    request<ParteDiarioRow[]>(`/api/projects/${projectId}/partes-diarios?desde=${desde}&hasta=${hasta}`),
  saveParteDiario: (projectId: number, body: ParteDiarioInput) =>
    request<{ id: number; duplicado: boolean; avisos: string[] }>(`/api/projects/${projectId}/partes-diarios`, { method: "POST", body: JSON.stringify(body) }),
  deleteParteDiario: (id: number) => request<{ deleted: boolean }>(`/api/partes-diarios/${id}`, { method: "DELETE" }),
  getCombustible: (projectId: number, desde: string, hasta: string) =>
    request<CombustibleData>(`/api/projects/${projectId}/combustible?desde=${desde}&hasta=${hasta}`),
  getViajes: (projectId: number, desde: string, hasta: string) => request<ViajesData>(`/api/projects/${projectId}/viajes?desde=${desde}&hasta=${hasta}`),
  getCostoHora: (projectId?: number) => request<CostoHoraData>(`/api/rrhh/costo-hora${projectId ? `?projectId=${projectId}` : ""}`),
};
