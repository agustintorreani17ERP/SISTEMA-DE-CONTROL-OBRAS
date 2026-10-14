# CLAUDE.md — InfraTrack ERP

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| Backend | Express 5 + TypeScript (`tsx watch`) |
| ORM | Prisma 5 (SQLite en dev, reemplazable) |
| Validación | Zod |
| Testing | Vitest |
| UI icons | lucide-react |
| Exportación | xlsx / xlsx-js-style |

## Cómo correrlo

```bash
npm install          # instala dependencias y genera el cliente Prisma
npm run db:push      # aplica el schema a la base de datos (primera vez o tras cambios)
npm run dev          # compila el cliente con Vite y levanta el servidor con tsx watch
```

El servidor escucha en `http://localhost:3000`. Requiere `DATABASE_URL` en `.env`.

Otros comandos útiles:

```bash
npm run db:seed      # carga datos de ejemplo
npm run db:studio    # Prisma Studio en el browser
npm test             # corre Vitest
npm run lint         # tsc --noEmit (sin emitir, solo chequeo de tipos)
```

## Estructura de carpetas

Tres motores de negocio y un puente (ver `docs/system/erp-ecms-bridge` en el wiki):

```
src/
├── server.ts / app.ts / routes.ts   # Entrada, Express y montaje de routers en /api
├── config/env.ts  lib/prisma.ts  lib/money.ts  errors/domain.ts  http/  middleware/
├── core/                            # Base compartida (no depende de ERP, ECMS ni bridge)
│   ├── modules/  auth/  uploads/
│   └── domain/   audit.ts  lifecycle.ts  localDate.ts  prices.ts (MaterialPrice vigente)
├── ecms/                            # Obra, presupuesto, medición y costos reales
│   ├── modules/  acu/  budgets/  certifications/  cost-control/  costos/  insumos/
│   │             labor-prices/  material-requests/  partes/  rrhh/  stock/  subcontracts/
│   └── domain/   budget.ts (postMovement/postCost: libro mayor)  costEngine.ts + costEngineMath.ts
│                 medicion.ts + medicionMath.ts (medición oficial = certificados al cliente)
│                 imputation.ts  stock.ts + stockMath.ts  labor*.ts  subPlanilla.ts …
├── erp/                             # Dinero, compras y documentos legales
│   ├── modules/  purchase-orders/  invoices/  petty-cash/  finance/  fondos/
│   └── domain/   contabilidad.ts (asientos)  fondos.ts + fondosMath.ts  threeWayMatch.ts  clientBillingMath.ts
├── bridge/                          # Único punto de cruce entre ERP y ECMS
│   ├── ledger.ts     ERP → ECMS: postMovement, postCost, recordStockMovement, imputación, costEngine
│   ├── finance.ts    ECMS → ERP: asientos, conciliación de facturas, solicitudes de fondos
│   ├── modules/  catalogs/ (alta y borrado de obra: toca ambos motores)  dashboard/
│   └── domain/   clientBilling.ts  ledgerSync.ts  reconciliation*.ts  projectFinancials.ts
├── domain/__tests__/                # Tests de dominio (fakeDb en memoria)
└── client/                          # Frontend React (compilado por Vite)
    ├── App.tsx  api.ts  types.ts  ui/  utils/  pages/  components/  costos/  dashboard/ (rangos de reportes) …
```

**Regla de límites** (la verifica `src/bridge/__tests__/limitesMotores.test.ts`): ERP solo importa de erp, core y bridge; ECMS solo de ecms, core y bridge; core no importa de ningún motor. Lo que cruza se agrega a `bridge/ledger.ts` o `bridge/finance.ts`.

## Convenciones del código

