import { Router } from "express";
import { catalogsRouter } from "./modules/catalogs/catalogs.controller";
import { materialRequestsRouter } from "./modules/material-requests/materialRequests.controller";
import { purchaseOrdersRouter } from "./modules/purchase-orders/purchaseOrders.controller";
import { subcontractsRouter } from "./modules/subcontracts/subcontracts.controller";
import { dashboardRouter } from "./modules/dashboard/dashboard.controller";
import { stockRouter } from "./modules/stock/stock.controller";
import { certificationsRouter } from "./modules/certifications/certifications.controller";
import { advancedCertificationsRouter } from "./modules/certifications/advancedCertifications.controller";
import { budgetImportRouter } from "./modules/budgets/budgetImport.controller";
import { authRouter } from "./modules/auth/auth.controller";
import { invoicesRouter } from "./modules/invoices/invoices.controller";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use(catalogsRouter);
apiRouter.use("/pedidos", materialRequestsRouter);
apiRouter.use("/compras", purchaseOrdersRouter);
apiRouter.use("/subcontratos", subcontractsRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/stock", stockRouter);
apiRouter.use("/certificaciones", certificationsRouter);
apiRouter.use("/certifications", advancedCertificationsRouter);
apiRouter.use("/invoices", invoicesRouter);
apiRouter.use(budgetImportRouter);
