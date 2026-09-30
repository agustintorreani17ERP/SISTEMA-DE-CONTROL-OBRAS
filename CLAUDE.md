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

```
src/
├── server.ts                   # Punto de entrada del servidor
├── app.ts                      # Express app + middlewares
├── routes.ts                   # Montaje de todos los routers en /api
├── config/env.ts               # Variables de entorno
├── lib/
│   ├── prisma.ts               # Singleton PrismaClient
│   └── money.ts                # Decimal helpers (toDecimal, moneyNumber)
├── errors/domain.ts            # NotFoundError, ValidationError, etc.
├── http/respond.ts             # ok() helper para respuestas JSON
├── middleware/
│   ├── asyncHandler.ts         # Wrapper para rutas async
│   └── errorHandler.ts        # Manejo global de errores
├── domain/                     # Lógica de negocio transversal
│   ├── budget.ts               # postMovement() — registra movimientos en BudgetMovement
│   ├── prices.ts               # Precio vigente por fecha (MaterialPrice), addPrice()
│   ├── acuMath.ts              # Cálculo puro de ACU, costo meta, margen y Pareto (lo usa también el cliente)
│   ├── acu.ts                  # ACU de ítems con precios vigentes (carga desde la base)
│   ├── audit.ts
│   ├── stock.ts                # Libro de stock fechado: salidas, transferencias, conteos (ajuste derivado)
│   ├── stockMath.ts            # Cálculo puro de saldo a fecha, ajustes de conteos y saldo negativo
│   ├── costEngineMath.ts       # Motor de costos puro (vías A/B/C, pérdidas, validación) — tests con el Excel
│   ├── costEngine.ts           # costEngine(db, obraId, desde, hasta): lee hechos del rango y calcula; caché/snapshot
│   ├── costCache.ts            # Caché de rangos cerrados (se vacía al cambiar ACU, precios, K o cargas RRHH)
│   ├── laborCost.ts            # Costo hora con cargas y pesos de personal de la vía C — puro
│   ├── labor.ts                # Carga las cargas (RRHHConfig) y el costo hora de empleados desde la base
│   ├── fuelMath.ts             # Control de combustible (tanque lleno, horómetro vs parte) — puro
│   ├── laborPriceMath.ts       # Precio sugerido de MO (lista de la obra o MO del ACU) y alertas — puro
│   ├── laborPrice.ts           # preciosSugeridosMO(db, obra, ítems, fecha)
│   ├── clientBillingMath.ts    # Factura al cliente desde la medición oficial (IVA, fondo de reparo) — puro
│   ├── clientBilling.ts        # Borrador / emisión de la factura de un cierre (una por cierre)
│   ├── reconciliationMath.ts   # Conciliación documentos ↔ libro mayor ↔ facturas — puro
│   ├── reconciliation.ts       # Conciliación por rango + totales del motor
│   ├── dashboardMath.ts        # Tablero (hoja 8): métricas por ítem/rubro/obra, EAC, alertas, curva S — puro
│   ├── dashboard.ts            # dashboard(db, obra, desde, hasta) desde el costEngine + itemDrill (documentos del ítem)
│   ├── progressMath.ts         # Avance acumulado/rango (parte vs medición oficial), VP, VG, IP — puro
│   ├── progress.ts             # Avance por obra, cierres oficiales, assertOpenPeriod, control de subcontratistas
│   ├── planImport.ts           # Lectura del cronograma pegado (períodos y cantidades o %) — puro
│   ├── imputation.ts           # Regla DIRECTO/COMÚN/TIEMPO para líneas de pedido y OC
│   ├── ledgerSync.ts
│   ├── lifecycle.ts
│   ├── generalExpenses.ts
│   └── projectFinancials.ts
├── modules/                    # Un directorio por módulo funcional
│   ├── acu/                    # ACU por ítem, biblioteca/copia, K e IVA de la obra
│   ├── auth/
│   ├── budgets/                # Importación de presupuesto desde Excel
│   │   └── engine/             # Parser columnar (budgetImportService, budgetTree, etc.)
│   ├── catalogs/               # Materiales, proveedores, rubros
│   ├── certifications/         # Certificados de subcontratistas
│   │   └── certMath.ts         # Cálculos de medición y avance
│   ├── cost-control/           # Centro de costos (costTree, costControl.controller)
│   ├── dashboard/
│   ├── insumos/                # Catálogo de insumos (tabla Material) + importador de lista de MO
│   ├── invoices/               # Facturas legales
│   ├── labor-prices/           # Precios de mano de obra (ref. PRECIO_MANO_DE_OBRA.pdf)
│   ├── material-requests/      # Pedidos de materiales
│   ├── partes/                 # Parte diario (horas por ítem, avance, combustible, viajes), idempotente por clientUuid
│   ├── petty-cash/             # Caja chica
│   ├── purchase-orders/        # Órdenes de compra
│   ├── rrhh/                   # Legajo, asistencia, liquidación de haberes
│   ├── stock/                  # Almacén, movimientos de stock
│   ├── subcontracts/           # Contratos con subcontratistas
│   └── uploads/                # Archivos adjuntos
└── client/                     # Frontend React (compilado por Vite)
    ├── main.tsx                 # Entry point
    ├── App.tsx                  # Shell principal: auth, selección de obra, routing por tab
    ├── api.ts                   # Todos los fetch al backend
    ├── types.ts                 # Tipos compartidos con el backend
    ├── ui/                      # Componentes de diseño (Card, Button, Field, Tabs, etc.)
    ├── utils/                   # format.ts, numbers.ts, numberToWords.ts
    ├── pages/                   # Páginas de nivel superior (Portfolio, Config, Stock, Overview)
    ├── insumos/                 # Pantalla de insumos (en Configuración) e importador MO
    ├── components/              # Tabs por módulo (un archivo por tab del sidebar)
    │   ├── certifications/      # MeasurementForm, CertificateExcelPreview, sheetGrid
    │   └── rrhh/                # LegajoTab, AsistenciaTab, LiquidacionTab, ConfigRRHHTab
    ├── certificados/            # Vista detalle de certificado (CertificateDetail, MeasurementWizard)
    ├── compras/                 # Formularios y vistas de órdenes/pedidos
    ├── partes/                  # ParteDiarioForm (celular), SearchPick, CombustiblePanel, ViajesPanel
    ├── offline/outbox.ts        # Cola sin conexión (IndexedDB) + caché local de catálogos
    ├── dashboard/               # Tablero de costos (CostDashboard, ItemDrillDrawer, rangos y comparación)
    ├── contabilidad/            # Conciliación con costos, imputación de facturas sin OC
    └── costos/                  # CostSheet, sheetModel, AcuPanel (ACU por ítem), CostParamsBar (K / IVA)
```

