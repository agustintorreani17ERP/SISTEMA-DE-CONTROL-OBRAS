/**
 * Conciliación por rango entre los documentos (OC recibidas, certificados de subcontratistas,
 * caja chica rendida, facturas imputadas, liquidaciones), el libro mayor y las facturas (puro).
 * El motor de costos parte del libro mayor: si documentos = libro y el motor valida
 * (imputado + pérdidas + no imputado = total contable), todo el dinero del rango está en costos.
 */

export type Fuente = "OC" | "SUBCONTRATO" | "CAJA_CHICA" | "FACTURA" | "PERSONAL" | "OTROS";

export interface DocInput {
  sourceType: string;
  sourceId: number;
  fuente: Fuente;
  numero: string;
  fecha: string | null;
  /** Monto que el documento debería tener en el libro (costo incurrido). */
  esperado: number;
  enRango: boolean;
}

export interface LedgerInput {
  sourceType: string;
  sourceId: number;
  sourceNumber: string | null;
  fuente: Fuente;
  amount: number;
  fecha: string;
}

export interface FacturaInput {
  invoiceId: number;
  numero: string;
  fecha: string;
  total: number;
  /** Documento que respalda la factura (OC o certificado). */
  sourceType: string;
  sourceId: number;
  /** Total del documento para el control de 3 vías (mismo criterio que ThreeWayMatch). */
  totalDocumento: number;
}

export type TipoPartida = "SIN_ASIENTO" | "SIN_DOCUMENTO" | "DIFERENCIA" | "FUERA_DE_RANGO" | "FACTURA_DIFIERE" | "SIN_FACTURA";

export interface Partida {
  tipo: TipoPartida;
  fuente: Fuente;
  numero: string;
  fecha: string | null;
  documento: number | null;
  libro: number | null;
  diferencia: number;
  detalle: string;
}

export interface ReconciliationResult {
  porFuente: { fuente: Fuente; documentos: number; libro: number; diferencia: number }[];
  partidas: Partida[];
  totales: { documentos: number; libro: number; diferencia: number };
}

const TOL = 1; // Gs de redondeo
const key = (t: string, id: number) => `${t}#${id}`;
const FUENTES: Fuente[] = ["OC", "SUBCONTRATO", "CAJA_CHICA", "FACTURA", "PERSONAL", "OTROS"];

export function reconcile(docs: DocInput[], ledger: LedgerInput[], facturas: FacturaInput[], opts: { facturaExigida?: Set<string> } = {}): ReconciliationResult {
  const libroPorDoc = new Map<string, { amount: number; fuente: Fuente; numero: string | null; fecha: string }>();
  for (const l of ledger) {
    const k = key(l.sourceType, l.sourceId);
    const acc = libroPorDoc.get(k) ?? { amount: 0, fuente: l.fuente, numero: l.sourceNumber, fecha: l.fecha };
    acc.amount += l.amount;
    libroPorDoc.set(k, acc);
  }
  const docPorKey = new Map(docs.map((d) => [key(d.sourceType, d.sourceId), d]));
  const partidas: Partida[] = [];
  const porFuente = new Map<Fuente, { documentos: number; libro: number }>(FUENTES.map((f) => [f, { documentos: 0, libro: 0 }]));

  for (const d of docs) {
    if (!d.enRango) continue;
    porFuente.get(d.fuente)!.documentos += d.esperado;
    const l = libroPorDoc.get(key(d.sourceType, d.sourceId));
    if (!l) {
      partidas.push({ tipo: "SIN_ASIENTO", fuente: d.fuente, numero: d.numero, fecha: d.fecha, documento: d.esperado, libro: null, diferencia: d.esperado, detalle: "El documento no tiene costo en el libro mayor dentro del rango" });
    } else if (Math.abs(l.amount - d.esperado) > TOL) {
      partidas.push({ tipo: "DIFERENCIA", fuente: d.fuente, numero: d.numero, fecha: d.fecha, documento: d.esperado, libro: l.amount, diferencia: d.esperado - l.amount, detalle: "El monto del libro no coincide con el documento" });
    }
  }
  for (const [k, l] of libroPorDoc) {
    porFuente.get(l.fuente)!.libro += l.amount;
    const d = docPorKey.get(k);
    if (d?.enRango) continue;
    if (Math.abs(l.amount) <= TOL) continue; // asiento y reverso dentro del rango
    if (d) {
      partidas.push({ tipo: "FUERA_DE_RANGO", fuente: l.fuente, numero: d.numero, fecha: d.fecha, documento: d.esperado, libro: l.amount, diferencia: -l.amount, detalle: "El asiento cae en el rango pero el documento tiene otra fecha (período cerrado o fecha corregida)" });
    } else {
      partidas.push({ tipo: "SIN_DOCUMENTO", fuente: l.fuente, numero: l.numero ?? k, fecha: l.fecha, documento: null, libro: l.amount, diferencia: -l.amount, detalle: "Asiento sin documento de respaldo en el rango (ajuste manual, transferencia o documento legado)" });
    }
  }
  // Facturas contra su documento (control de 3 vías) y documentos sin factura
  const facturados = new Set<string>();
  for (const f of facturas) {
    const k = key(f.sourceType, f.sourceId);
    facturados.add(k);
    if (Math.abs(f.total - f.totalDocumento) > TOL) {
      const d = docPorKey.get(k);
      partidas.push({ tipo: "FACTURA_DIFIERE", fuente: d?.fuente ?? "OTROS", numero: `Fact. ${f.numero}`, fecha: f.fecha, documento: f.totalDocumento, libro: f.total, diferencia: f.totalDocumento - f.total, detalle: `La factura no coincide con ${d ? d.numero : "su documento"}` });
    }
  }
  for (const d of docs) {
    const k = key(d.sourceType, d.sourceId);
    if (d.enRango && opts.facturaExigida?.has(k) && !facturados.has(k)) {
      partidas.push({ tipo: "SIN_FACTURA", fuente: d.fuente, numero: d.numero, fecha: d.fecha, documento: d.esperado, libro: libroPorDoc.get(k)?.amount ?? null, diferencia: 0, detalle: "Costo registrado sin factura recibida (provisión)" });
    }
  }

  const rows = FUENTES.map((fuente) => {
    const r = porFuente.get(fuente)!;
    return { fuente, documentos: Math.round(r.documentos), libro: Math.round(r.libro), diferencia: Math.round(r.documentos - r.libro) };
  }).filter((r) => r.documentos || r.libro);
  const documentos = rows.reduce((s, r) => s + r.documentos, 0);
  const libro = rows.reduce((s, r) => s + r.libro, 0);
  const orden: TipoPartida[] = ["SIN_ASIENTO", "DIFERENCIA", "SIN_DOCUMENTO", "FUERA_DE_RANGO", "FACTURA_DIFIERE", "SIN_FACTURA"];
  partidas.sort((a, b) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo) || Math.abs(b.diferencia) - Math.abs(a.diferencia));
  return { porFuente: rows, partidas, totales: { documentos, libro, diferencia: documentos - libro } };
}
