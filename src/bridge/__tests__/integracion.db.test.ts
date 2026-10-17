/**
 * Integración ERP ↔ Taller contra una base PostgreSQL real, por HTTP y con la app Express completa.
 *
 * Corre con `npm run test:db` (no con `npm test`: necesita DATABASE_URL y tarda). Usa un esquema aparte
 * (`pruebas_db`) dentro de la misma base: lo crea con `prisma db push` y lo borra al terminar, así que
 * no toca las tablas de `public`.
 */
import { execSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config();
const BASE_URL = process.env.DATABASE_URL;
const SCHEMA = "pruebas_db";
const KEY = "clave-de-prueba";
const HOY = new Date().toISOString().slice(0, 10);

type Json = Record<string, any>;

const describeDb = BASE_URL ? describe : describe.skip;

describeDb("integración con base real", { timeout: 60_000 }, () => {
  let server: Server;
  let baseUrl: string;
  let prisma: any;
  let ids: { project: number; item: number; material: number; partner: number; partner2: number };

  async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json: Json = text ? JSON.parse(text) : {};
    return { status: res.status, data: json.data, error: json.error as Json | undefined };
  }
  const taller = (method: string, path: string, body?: unknown) => api(method, `/integracion${path}`, body, { "x-integration-key": KEY });

  beforeAll(async () => {
    const url = new URL(BASE_URL!);
    url.searchParams.set("schema", SCHEMA);
    process.env.DATABASE_URL = url.toString();
    process.env.INTEGRACION_TALLER_KEY = KEY;
    delete process.env.TALLER_URL; // los avisos al Taller quedan en la cola, sin red
    execSync("npx prisma db push --skip-generate --accept-data-loss", { stdio: "pipe", env: process.env, cwd: process.cwd() });

    prisma = (await import("../../lib/prisma")).prisma;
    const { createApp } = await import("../../app");
    server = createApp().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const project = await prisma.project.create({ data: { code: "OBRA-T", name: "Obra de prueba", location: "Asunción", globalBudget: 0 } });
    const item = await prisma.budgetItem.create({
      data: { projectId: project.id, code: "1.1", name: "Hormigón", category: "Estructura", unit: "m3", path: "1.1", totalQuantity: 100, unitPrice: 1_000_000, originalAmount: 100_000_000 },
    });
    const material = await prisma.material.create({ data: { code: "M-CEM", description: "Cemento", unit: "bolsa", category: "Cementos", tipo: "DIRECTO" } });
    const partner = await prisma.partner.create({ data: { kind: "SUPPLIER", name: "Proveedor Uno", taxId: "80000001-1" } });
    const partner2 = await prisma.partner.create({ data: { kind: "SUPPLIER", name: "Proveedor Dos", taxId: "80000002-2" } });
    ids = { project: project.id, item: item.id, material: material.id, partner: partner.id, partner2: partner2.id };
  }, 240_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    if (prisma) {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await prisma.$disconnect();
    }
  }, 60_000);

  describe("seguridad de la integración", () => {
    it("rechaza al Taller sin clave o con clave equivocada", async () => {
      expect((await api("POST", "/integracion/numeracion", { tipo: "SF", fecha: HOY, externalId: "x" })).status).toBe(401);
      expect((await api("POST", "/integracion/numeracion", { tipo: "SF", fecha: HOY, externalId: "x" }, { "x-integration-key": "otra" })).status).toBe(401);
    });
  });

  describe("numeración única", () => {
    it("es correlativa, idempotente por documento y respeta la semilla", async () => {
      const a = await taller("POST", "/numeracion", { tipo: "NE", fecha: "2031-02-01", externalId: "ne-a" });
      const b = await taller("POST", "/numeracion", { tipo: "NE", fecha: "2031-02-02", externalId: "ne-b" });
      const aOtraVez = await taller("POST", "/numeracion", { tipo: "NE", fecha: "2031-02-01", externalId: "ne-a" });
      expect(a.data).toMatchObject({ anio: 2031, numero: 1 });
      expect(b.data).toMatchObject({ anio: 2031, numero: 2 });
      expect(aOtraVez.data).toMatchObject({ anio: 2031, numero: 1 });

      await taller("POST", "/numeracion/semilla", { tipo: "SF", anio: 2031, ultimo: 384 });
      const sf = await taller("POST", "/numeracion", { tipo: "SF", fecha: "2031-06-01", externalId: "sf-1" });
      expect(sf.data).toMatchObject({ anio: 2031, numero: 385 });
      // Sembrar un número menor no hace retroceder la secuencia
      await taller("POST", "/numeracion/semilla", { tipo: "SF", anio: 2031, ultimo: 10 });
      expect((await taller("POST", "/numeracion", { tipo: "SF", fecha: "2031-06-02", externalId: "sf-2" })).data.numero).toBe(386);
    });

    it("reinicia al cambiar de año", async () => {
      const r = await taller("POST", "/numeracion", { tipo: "NE", fecha: "2032-01-05", externalId: "ne-2032" });
      expect(r.data).toMatchObject({ anio: 2032, numero: 1 });
    });
  });

  describe("SF y notas del Taller", () => {
    const sf = (extra: Json = {}) => ({
      externalId: "sf-taller-1",
      anio: 2030,
      numero: 12,
      fecha: HOY,
      proveedor: "Repuestos del Sur",
      proveedorRuc: "80011122-3",
      monto: 500000,
      moneda: "PYG",
      concepto: "Repuestos urgentes",
      ...extra,
    });

    it("reenviar la misma SF la actualiza sin duplicarla", async () => {
      expect((await taller("POST", "/taller/solicitudes-fondos", sf())).status).toBe(200);
      expect((await taller("POST", "/taller/solicitudes-fondos", sf({ monto: 650000 }))).status).toBe(200);
      const filas = await prisma.solicitudFondoTaller.findMany({ where: { anio: 2030, numero: 12 } });
      expect(filas).toHaveLength(1);
      expect(Number(filas[0].monto)).toBe(650000);
    });

    it("el mismo número para otro documento del Taller se rechaza", async () => {
      const r = await taller("POST", "/taller/solicitudes-fondos", sf({ externalId: "sf-taller-otro" }));
      expect(r.status).toBe(409);
    });

    it("una nota del Taller a la oficina queda por recibir y se recibe una sola vez", async () => {
      const nota = {
        externalId: "nota-t-1",
        anio: 2030,
        numero: 77,
        fecha: HOY,
        destinoTipo: "OFICINA",
        contenido: "DOCUMENTOS",
        lineas: [{ descripcion: "Pedido 14" }],
      };
      expect((await taller("POST", "/taller/notas", nota)).data.estado).toBe("ENVIADA");
      expect((await taller("POST", "/taller/notas", nota)).status).toBe(200); // reenvío: no duplica
      expect(await prisma.notaEnvio.count({ where: { anio: 2030, numero: 77 } })).toBe(1);
      const sinObra = await taller("POST", "/taller/notas", { ...nota, externalId: "nota-t-2", numero: 78, destinoTipo: "OBRA", destinoObraCodigo: "NO-EXISTE" });
      expect(sinObra.status).toBe(422);
    });
  });

  describe("pedidos del Taller y OC", () => {
    let requisicionId: number;
    let lineaId: number;
    const pedido = {
      externalId: "pedido-taller-1",
      numero: "41",
      fecha: HOY,
      maquinaCodigo: "016101",
      lineas: [{ externalLineId: "linea-1", descripcion: "Filtro de aceite", cantidad: 4, unidad: "u" }],
    };

    it("entra a la bandeja y reenviarlo no lo duplica", async () => {
      expect((await taller("POST", "/taller/pedidos", pedido)).status).toBe(200);
      expect((await taller("POST", "/taller/pedidos", pedido)).status).toBe(200);
      const req = await prisma.requisicion.findMany({ where: { sistemaOrigen: "TALLER", externalId: "pedido-taller-1" }, include: { lineas: true } });
      expect(req).toHaveLength(1);
      expect(req[0].lineas).toHaveLength(1);
      requisicionId = req[0].id;
      lineaId = req[0].lineas[0].id;
    });

    it("la OC del Taller no genera movimientos de presupuesto y avisa al Taller", async () => {
      const antes = await prisma.budgetMovement.count();
      const oc = await api("POST", "/compras/desde-requisicion", {
        requisicionId,
        partnerId: ids.partner,
        fecha: HOY,
        details: [{ requisicionLineaId: lineaId, quantity: 3, unitPrice: 85000 }],
      });
      expect(oc.status).toBe(201);
      expect(oc.data.projectId).toBeNull();

      // Pasarse de lo pedido (4) se rechaza: ya hay 3 en esta OC
      const demas = await api("POST", "/compras/desde-requisicion", {
        requisicionId,
        partnerId: ids.partner,
        fecha: HOY,
        details: [{ requisicionLineaId: lineaId, quantity: 2, unitPrice: 85000 }],
      });
      expect(demas.status).toBe(422);

      expect((await api("POST", `/compras/${oc.data.id}/aprobar`)).status).toBe(200);
      const emitida = await api("POST", `/compras/${oc.data.id}/emitir`);
      expect(emitida.status).toBe(200);
      expect(emitida.data.status).toBe("EMITIDA");

      expect(await prisma.budgetMovement.count()).toBe(antes);
      const tipos = (await prisma.eventoSalida.findMany({ orderBy: { id: "asc" } })).map((e: Json) => e.tipo);
      expect(tipos).toContain("pedido.tomado_por_erp");
      expect(tipos).toContain("pedido.oc_emitida");
      expect((await prisma.requisicion.findUnique({ where: { id: requisicionId } })).estado).toBe("COMPRADA_PARCIAL");
    });

    it("rechazar un pedido que ya tiene OC vigente no se puede", async () => {
      const r = await api("POST", `/bandeja/${requisicionId}/rechazar`, { motivo: "ya no" });
      expect(r.status).toBeGreaterThanOrEqual(400);
    });

    it("un pedido nuevo sin OC se puede rechazar y el Taller se entera", async () => {
      await taller("POST", "/taller/pedidos", { ...pedido, externalId: "pedido-taller-2", numero: "42", lineas: [{ externalLineId: "l-2", descripcion: "Correa", cantidad: 1 }] });
      const req = await prisma.requisicion.findFirst({ where: { externalId: "pedido-taller-2" } });
      const r = await api("POST", `/bandeja/${req.id}/rechazar`, { motivo: "Se compra local" });
      expect(r.status).toBe(200);
      const evs = await prisma.eventoSalida.findMany({ where: { tipo: "pedido.rechazado" } });
      expect(evs.length).toBeGreaterThan(0);
    });
  });

  describe("pedidos de obra (ECMS) y OC: imputación como siempre", () => {
    it("al aprobar el pedido nace su requisición y la OC emitida compromete presupuesto en el ítem", async () => {
      const mr = await api("POST", "/pedidos", {
        projectId: ids.project,
        requestedDate: HOY,
        details: [{ materialId: ids.material, budgetItemId: ids.item, quantity: 50 }],
      });
      expect(mr.status).toBe(201);
      expect((await api("POST", `/pedidos/${mr.data.id}/aprobar`)).status).toBe(200);
      expect(await prisma.requisicion.count({ where: { sistemaOrigen: "ECMS", materialRequestId: mr.data.id } })).toBe(1);

      const detalle = await prisma.materialRequestDetail.findFirst({ where: { requestId: mr.data.id } });
      const oc = await api("POST", "/compras", {
        materialRequestId: mr.data.id,
        partnerId: ids.partner2,
        fecha: HOY,
        details: [{ requestDetailId: detalle.id, budgetItemId: ids.item, quantity: 50, unitPrice: 60000 }],
      });
      expect(oc.status).toBe(201);
      expect((await api("POST", `/compras/${oc.data.id}/aprobar`)).status).toBe(200);
      expect((await api("POST", `/compras/${oc.data.id}/emitir`)).status).toBe(200);

      const movs = await prisma.budgetMovement.findMany({ where: { sourceType: "PurchaseOrder", sourceId: oc.data.id } });
      expect(movs).toHaveLength(1);
      expect(movs[0]).toMatchObject({ projectId: ids.project, budgetItemId: ids.item, stage: "COMMITTED" });
      expect(Number(movs[0].amount)).toBe(3_000_000);
    });
  });
});
