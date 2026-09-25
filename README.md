# InfraTrack ERP — obras viales

Backend Express + Prisma + PostgreSQL (Neon). Frontend React + Tailwind.

## Arranque

```bash
# backend (carpeta sistema-erp)
npm install
npx prisma generate
npx prisma db push
npx prisma db seed
npm run dev

# frontend (carpeta erp-frontend)
npm run dev
```

`DATABASE_URL` ya vive en `.env` (Neon). Plantilla: `.env.example`.

## API

| Método | Ruta | Efecto |
|---|---|---|
| GET | `/api/dashboard` | KPIs gerencia |
| GET/POST | `/api/pedidos` | Pedidos de material (origen jefe de frente) |
| POST | `/api/pedidos/:id/aprobar` | BORRADOR → APROBADO_PARA_COMPRA |
| GET/POST | `/api/compras` | OC **obligatoriamente** ligada a un pedido |
| POST | `/api/compras/:id/aprobar` | → APROBADO_PARA_COMPRA |
| POST | `/api/compras/:id/emitir` | Compromete presupuesto (techo duro) |
| POST | `/api/compras/:id/recibir` | Stock + ejecución |
| POST | `/api/compras/:id/anular` | Libera compromiso si estaba EMITIDA |
| POST | `/api/subcontratos/certificados/:id/certificar` | Techo de partida + techo de contrato |
