import * as fs from "fs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildBudgetTree } from "../budgetTree";
import { detectNumberFormat, extractFromBuffer, extractFromPastedText, parseFlexibleNumber } from "../matrixExtractor";
import { generatePreview } from "../preview";

const HEADER = ["Item", "Descripción", "Unidad", "Cantidad", "Precio Unitario", "Precio Total"];

type SheetSpec = {
  name: string;
  rows: unknown[][];
  merges?: XLSX.Range[];
  hiddenRows?: number[];
};

function workbook(...sheets: SheetSpec[]) {
  const wb = XLSX.utils.book_new();
  for (const spec of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(spec.rows);
    if (spec.merges) ws["!merges"] = spec.merges;
    if (spec.hiddenRows) {
      ws["!rows"] = [];
      for (const r of spec.hiddenRows) ws["!rows"][r] = { hidden: true };
    }
    XLSX.utils.book_append_sheet(wb, ws, spec.name);
  }
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }) as Buffer;
  return extractFromBuffer(buffer, "presupuesto.xlsx");
}

const items = (preview: ReturnType<typeof generatePreview>) => preview.build.nodes.filter((n) => n.kind === "ITEM");

describe("lectura de números", () => {
  it("respeta el formato paraguayo (coma decimal)", () => {
    expect(parseFlexibleNumber("12,5", "PY")).toBe(12.5);
    expect(parseFlexibleNumber("1.500.000", "PY")).toBe(1500000);
    expect(parseFlexibleNumber("1.500", "PY")).toBe(1500);
    expect(parseFlexibleNumber("1.234.567,89", "PY")).toBe(1234567.89);
    expect(parseFlexibleNumber("Gs. 250.000", "PY")).toBe(250000);
    expect(parseFlexibleNumber("(1.500)", "PY")).toBe(-1500);
  });

  it("respeta el formato inglés", () => {
    expect(parseFlexibleNumber("1,234,567.89", "EN")).toBe(1234567.89);
    expect(parseFlexibleNumber("12.5", "EN")).toBe(12.5);
  });

  it("no convierte textos con letras en números", () => {
    expect(parseFlexibleNumber("12,5 m3", "PY")).toBeNull();
    expect(parseFlexibleNumber("Bloque 3", "PY")).toBeNull();
    expect(parseFlexibleNumber("No cotiza", "PY")).toBeNull();
  });

  it("detecta el formato del texto pegado", () => {
    const wb = extractFromPastedText("Desc\tCant\tPU\nA\t12,5\t1.500.000\nB\t3,25\t2.000");
    expect(detectNumberFormat(wb.sheets)).toBe("PY");
  });
});

