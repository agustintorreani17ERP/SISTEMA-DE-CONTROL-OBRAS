# InfraTrack ERP — control de obras

Backend Express + Prisma + PostgreSQL (Neon). Frontend React + Tailwind (se compila con Vite y lo sirve el mismo servidor).

## Arranque

```bash
npm install                 # también corre prisma generate
cp .env.example .env        # completar DATABASE_URL
npm run db:push             # aplica el esquema a la base
npm run db:seed             # opcional: obra de ejemplo (no borra datos)
npm run dev                 # http://localhost:3000
npm test                    # pruebas del importador de presupuestos
```

Sin `DATABASE_URL` el servidor usa un almacenamiento simulado en `mock-db-store.json` (solo desarrollo).

## Presupuesto y centro de costos

1. **Importar** el presupuesto del contrato (Centro de Costos → Importar presupuesto). El importador detecta columnas, rubros, subtotales y recargos (IVA, G.G.), muestra el cuadre contra el total de la planilla y el monto del contrato, y permite corregir fila por fila antes de guardar.
2. Todo gasto se **imputa a un ítem** del presupuesto (nunca a un rubro). Lo que no tiene rubro va a **Gastos Generales / No imputados** (`GG.01`–`GG.03`), que se crea con cada obra.
3. Cada descuento es una fila del **libro mayor** (`BudgetMovement`); anular crea un reverso. Superar el saldo no bloquea: se registra y se marca.

| Documento | Cuándo descuenta | Qué registra |
|---|---|---|
| Orden de compra | Emitir → comprometido; recibir → gastado; anular → reverso | Monto, en el rubro elegido por línea |
| Certificado al cliente | Aprobar | Cantidad y monto de avance real (no es costo) |
| Certificado de subcontratista | Certificar/aprobar; anular → reverso | Costo y cantidad ejecutada por subcontratistas |
| Caja chica | Registrar comprobante; rechazar → reverso | Costo |
| Ajuste manual | Registrar (con motivo) | Costo |

Para sumar una fuente de gasto nueva: agregar el valor a `BudgetMovementSource` en `prisma/schema.prisma` y llamar a `postMovement`/`postCost` al confirmar y a `reverseMovements` al anular (`src/domain/budget.ts`).

## API principal

| Método | Ruta | Efecto |
|---|---|---|
| POST | `/api/projects/:id/budget-import/preview` | Lee la planilla y devuelve filas, árbol y cuadre (no guarda) |
| POST | `/api/projects/:id/budget-import/commit` | Guarda el presupuesto (bloqueado si ya hay movimientos) |
| GET | `/api/projects/:id/cost-control` | Árbol con subtotales, desglose por origen y KPIs |
| GET | `/api/projects/:id/budget-movements` | Libro mayor (filtrable por `budgetItemId`) |
| GET | `/api/projects/:id/imputable-items` | Ítems donde se puede imputar, con saldo |
| POST | `/api/projects/:id/budget-adjustments` | Ajuste manual con motivo |
| POST | `/api/projects/:id/budget-ledger/rebuild` | Sincroniza documentos y recalcula el caché |
| GET/POST | `/api/pedidos` | Pedidos de material (rubro opcional) |
| POST | `/api/compras` | OC ligada a un pedido; rubro obligatorio por línea |
| POST | `/api/compras/:id/emitir` · `/recibir` · `/anular` | Compromete · pasa a gastado · revierte |
| POST | `/api/subcontratos/certificados/:id/certificar` · `/anular` | Descuenta costo y cantidad · revierte |
| POST | `/api/certifications/:id/approve` | Certificado de avance: suma avance real |
| GET/POST | `/api/caja-chica`, `/fondos`, `/gastos` | Caja chica imputada al presupuesto |