- Rutas Express: `asyncHandler` + `ok(res, data)` para respuestas 200.
- Errores de dominio: `new NotFoundError("Entidad", id)` — siempre 2 argumentos.
- Movimientos de costo: usar `postMovement(tx, input)` de `src/ecms/domain/budget.ts`; devuelve `{ movement, warnings }`.
- Moneda: Guaraníes sin decimales. Usar `formatGs` de `src/client/utils/numbers.ts`.
- Insumos = tabla `Material`. Precios solo por `MaterialPrice` con vigencia (nunca UPDATE); `estimatedCost` es caché del precio de hoy. Usar `addPrice` / `getPrecioVigente` de `src/core/domain/prices.ts`.
- Schema: el proyecto usa `prisma db push` (no hay carpeta migrations). La SQL equivalente de cada cambio va en `prisma/sql/`.
- Sin IVA en costos internos. Los PU del presupuesto vienen con IVA: venta sin IVA = PU ÷ (1 + Project.ivaPct/100); costo de oferta = PU ÷ Project.coeficienteK.
- Imputación en compras: usar `resolveLineItem` / `amountsByLedgerItem` de `src/ecms/domain/imputation.ts`. DIRECTO exige ítem; COMÚN no lleva ítem y su costo va al pozo de sistema "Costos a distribuir › stock de obra" (`SYS-DIST`); TIEMPO sin ítem va a "Costos a distribuir › tiempo". La línea de OC congela el `tipo` del insumo.
- Stock: todo movimiento con `fecha`, vía `recordStockMovement` (recalcula caché, conteos posteriores y saldo negativo). `WarehouseStock` es solo caché. Un conteo es un hecho; su ajuste `INVENTORY_ADJUSTMENT` se deriva. Fechas `@db.Date`: mostrarlas con `fmtDate` de `src/client/compras/status.ts` (no con `new Date()` local).
- Medición oficial: la medición del certificado al cliente (`Certification` sin partnerId y estado distinto de MEDICION_BORRADOR) es la única cantidad oficial por ítem (`loadMediciones`, `progresoItems` en `src/ecms/domain/medicion.ts`). Los certificados de subcontratistas no miden: se controlan con `controlMedicionSubcontratistas`. No hay avance por parte diario, cronograma ni cierres de período.
- Documentos y fechas: lo aprobado se protege por su estado (`assertDocTransition`), no por un período cerrado. Todo hecho se registra con su fecha real (`postMovement`, `recordStockMovement`). El certificado al cliente se aprueba exigiendo que su medición esté cerrada.
- Motor de costos: todo `BudgetMovement` ACTUAL del rango (salvo certificado al cliente) cae en un balde: ítem (A), pozo stock (B), pozo tiempo / Gastos Generales / personal (C). Validación: imputado + pérdidas + no imputado = total contable. Horas de equipo: `ParteEquipo` (llave de reparto, no costo).
- Parte diario: `ParteDiario` (cabecera, `clientUuid` único) con `ParteHoraPersonal`, `ParteEquipo`, `CargaCombustible` y `ViajeCamion`. Las horas de personal del parte reemplazan a la asistencia de ese empleado y día en el motor (`pesosPersonal`); si ese día no había asistencia, el parte la crea (nota "Parte diario #id"). Peso de personal = horas × costo hora con cargas (`costoHora` de `laborCost.ts`). El combustible es control, no costo.
- Dinero = obra + ítem + insumo + fecha: todo asiento (`postMovement`) lleva `projectId`, `budgetItemId` (el ítem si es DIRECTO; si no, el pozo `SYS-DIST` o Gastos Generales), `insumoId` si se conoce y `fecha` del hecho. Para renglones de OC usar `ledgerLines`; para gastos sueltos (caja chica, factura sin OC) `resolveExpenseLine` de `imputation.ts`.
- Caja chica: el gasto lleva insumo; compromete al cargarse y entra como costo (y al stock si es COMÚN) con la rendición aprobada.
- Certificados de subcontratistas: precio sugerido = lista de MO de la obra (`LaborPrice`) o MO del ACU (`preciosSugeridosMO`); se guarda en `CertificationItem.precioSugerido/precioFuente/insumoId` y se avisa si difiere o si supera la medición oficial. Su costo entra con fecha de aprobación (`Certification.approvedAt`).
- Planilla de subcontratistas: cada renglón es una `SubPlanillaLinea` (frente + rubro de la lista de MO + rubro presupuestario), N° "<código del frente>.<correlativo>" por (contratista, frente), reutilizada entre certificados (`resolverLinea` de `src/ecms/domain/subPlanilla.ts`). Anterior/acumulado por `planillaLineaId`; la cantidad es la medida; el costo va al `budgetItemId`. Borrador puede tener líneas sin rubro; aprobar las exige. Sugerencia de rubro: `sugerirRubro` (`src/ecms/domain/asignacionMO.ts`).
- Factura al cliente: se emite al aprobar el certificado al cliente (`facturarCertificadoCliente`, EMITIDA con `certificationId`, IVA desglosado, asiento Clientes / Ventas + IVA débito fiscal). Lo pendiente se calcula con `facturadoHasta` y la medición acumulada: nunca se factura dos veces la misma cantidad. Nunca facturar por fuera de `facturarCertificadoCliente`.
- Costo real: todo costo por ítem sale de `costEngine` (nunca del caché de `BudgetItem`). Costo real de obra = imputado + pérdidas; el no imputado se muestra aparte.
- Formularios de celular: guardar siempre vía `enqueueParte` + `flushOutbox` (`src/client/offline/outbox.ts`); el servidor debe ser idempotente por `clientUuid`. 4xx = rechazado (se corrige), sin red = pendiente.
- ACU = `ComponenteItem` (ítem × insumo, consumo por unidad, % desperdicio). El importador de presupuesto borra y recrea ítems: reengancha los ACU por `path` en la misma transacción.
- Presupuesto congelado y adendas: `BudgetItem.contractQuantity/contractAmount` son el contrato original (congelado al importar o con `POST /projects/:id/presupuesto/congelar`). Desde ahí, `totalQuantity` y `originalAmount` son la cantidad y el monto VIGENTES (caché de contrato + Σ deltas de adendas APROBADAS, `recalcularVigente` en `src/ecms/domain/adendas.ts`). Los precios unitarios no cambian: solo las adendas cambian cantidades y suman ítems extra. Con la obra congelada, `PUT`/`POST` de partidas y el reimport se bloquean (`USE_ADENDA`, `ADENDAS_EXIST`). La planilla Previsto vs Ejecutado (`previstoEjecutado`) toma contractual, real y ejecutada (medición de certificados al cliente, `loadMediciones`).
- Diseño: texto negro, sin fondos de color, rojo solo para alertas y anulados. Excepción: estados de documentos (pedidos, OC) con `StatusPill` de color (`src/client/ui/index.tsx`), tonos en `src/client/compras/status.ts`.