describe("clasificación y jerarquía", () => {
  it("no pisa ítems cuando la numeración reinicia en cada rubro", () => {
    const wb = workbook({
      name: "Presupuesto",
      rows: [
        HEADER,
        [1, "TRABAJOS PRELIMINARES"],
        [1, "Replanteo", "m2", 100, 5000, 500000],
        [2, "Limpieza de terreno", "m2", 100, 3000, 300000],
        [2, "FUNDACIONES"],
        [1, "Excavación", "m3", 50, 40000, 2000000],
        [2, "Hormigón de cimientos", "m3", 10, 1000000, 10000000],
        ["", "TOTAL GENERAL", "", "", "", 12800000],
      ],
    });
    const preview = generatePreview(wb);
    const { nodes, reconciliation, counts } = preview.build;

    expect(counts.rubros).toBe(2);
    expect(counts.items).toBe(4);
    expect(new Set(nodes.map((n) => n.path)).size).toBe(nodes.length);
    const excavacion = nodes.find((n) => n.name === "Excavación")!;
    expect(excavacion.parentPath).toBe(nodes.find((n) => n.name === "FUNDACIONES")!.path);
    expect(reconciliation.itemsTotal).toBe(12800000);
    expect(reconciliation.declaredGrandTotal).toBe(12800000);
    expect(reconciliation.balanced).toBe(true);
    expect(preview.build.issues.filter((i) => i.type === "CRITICAL")).toHaveLength(0);
  });

  it("no cuenta dos veces el subtotal de un rubro ni asume cantidad 1", () => {
    const wb = workbook({
      name: "Obra",
      rows: [
        HEADER,
        ["1", "ESTRUCTURA", "", "", "", 1500000],
        ["1.1", "Columnas", "m3", 1, 1000000, 1000000],
        ["1.2", "Vigas", "m3", 1, 500000, 500000],
        ["2", "LIMPIEZA FINAL DE OBRA", "", "", "", 200000],
      ],
    });
    const { build } = generatePreview(wb);

    expect(build.reconciliation.itemsTotal).toBe(1700000);
    const estructura = build.nodes.find((n) => n.name === "ESTRUCTURA")!;
    expect(estructura.kind).toBe("RUBRO");
    expect(estructura.amount).toBe(1500000);
    expect(build.reconciliation.rubroChecks.find((c) => c.name === "ESTRUCTURA")?.difference).toBe(0);

    // Título sin ítems pero con monto → partida global
    const limpieza = build.nodes.find((n) => n.name === "LIMPIEZA FINAL DE OBRA")!;
    expect(limpieza.kind).toBe("ITEM");
    expect(limpieza.unit).toBe("gl");
    expect(limpieza.amount).toBe(200000);
  });

  it("marca el descuadre entre el subtotal de la planilla y la suma de ítems", () => {
    const wb = workbook({
      name: "Obra",
      rows: [
        HEADER,
        ["1", "ALBAÑILERÍA", "", "", "", 999999],
        ["1.1", "Muro de ladrillo", "m2", 10, 50000, 500000],
      ],
    });
    const { build } = generatePreview(wb);
    expect(build.reconciliation.balanced).toBe(false);
    expect(build.issues.some((i) => i.category === "RECONCILIATION")).toBe(true);
  });

  it("detecta rubros sin código y subrubros anidados", () => {
    const wb = workbook({
      name: "Obra",
      rows: [
        HEADER,
        ["", "OBRAS CIVILES"],
        ["", "Mampostería"],
        ["a", "Muro 0,15", "m2", 20, 60000, 1200000],
        ["b", "Muro 0,30", "m2", 10, 90000, 900000],
        ["", "Revoques"],
        ["a", "Revoque interior", "m2", 30, 25000, 750000],
      ],
    });
    const { build } = generatePreview(wb);
    const obras = build.nodes.find((n) => n.name === "OBRAS CIVILES")!;
    const mamposteria = build.nodes.find((n) => n.name === "Mampostería")!;
    const revoques = build.nodes.find((n) => n.name === "Revoques")!;
    expect(obras.level).toBe(0);
    expect(mamposteria.parentPath).toBe(obras.path);
    expect(revoques.parentPath).toBe(obras.path);
    expect(obras.amount).toBe(2850000);
  });

  it("importa códigos duplicados dentro del mismo rubro con advertencia y clave propia", () => {
    const wb = workbook({
      name: "Obra",
      rows: [
        HEADER,
        ["1", "RUBRO"],
        ["1.1", "Ítem A", "un", 1, 100, 100],
        ["1.1", "Ítem B", "un", 1, 200, 200],
      ],
    });
    const { build } = generatePreview(wb);
    expect(build.issues.some((i) => i.type === "WARNING" && i.category === "DUPLICATE_CODE")).toBe(true);
    expect(build.issues.filter((i) => i.type === "CRITICAL")).toHaveLength(0);
    expect(new Set(build.nodes.map((n) => n.path)).size).toBe(build.nodes.length);
    expect(build.reconciliation.itemsTotal).toBe(300);
  });
});

