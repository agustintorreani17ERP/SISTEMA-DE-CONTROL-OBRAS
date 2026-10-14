/**
 * Puente ERP → ECMS: lo que los documentos del ERP (OC, factura, caja chica) usan del motor para
 * registrar costo, stock e imputación. Es el único punto por donde ERP toca al ECMS. Cada nombre que
 * se agrega aquí es un acoplamiento a revisar; la meta es reemplazarlo por eventos del puente.
 */
export { postMovement, postCost, reverseMovements, type BudgetWarning } from "../ecms/domain/budget";
export { recordStockMovement } from "../ecms/domain/stock";
export { ledgerItemFor, ledgerLines, resolveExpenseLine, resolveLineItem } from "../ecms/domain/imputation";
export { costEngine } from "../ecms/domain/costEngine";
