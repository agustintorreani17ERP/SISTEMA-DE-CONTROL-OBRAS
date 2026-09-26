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
  MaterialRequest,
  PurchaseOrder,
  SubcontractorContract,
  WarehouseStock,
  StockMovement,
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
    throw new Error(errorMsg);
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
    requestedDate?: string;
    notes?: string;
    details: {
      materialId: number;
      budgetItemId?: number;
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
    expectedDate?: string;
    details: {
      requestDetailId: number;
      /** Rubro de destino; si falta se usa el del pedido. */
      budgetItemId?: number;
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
  receivePurchaseOrder: (id: number) =>
    request<PurchaseOrder>(`/api/compras/${id}/recibir`, { method: "POST" }),
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
    budgetItemId: number;
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
    request<{ settled: number }>(`/api/caja-chica/fondos/${fundId}/rendicion`, { method: "POST" }),
  rejectPettyCashExpense: (id: number, reason: string) =>
    request<PettyCashExpense>(`/api/caja-chica/gastos/${id}/rechazar`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),


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
  getStock: (projectId?: number) =>
    request<WarehouseStock[]>(`/api/stock${projectId ? `?projectId=${projectId}` : ""}`),
  getStockMovements: (projectId?: number) =>
    request<StockMovement[]>(`/api/stock/movimientos${projectId ? `?projectId=${projectId}` : ""}`),
  registerConsumption: (projectId: number, body: { materialId: number; quantity: number; note?: string }) =>
    request<WarehouseStock>(`/api/stock/${projectId}/consumos`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  registerAdjustment: (body: { projectId: number; materialId: number; quantity: number; note: string }) =>
    request<WarehouseStock>("/api/stock/ajustes", {
      method: "POST",
      body: JSON.stringify(body),
    }),

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
    request<{ certification: any; invoice: any; budgetWarnings?: BudgetWarning[] }>(`/api/certifications/${id}/approve`, {
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
};

