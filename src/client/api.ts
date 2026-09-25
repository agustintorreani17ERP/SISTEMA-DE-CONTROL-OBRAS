import {
  DashboardData,
  Project,
  Material,
  Partner,
  Personnel,
  WorkFront,
  BudgetItem,
  MaterialRequest,
  PurchaseOrder,
  SubcontractorContract,
  WarehouseStock,
  StockMovement,
} from "./types";

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
  createProject: (body: {
    code: string;
    name: string;
    location: string;
    clientName: string;
    executionMonths: number;
    globalBudget: number;
    roadSection?: string;
    contractNumber?: string;
    montoContractualManual?: number;
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
    category: string;
    unit: string;
    totalQuantity: number;
    executedQuantity: number;
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
  approvePlanillaMadre: (projectId: number, body: {
    items: Array<{
      code: string;
      name: string;
      category?: string;
      unit?: string;
      quantity?: number;
      totalQuantity?: number;
      unitPrice?: number;
      originalAmount?: number;
    }>;
    markupPercent?: number;
  }) =>
    request<{
      approved: boolean;
      totalItems: number;
      totalAmount: number;
      budgetItems: BudgetItem[];
    }>(`/api/projects/${projectId}/planilla-madre/aprobar`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Material Requests
  getMaterialRequests: () => request<MaterialRequest[]>("/api/pedidos"),
  createMaterialRequest: (body: {
    projectId: number;
    workFrontId: number;
    requestedById: number;
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
    request<PurchaseOrder>(`/api/compras/${id}/emitir`, { method: "POST" }),
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

  // Certificaciones de Avance / Obras Viales
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
  saveApprovedBudget: (body: {
    projectId: number;
    markupPercent: number;
    items: Array<{
      code: string;
      name: string;
      category?: string;
      unit?: string;
      quantity: number;
      unitPrice: number;
      originalAmount: number;
    }>;
  }) =>
    request<any>("/api/certificaciones/presupuesto/guardar-aprobado", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createBudgetItem: (body: {
    projectId: number;
    code: string;
    name: string;
    category?: string;
    unit?: string;
    totalQuantity?: number;
    unitPrice?: number;
    originalAmount?: number;
  }) =>
    request<any>("/api/budget-items", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  importBudgetFile: async (file: File, projectId?: number) => {
    const formData = new FormData();
    formData.append("file", file);
    if (projectId) formData.append("projectId", String(projectId));
    const response = await fetch("/api/certificaciones/import-budget", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error?.message || payload.message || "Error al importar presupuesto");
    }
    return payload.data;
  },

  previewBudgetImport: async (
    projectId: number,
    data: {
      file?: File | null;
      pastedText?: string;
      googleSheetsUrl?: string;
      activeSheetName?: string;
      customHeaderRows?: Record<string, number>;
      customColumnMappings?: Record<string, Record<number, string>>;
    }
  ) => {
    let response: Response;
    if (data.file) {
      const formData = new FormData();
      formData.append("file", data.file);
      if (data.activeSheetName) formData.append("activeSheetName", data.activeSheetName);
      if (data.customHeaderRows) formData.append("customHeaderRows", JSON.stringify(data.customHeaderRows));
      if (data.customColumnMappings) formData.append("customColumnMappings", JSON.stringify(data.customColumnMappings));
      response = await fetch(`/api/projects/${projectId}/budget-import/preview`, {
        method: "POST",
        body: formData,
      });
    } else {
      response = await fetch(`/api/projects/${projectId}/budget-import/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    }
    const payload = await response.json();
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error?.message || payload.message || "Error al previsualizar la planilla");
    }
    return payload.data;
  },

  commitBudgetImport: async (projectId: number, payload: any) => {
    return request<any>(`/api/projects/${projectId}/budget-import/commit`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

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
    request<{ certification: any; invoice: any }>(`/api/certifications/${id}/approve`, {
      method: "POST",
    }),
  deleteCertification: (id: number) =>
    request<{ deleted: boolean; id: number }>(`/api/certifications/${id}`, {
      method: "DELETE",
    }),
};

