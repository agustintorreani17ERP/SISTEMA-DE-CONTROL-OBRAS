import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve, dirname, sep } from "path";
import { describe, expect, it } from "vitest";

/**
 * Límites entre motores (ver docs/system/erp-ecms-bridge): ERP y ECMS no se importan entre sí.
 * Lo que cruza pasa por src/bridge (ledger.ts, finance.ts y los servicios de bridge/domain).
 *  - erp  → puede importar erp, core y bridge
 *  - ecms → puede importar ecms, core y bridge
 * *  - core → no importa de erp, ecms ni bridge
 *  - bridge → puede importar de todos
 */
const SRC = resolve(__dirname, "../..");
const ENGINES = ["core", "ecms", "erp", "bridge"] as const;
type Engine = (typeof ENGINES)[number];
const PERMITIDO: Record<string, Engine[]> = {
  erp: ["erp", "core", "bridge"],
  ecms: ["ecms", "core", "bridge"],
  core: ["core"],
  bridge: ["core", "ecms", "erp", "bridge"],
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.tsx?$/.test(n) && !p.includes(`${sep}__tests__${sep}`) ? [p] : [];
  });
}

function motorDe(absPath: string): string | null {
  const first = relative(SRC, absPath).split(sep)[0];
  return (ENGINES as readonly string[]).includes(first) ? first : null;
}

function violaciones(): string[] {
  const out: string[] = [];
  for (const file of ENGINES.flatMap((e) => archivos(join(SRC, e)))) {
    const motor = motorDe(file)!;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/from\s+["'](\.{1,2}\/[^"']*)["']/g)) {
      const destino = motorDe(resolve(dirname(file), m[1]));
      if (destino && !PERMITIDO[motor].includes(destino as Engine)) {
        out.push(`${relative(SRC, file).split(sep).join("/")} → ${m[1]}`);
      }
    }
  }
  return out;
}

describe("límites entre motores", () => {
  it("ERP y ECMS no se importan directamente: los cruces pasan por src/bridge", () => {
    expect(violaciones()).toEqual([]);
  });
});