## Convenciones del código

- Rutas Express: `asyncHandler` + `ok(res, data)` para respuestas 200.
- Errores de dominio: `new NotFoundError("Entidad", id)` — siempre 2 argumentos.
- Movimientos de costo: usar `postMovement(tx, input)` de `src/domain/budget.ts`; devuelve `{ movement, warnings }`.
- Moneda: Guaraníes sin decimales. Usar `formatGs` de `src/client/utils/numbers.ts`.
- Insumos = tabla `Material`. Precios solo por `MaterialPrice` con vigencia (nunca UPDATE); `estimatedCost` es caché del precio de hoy. Usar `addPrice` / `getPrecioVigente` de `src/domain/prices.ts`.
- Schema: el proyecto usa `prisma db push` (no hay carpeta migrations). La SQL equivalente de cada cambio va en `prisma/sql/`.
- Sin IVA en costos internos. Los PU del presupuesto vienen con IVA: venta sin IVA = PU ÷ (1 + Project.ivaPct/100); costo de oferta = PU ÷ Project.coeficienteK.
- Imputación en compras: usar `resolveLineItem` / `amountsByLedgerItem` de `src/domain/imputation.ts`. DIRECTO exige ítem; COMÚN no lleva ítem y su costo va al pozo de sistema "Costos a distribuir › stock de obra" (`SYS-DIST`); TIEMPO sin ítem va a "Costos a distribuir › tiempo". La línea de OC congela el `tipo` del insumo.
- Stock: todo movimiento con `fecha`, vía `recordStockMovement` (recalcula caché, conteos posteriores y saldo negativo). `WarehouseStock` es solo caché. Un conteo es un hecho; su ajuste `INVENTORY_ADJUSTMENT` se deriva. Fechas `@db.Date`: mostrarlas con `fmtDate` de `src/client/compras/status.ts` (no con `new Date()` local).
- Avance: `AvanceItem` con fecha y origen PARTE_DIARIO (provisorio) o MEDICION_OFICIAL (reemplaza los partes hasta su fecha). La medición oficial ES la medición del certificado al cliente (`Certification` sin partnerId): al cerrarla se registra con `syncOfficialMeasurement`. Los certificados de subcontratistas no miden: se controlan con `subcontractOverMeasured`. Plan: `AvancePlanificado` (cantidad del período que termina en `fecha`).
- Cierres: `CierrePeriodo` guarda snapshot. Todo hecho fechado hasta el último cierre es inmutable: llamar `assertOpenPeriod` antes de crear/editar/borrar hechos con fecha. El certificado al cliente solo se aprueba si su período está cerrado.
- Motor de costos: todo `BudgetMovement` ACTUAL del rango (salvo certificado al cliente) cae en un balde: ítem (A), pozo stock (B), pozo tiempo / Gastos Generales / personal (C). Validación: imputado + pérdidas + no imputado = total contable. Horas de equipo: `ParteEquipo` (llave de reparto, no costo). Al cerrar, el resultado queda en `CierrePeriodo.snapshot.costos`. `postMovement` rechaza fechas cerradas (salvo CLIENT_CERTIFICATE).
- Parte diario: `ParteDiario` (cabecera, `clientUuid` único) con `ParteHoraPersonal`, `ParteEquipo`, `AvanceItem` (sourceType "ParteDiario"), `CargaCombustible` y `ViajeCamion`. Las horas de personal del parte reemplazan a la asistencia de ese empleado y día en el motor (`pesosPersonal`); si ese día no había asistencia, el parte la crea (nota "Parte diario #id"). Peso de personal = horas × costo hora con cargas (`costoHora` de `laborCost.ts`). El combustible es control, no costo.
- Dinero = obra + ítem + insumo + fecha: todo asiento (`postMovement`) lleva `projectId`, `budgetItemId` (el ítem si es DIRECTO; si no, el pozo `SYS-DIST` o Gastos Generales), `insumoId` si se conoce y `fecha` del hecho. Para renglones de OC usar `ledgerLines`; para gastos sueltos (caja chica, factura sin OC) `resolveExpenseLine` de `imputation.ts`. Hechos confirmados tarde (rendición, liquidación, factura de período cerrado) usan `fechaContable` (su fecha, o el primer día abierto).
- Caja chica: el gasto lleva insumo; compromete al cargarse y entra como costo (y al stock si es COMÚN) con la rendición aprobada.
- Certificados de subcontratistas: precio sugerido = lista de MO de la obra (`LaborPrice`) o MO del ACU (`preciosSugeridosMO`); se guarda en `CertificationItem.precioSugerido/precioFuente/insumoId` y se avisa si difiere o si supera la medición oficial. Su costo entra con fecha de aprobación (`Certification.approvedAt`).
- Factura al cliente: sale del snapshot del `CierrePeriodo` (`createClientInvoice`, una por cierre). Aprobar el certificado al cliente ya no factura.
- Tablero: todo indicador de costo sale de `costEngine` (nunca del caché de `BudgetItem`). Los índices de rubro/obra se recalculan con sumas (`aggregate`), no se promedian. Costo real de obra = imputado + pérdidas; el no imputado se muestra aparte. Umbrales en `UMBRALES` (IC 0,95, IP 0,9, no imputado 10 %).
- Formularios de celular: guardar siempre vía `enqueueParte` + `flushOutbox` (`src/client/offline/outbox.ts`); el servidor debe ser idempotente por `clientUuid`. 4xx = rechazado (se corrige), sin red = pendiente.
- ACU = `ComponenteItem` (ítem × insumo, consumo por unidad, % desperdicio). El importador de presupuesto borra y recrea ítems: reengancha los ACU por `path` en la misma transacción.
- Diseño: texto negro, sin fondos de color, rojo solo para alertas.

