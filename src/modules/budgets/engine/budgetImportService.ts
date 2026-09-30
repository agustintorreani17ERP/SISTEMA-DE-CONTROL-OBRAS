import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { DomainError, NotFoundError } from "../../../errors/domain";
import { ensureGeneralExpenses } from "../../../domain/generalExpenses";
import { recalculateProjectFinancials } from "../../../domain/projectFinancials";
import { buildBudgetTree } from "./budgetTree";
import { ExtractedWorkbook } from "./matrixExtractor";
import { generatePreview } from "./preview";
import { BudgetImportPreview, CommitBudgetPayload, CommitBudgetResult, PreviewOptions } from "./types";

export function currencyDecimals(currency?: string | null) {
  return !currency || currency === "PYG" ? 0 : 2;
}

export class BudgetImportService {
  generatePreview(workbook: ExtractedWorkbook, options: PreviewOptions = {}): BudgetImportPreview {
    return generatePreview(workbook, options);
  }

  /**
   * Guarda el árbol en la base. Reemplaza el presupuesto completo (salvo Gastos Generales)
   * y solo se permite mientras la obra no tenga movimientos ni documentos imputados.
   */
  async commitBudget(payload: CommitBudgetPayload): Promise<CommitBudgetResult> {
    const project = await prisma.project.findUnique({ where: { id: payload.projectId } });
    if (!project) throw new NotFoundError("Obra", payload.projectId);

    const decimals = currencyDecimals(project.currency);
    // El monto contractual sale de esta importación: no se compara contra el anterior.
    const build = buildBudgetTree(payload.rows, {
      surchargeTreatments: payload.surchargeTreatments,
      arithmeticStrategy: payload.arithmeticStrategy,
      currencyDecimals: decimals,
      contractAmount: null,
    });

    const critical = build.issues.filter((i) => i.type === "CRITICAL");
    if (critical.length) {
      throw new DomainError(
        "BUDGET_IMPORT_INVALID",
        `La planilla tiene ${critical.length} error(es) que hay que corregir antes de importar`,
        422,
        critical
      );
    }
    const rec = build.reconciliation;
    if (!rec.balanced && !payload.acceptDifference) {
      throw new DomainError(
        "RECONCILIATION_REQUIRED",
        "El presupuesto no cuadra con los totales de la planilla o del contrato. Revisá el cuadre o confirmá la diferencia.",
        422,
        rec
      );
    }

    const acceptedDifference = rec.declaredDifference ?? 0; // el contrato es solo informativo

    return prisma.$transaction(
      async (tx) => {
        const movements = await tx.budgetMovement.count({ where: { projectId: project.id } });
        if (movements > 0) {
          throw new DomainError(
            "BUDGET_HAS_MOVEMENTS",
            "Esta obra ya tiene OC, certificados o gastos imputados: el presupuesto no se puede reimportar. Usá una adenda.",
            409
          );
        }

        let planSnapshot: Prisma.AvancePlanificadoGetPayload<{ include: { budgetItem: { select: { path: true } } } }>[] = [];
        let acuSnapshot: Prisma.ComponenteItemGetPayload<{ include: { budgetItem: { select: { path: true } } } }>[] = [];
        const oldItems = await tx.budgetItem.findMany({
          where: { projectId: project.id, isSystem: false },
          select: { id: true },
        });
        const oldIds = oldItems.map((i) => i.id);
        if (oldIds.length) {
          const where = { budgetItemId: { in: oldIds } };
          const [requests, orders, subcontracts, certs, certItems, petty, stockIssues, avances, partesEq] = await Promise.all([
            tx.materialRequestDetail.count({ where }),
            tx.purchaseOrderDetail.count({ where }),
            tx.subcontractorContract.count({ where }),
            tx.certificacion.count({ where }),
            tx.certificationItem.count({ where }),
            tx.pettyCashExpense.count({ where }),
            tx.stockMovement.count({ where }),
            tx.avanceItem.count({ where }),
            tx.parteEquipo.count({ where }),
          ]);
          const [horasPers, viajes] = await Promise.all([tx.parteHoraPersonal.count({ where }), tx.viajeCamion.count({ where })]);
          const refs = requests + orders + subcontracts + certs + certItems + petty + stockIssues + avances + partesEq + horasPers + viajes;
          if (refs > 0) {
            throw new DomainError(
              "BUDGET_HAS_REFERENCES",
              `Hay ${refs} documento(s) (pedidos, OC, subcontratos, certificados, caja chica, salidas de stock o avance) que usan partidas del presupuesto actual. Anulalos o usá una adenda.`,
              409
            );
          }
          // Los ACU son planificación: se reenganchan a los ítems nuevos con el mismo path.
          acuSnapshot = await tx.componenteItem.findMany({
            where: { budgetItemId: { in: oldIds } },
            include: { budgetItem: { select: { path: true } } },
          });
          planSnapshot = await tx.avancePlanificado.findMany({
            where: { budgetItemId: { in: oldIds } },
            include: { budgetItem: { select: { path: true } } },
          });
          await tx.budgetItem.updateMany({ where: { id: { in: oldIds } }, data: { parentId: null } });
          await tx.budgetItem.deleteMany({ where: { id: { in: oldIds } } });
        }

        const budgetImport = await tx.budgetImport.create({
          data: {
            projectId: project.id,
            fileName: payload.metadata.fileName,
            sourceType: payload.metadata.sourceType,
            sheets: payload.metadata.sheets,
            numberFormat: payload.metadata.numberFormat,
            columnMappings: (payload.metadata.columnMappings ?? undefined) as Prisma.InputJsonValue | undefined,
            surcharges: rec.surcharges as unknown as Prisma.InputJsonValue,
            itemsTotal: rec.budgetTotal,
            sheetDeclaredTotal: rec.declaredGrandTotal,
            contractAmount: rec.sheetComputedTotal,
            acceptedDifference: rec.balanced ? 0 : acceptedDifference,
            nodesCount: build.nodes.length,
            itemsCount: build.counts.items,
            createdBy: payload.createdBy,
          },
        });

        // Se crea nivel por nivel para resolver parentId por path.
        const idByPath = new Map<string, number>();
        const maxLevel = Math.max(0, ...build.nodes.map((n) => n.level));
        for (let level = 0; level <= maxLevel; level++) {
          const levelNodes = build.nodes.filter((n) => n.level === level);
          if (!levelNodes.length) continue;
          const created = await tx.budgetItem.createManyAndReturn({
            data: levelNodes.map((n) => ({
              projectId: project.id,
              code: n.code || n.name.slice(0, 20),
              name: n.name,
              category: n.topRubroName,
              unit: n.unit,
              totalQuantity: Number(n.quantity.toFixed(4)),
              unitPrice: Number(n.unitPrice.toFixed(4)),
              originalAmount: n.kind === "ITEM" ? n.amount : 0,
              parentId: n.parentPath ? idByPath.get(n.parentPath) ?? null : null,
              path: n.path,
              hierarchyLevel: n.level,
              nodeKind: n.kind,
              sortOrder: n.sortOrder,
              noCotiza: n.noCotiza,
              unitReview: n.unitReview,
              unitSuggestion: n.unitSuggestion,
              sourceSheet: n.sheet || null,
              sourceRow: n.rowNumber || null,
              budgetImportId: budgetImport.id,
            })),
            select: { id: true, path: true },
          });
          for (const c of created) idByPath.set(c.path, c.id);
        }

        const itemPaths = new Set(build.nodes.filter((n) => n.kind === "ITEM").map((n) => n.path));
        const acuToRestore = acuSnapshot.filter((c) => itemPaths.has(c.budgetItem.path));
        if (acuToRestore.length) {
          await tx.componenteItem.createMany({
            data: acuToRestore.map((c) => ({
              budgetItemId: idByPath.get(c.budgetItem.path)!,
              insumoId: c.insumoId,
              consumo: c.consumo,
              desperdicioPct: c.desperdicioPct,
              sortOrder: c.sortOrder,
              nota: c.nota,
            })),
          });
        }
        const planToRestore = planSnapshot.filter((p) => itemPaths.has(p.budgetItem.path));
        if (planToRestore.length) {
          await tx.avancePlanificado.createMany({
            data: planToRestore.map((p) => ({
              projectId: project.id,
              budgetItemId: idByPath.get(p.budgetItem.path)!,
              fecha: p.fecha,
              cantidad: p.cantidad,
            })),
          });
        }
        const acuItems = (list: typeof acuSnapshot) => new Set(list.map((c) => c.budgetItem.path)).size;
        const acuKept = acuItems(acuToRestore);
        const acuLost = acuItems(acuSnapshot) - acuKept;

        await ensureGeneralExpenses(tx, project.id);

        await tx.project.update({
          where: { id: project.id },
          data: {
            globalBudget: rec.budgetTotal,
            // El presupuesto importado define el monto del contrato.
            montoContractualManual: rec.sheetComputedTotal,
          },
        });
        await recalculateProjectFinancials(tx, project.id);

        return {
          success: true,
          projectId: project.id,
          budgetImportId: budgetImport.id,
          nodesCount: build.nodes.length,
          rubrosCount: build.counts.rubros,
          subrubrosCount: build.counts.subrubros,
          itemsCount: build.counts.items,
          totalBudgetAmount: rec.budgetTotal,
          reconciliation: rec,
          message:
            `Presupuesto importado: ${build.counts.items} ítems en ${build.counts.rubros} rubros y ${build.counts.subrubros} subrubros.` +
            (acuKept ? ` Se conservó el ACU de ${acuKept} ítem(s).` : "") +
            (acuLost ? ` ${acuLost} ACU se perdieron porque su ítem ya no está en la planilla.` : ""),
        };
      },
      { timeout: 120_000, maxWait: 10_000 }
    );
  }
}

export const budgetImportService = new BudgetImportService();