## Documentos de referencia

- `docs/Control_Costo_Venta_Ejecutado_CTN.xlsx` — cada hoja es una pantalla o proceso
- `docs/PRECIO MANO DE OBRA.pdf` — lista de precios de mano de obra (transcripta en `docs/PRECIO_MANO_DE_OBRA.csv`)

---

## Arquitectura de costos (regla del proyecto)
- El Centro de Costos (ítems del presupuesto por obra) es el eje del ERP. Todo costo termina imputado a obraId + itemId.
- Los módulos NO asignan costos a ítems por su cuenta: registran hechos con fecha (compras, recepciones, mediciones, horas, certificados, pagos). Un motor de costos reparte a los ítems.
- Todo hecho de costo o medición se guarda con fecha. Nunca se guardan totales pre-sumados como fuente de verdad.
- El costo por ítem se calcula para cualquier rango de fechas [desde, hasta] con los hechos de ese rango.
- Tres vías de imputación según el tipo de insumo:
  A DIRECTO: el documento trae el ítem (certificado de subcontratista, hormigón por remito, acero por planilla de doblado).
  B COMÚN: va al stock de la obra; costo por ítem = cantidad medida en el rango × consumo del ACU × precio. El consumo real = stock inicial + compras − stock final, entre los dos conteos de inventario que encierran el rango; la diferencia va a "pérdidas de material", nunca a un ítem.
  C TIEMPO: equipos, personal propio y gastos generales, por horas del parte diario; lo que no tenga ítem se prorratea por valor ganado.
- Medición con fecha: la del certificado al cliente es la única cantidad oficial por ítem.
- Costo meta por ítem = ACU; si no hay ACU, PU ÷ K de la obra (ejemplo CTN: K = 1,3454 con IVA).
- Costos sin IVA. Moneda Gs sin decimales, usar formatGs.
- Diseño de pantallas: texto negro, sin fondos de color, rojo solo para alertas y anulados; los estados de documentos van con `StatusPill` de color.
- Referencia funcional: docs/Control_Costo_Venta_Ejecutado_CTN.xlsx (cada hoja = una pantalla o proceso). Lista de MO: docs/PRECIO_MANO_DE_OBRA.pdf.