## Documentos de referencia

- `docs/Control_Costo_Venta_Ejecutado_CTN.xlsx` — cada hoja es una pantalla o proceso
- `docs/PRECIO MANO DE OBRA.pdf` — lista de precios de mano de obra (transcripta en `docs/PRECIO_MANO_DE_OBRA.csv`)

---

## Arquitectura de costos (regla del proyecto)
- El Centro de Costos (ítems del presupuesto por obra) es el eje del ERP. Todo costo termina imputado a obraId + itemId.
- Los módulos NO asignan costos a ítems por su cuenta: registran hechos con fecha (compras, recepciones, mediciones, horas, certificados, pagos). Un motor de costos reparte a los ítems.
- Todo hecho de costo o avance se guarda con fecha. Nunca se guardan totales pre-sumados como fuente de verdad.
- El costo por ítem se calcula para cualquier rango de fechas [desde, hasta] con los hechos de ese rango.
- Tres vías de imputación según el tipo de insumo:
  A DIRECTO: el documento trae el ítem (certificado de subcontratista, hormigón por remito, acero por planilla de doblado).
  B COMÚN: va al stock de la obra; costo por ítem = cantidad medida en el rango × consumo del ACU × precio. El consumo real = stock inicial + compras − stock final, entre los dos conteos de inventario que encierran el rango; la diferencia va a "pérdidas de material", nunca a un ítem.
  C TIEMPO: equipos, personal propio y gastos generales, por horas del parte diario; lo que no tenga ítem se prorratea por valor ganado.
- Avance con fecha: parte diario (provisorio) + medición oficial (corrige).
- Costo meta por ítem = ACU; si no hay ACU, PU ÷ K de la obra (ejemplo CTN: K = 1,3454 con IVA).
- Costos sin IVA. Moneda Gs sin decimales, usar formatGs.
- Cierres oficiales congelan un rango como snapshot para certificados y contabilidad; lo cerrado no se edita.
- Diseño de pantallas: texto negro, sin fondos de color, rojo solo para alertas.
- Referencia funcional: docs/Control_Costo_Venta_Ejecutado_CTN.xlsx (cada hoja = una pantalla o proceso). Lista de MO: docs/PRECIO_MANO_DE_OBRA.pdf.