describe("planillas por áreas (estructura tipo licitación)", () => {
  // Réplica reducida de la estructura de pruebacerterp.xlsx: áreas y bloques escritos en la
  // columna de código, numeración que reinicia en cada bloque, etiquetas B.N., subtítulos,
  // títulos con =F*D que da 0, ítems con PU 0 y un código repetido.
  const rows = [
    HEADER,
    ["Área: 1) OBRADOR", "", "", "", "", 0],
    ["1.1", "OBRADORES", "", "", "", 0],
    ["1.1.1", "Obrador", "m²", 10, 1000, 10000],
    ["Área: 2) BLOQUE 6 - AULAS", "", "", "", "", 0],
    ["", "ESTRUCTURA DE HORMIGÓN ARMADO", "", "", "", 0],
    [1, "Trabajos preliminares", "", "", "", 0],
    ["1.1", "Limpieza y desbroce", "gl", 1, 0, 0],
    ["1.2", "Replanteo", "gl", 1, 5000, 5000],
    [2, "Fundaciones", "", "", "", 0],
    ["2.1", "Pilotes", "m", 10, 2000, 20000],
    ["", "", "", "", "", 0],
    ["PLANTA DE CONJUNTO - PLANTA BAJA", "", "", "", "", 0],
    [1, "SERVICIOS PRELIMINARES", "", "", "", 0],
    ["B.N.", "BLOQUES NUEVOS", "", "", "", 0],
    ["1.1", "Limpieza de terreno", "m²", 100, 50, 5000],
    [6, "ABERTURAS", "", "", "", 0],
    ["B.N.", "BLOQUES NUEVOS", "", "", "", 0],
    ["", "PUERTAS", "", "", "", 0],
    ["6.1", "Puerta placa", "un", 2, 1000, 2000],
    ["", "VENTANAS", "", "", "", 0],
    ["6.2", "Ventana aluminio", "un", 2, 1500, 3000],
    ["6.2", "Ventana aluminio grande", "un", 1, 2500, 2500],
    ["PLANTA DE CONJUNTO - PLANTA NIVEL 1", "", "", "", "", 0],
    [1, "SERVICIOS PRELIMINARES", "", "", "", 0],
    ["1.1", "Replanteo nivel 1", "m²", 10, 100, 1000],
    ["Área: 3) PCI - COMBATE", "", "", "", "", 0],
    ["", "Boca de Incendio Siamesa", "", "", "", 0],
    [1, "Boca siamesa", "un", 1, 3000, 3000],
    ["Rociadores", "", "", "", "", 0],
    [2, "Rociador pendiente", "un", 10, 100, 1000],
  ];

  it("arma la jerarquía por contexto y cuadra sin errores críticos", () => {
    const { build } = generatePreview(workbook({ name: "Hoja1", rows }));
    const byName = (name: string) => build.nodes.find((n) => n.name === name)!;

    expect(build.issues.filter((i) => i.type === "CRITICAL")).toHaveLength(0);
    expect(build.reconciliation.balanced).toBe(true);
    expect(build.reconciliation.itemsTotal).toBe(52500);
    expect(build.reconciliation.rubroChecks).toHaveLength(0); // títulos con total 0 no declaran subtotal

    // Áreas en nivel 0 con clave A{n}
    const areas = build.nodes.filter((n) => n.level === 0);
    expect(areas.map((n) => n.path)).toEqual(["A1", "A2", "A3"]);

    // Bloques del área (el título en la columna de código se toma como descripción)
    expect(byName("ESTRUCTURA DE HORMIGÓN ARMADO").parentPath).toBe("A2");
    expect(byName("PLANTA DE CONJUNTO - PLANTA BAJA").parentPath).toBe("A2");
    expect(byName("PLANTA DE CONJUNTO - PLANTA NIVEL 1").parentPath).toBe("A2");
    expect(byName("Rociadores").parentPath).toBe("A3");

    // Numeración que reinicia en cada bloque: claves distintas, sin duplicados falsos
    expect(byName("Pilotes").path).toBe("A2/ESTRUCTURA-DE-HORMIGON-ARMADO/2/2.1");
    expect(byName("Replanteo nivel 1").path).toBe("A2/PLANTA-DE-CONJUNTO-PLANTA-NIVEL-1/1/1.1");

    // Etiqueta B.N. bajo su capítulo, subtítulos bajo la etiqueta; B.N. repetido no se duplica
    const aberturas = byName("ABERTURAS");
    const bn = build.nodes.filter((n) => n.name === "BLOQUES NUEVOS" && n.parentPath === aberturas.path);
    expect(bn).toHaveLength(1);
    expect(byName("PUERTAS").parentPath).toBe(bn[0].path);
    expect(byName("VENTANAS").parentPath).toBe(bn[0].path);
    expect(byName("Ventana aluminio").parentPath).toBe(byName("VENTANAS").path);
  });

  it("advierte ítems con PU 0 y códigos realmente repetidos, sin bloquear", () => {
    const { build } = generatePreview(workbook({ name: "Hoja1", rows }));
    const warnings = build.issues.filter((i) => i.type === "WARNING");
    expect(warnings.some((i) => i.category === "MISSING_FIELD" && i.itemDescription === "Limpieza y desbroce")).toBe(true);
    expect(build.nodes.find((n) => n.name === "Limpieza y desbroce")!.amount).toBe(0);
    const dups = warnings.filter((i) => i.category === "DUPLICATE_CODE");
    expect(dups).toHaveLength(1);
    expect(dups[0].code).toBe("6.2");
  });

  it("toma el monto del contrato como informativo", () => {
    const { build } = generatePreview(workbook({ name: "Hoja1", rows }), { contractAmount: 99999 });
    expect(build.reconciliation.contractDifference).not.toBe(0);
    expect(build.reconciliation.balanced).toBe(true);
  });
});

// Regresión con la planilla real (no se versiona): BUDGET_FIXTURE=ruta/pruebacerterp.xlsx npx vitest run
const fixture = process.env.BUDGET_FIXTURE;
describe.skipIf(!fixture || !fs.existsSync(fixture))("planilla real (BUDGET_FIXTURE)", () => {
  it("importa pruebacerterp.xlsx con cuadre OK y sin errores críticos", () => {
    const { build } = generatePreview(extractFromBuffer(fs.readFileSync(fixture!), "pruebacerterp.xlsx"));
    expect(build.reconciliation.itemsTotal).toBe(29460942194);
    expect(build.reconciliation.balanced).toBe(true);
    expect(build.issues.filter((i) => i.type === "CRITICAL")).toHaveLength(0);
    expect(build.issues.filter((i) => i.category === "RECONCILIATION")).toHaveLength(0);
    expect(build.nodes.filter((n) => n.level === 0)).toHaveLength(24);
  });
});

describe("formato de la planilla", () => {
  it("combina un encabezado en dos filas con celdas combinadas", () => {
    const wb = workbook({
      name: "Obra",
      rows: [
        ["Item", "Descripción", "Unidad", "Cantidad", "PRECIO", ""],
        ["", "", "", "", "Unitario", "Total"],
        ["1", "Rubro"],
        ["1.1", "Contrapiso", "m2", 40, 35000, 1400000],
      ],
      merges: [{ s: { r: 0, c: 4 }, e: { r: 0, c: 5 } }],
    });
    const preview = generatePreview(wb);
    const sheet = preview.sheets[0];
    const role = (idx: number) => sheet.columns.find((c) => c.index === idx)?.detectedRole;
    expect(sheet.headerRowCount).toBe(2);
    expect(role(4)).toBe("unitPrice");
    expect(role(5)).toBe("totalPrice");
    expect(items(preview)[0].amount).toBe(1400000);
  });

  it("propaga descripciones combinadas en vertical y excluye filas ocultas", () => {
    const wb = workbook({
      name: "Obra",
      rows: [
        HEADER,
        ["1", "INSTALACIONES"],
        ["1.1", "Cañería 1/2", "m", 10, 8000, 80000],
        ["1.2", "Ítem viejo descartado", "m", 5, 1000, 5000],
        ["1.3", "Cañería 3/4", "m", 10, 9000, 90000],
      ],
      hiddenRows: [3],
    });
    const hidden = generatePreview(wb);
    expect(items(hidden).map((n) => n.name)).not.toContain("Ítem viejo descartado");
    expect(hidden.build.reconciliation.itemsTotal).toBe(170000);

    const withHidden = generatePreview(wb, { includeHidden: true });
    expect(withHidden.build.reconciliation.itemsTotal).toBe(175000);
  });
});

describe("recargos", () => {
  const rows = [
    HEADER,
    ["1", "RUBRO ÚNICO"],
    ["1.1", "Trabajo A", "gl", 1, 600000, 600000],
    ["1.2", "Trabajo B", "gl", 1, 400000, 400000],
    ["", "Gastos generales y beneficio 15%", "", "", "", ""],
    ["", "IVA 10%", "", "", "", ""],
    ["", "TOTAL GENERAL", "", "", "", 1265000],
  ];

  it("calcula los recargos acumulados y cuadra contra el total de la planilla", () => {
    const { build } = generatePreview(workbook({ name: "Obra", rows }));
    const rec = build.reconciliation;
    expect(rec.itemsTotal).toBe(1000000);
    expect(rec.surcharges.map((s) => s.amount)).toEqual([150000, 115000]);
    expect(rec.sheetComputedTotal).toBe(1265000);
    expect(rec.balanced).toBe(true);
    // GG se prorratea en los ítems e IVA se ignora por defecto
    expect(rec.budgetTotal).toBe(1150000);
    expect(build.nodes.find((n) => n.name === "Trabajo A")!.amount).toBe(690000);
  });

  it("permite cargar un recargo como partida propia", () => {
    const preview = generatePreview(workbook({ name: "Obra", rows }));
    const iva = preview.build.reconciliation.surcharges.find((s) => s.description.startsWith("IVA"))!;
    const rebuilt = buildBudgetTree(preview.rows, {
      surchargeTreatments: { ...preview.surchargeTreatments, [iva.rowId]: "AS_ITEM" },
    });
    expect(rebuilt.reconciliation.budgetTotal).toBe(1265000);
    expect(rebuilt.nodes.some((n) => n.fromSurcharge && n.amount === 115000)).toBe(true);
  });
});

describe("varias hojas y corrección manual", () => {
  const block = (name: string) => ({
    name,
    rows: [HEADER, ["1", "FUNDACIONES"], ["1.1", "Excavación", "m3", 10, 50000, 500000]],
  });

  it("no selecciona la hoja de resumen y separa cada hoja en su propio rubro", () => {
    const wb = workbook({ name: "Resumen", rows: [["Resumen"], ["Total", 1000000]] }, block("Bloque A"), block("Bloque B"));
    const single = generatePreview(wb);
    expect(single.selectedSheets).not.toContain("Resumen");

    const multi = generatePreview(wb, { selectedSheets: ["Bloque A", "Bloque B"] });
    const excavaciones = items(multi).filter((n) => n.name === "Excavación");
    expect(excavaciones).toHaveLength(2);
    expect(new Set(excavaciones.map((n) => n.path)).size).toBe(2);
    expect(multi.build.reconciliation.itemsTotal).toBe(1000000);
    expect(multi.build.issues.filter((i) => i.type === "CRITICAL")).toHaveLength(0);
  });

  it("recalcula el árbol cuando el usuario reclasifica una fila", () => {
    const preview = generatePreview(workbook(block("Obra")));
    const rows = preview.rows.map((r) => (r.description === "Excavación" ? { ...r, kind: "IGNORAR" as const } : r));
    const rebuilt = buildBudgetTree(rows);
    expect(rebuilt.counts.items).toBe(0);
    expect(rebuilt.issues.some((i) => i.type === "CRITICAL")).toBe(true);
  });
});
