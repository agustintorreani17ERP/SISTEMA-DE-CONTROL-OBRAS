/**
 * Control de combustible por equipo (puro). Método de tanque lleno: los litros de una carga
 * reponen lo consumido desde la carga anterior. Horas del intervalo = diferencia de horómetro;
 * sin horómetro, las horas del parte diario entre las dos cargas.
 * Consumo real (L/h) vs teórico del equipo: ALERTA si supera la tolerancia, REVISAR si queda
 * por debajo (horas infladas o carga no registrada).
 */

export interface CargaInput {
  id: number;
  fecha: string; // AAAA-MM-DD
  equipoId: number;
  litros: number;
  horometro: number | null;
}

export interface HorasParteInput {
  equipoId: number;
  fecha: string;
  horas: number;
}

export interface EquipoFuelInput {
  id: number;
  consumoLh: number | null;
  toleranciaPct: number;
}

export type EstadoCombustible = "PRIMERA" | "OK" | "ALERTA" | "REVISAR" | "SIN_HORAS" | "SIN_TEORICO" | "HOROMETRO_INVALIDO";

export interface CargaAnalisis {
  id: number;
  equipoId: number;
  fecha: string;
  litros: number;
  horometro: number | null;
  desdeFecha: string | null;
  horasHorometro: number | null;
  horasParte: number;
  horasUsadas: number | null;
  fuenteHoras: "HOROMETRO" | "PARTE" | null;
  consumoReal: number | null;
  consumoTeorico: number | null;
  desvioPct: number | null;
  estado: EstadoCombustible;
  /** Horas del parte que no coinciden con el horómetro (fuera de tolerancia). */
  alertaHoras: boolean;
}

export interface EquipoResumen {
  equipoId: number;
  litros: number;
  horas: number;
  consumoReal: number | null;
  consumoTeorico: number | null;
  desvioPct: number | null;
  estado: EstadoCombustible;
  alertas: number;
}

/** Tolerancia por defecto si el equipo no tiene una cargada (%). */
export const TOLERANCIA_COMBUSTIBLE_DEFAULT = 15;

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

function estadoDe(desvio: number | null, tol: number): EstadoCombustible {
  if (desvio === null) return "SIN_TEORICO";
  if (desvio > tol / 100) return "ALERTA";
  if (desvio < -tol / 100) return "REVISAR";
  return "OK";
}

export function analizarCombustible(cargas: CargaInput[], horas: HorasParteInput[], equipos: EquipoFuelInput[]): { cargas: CargaAnalisis[]; equipos: EquipoResumen[] } {
  const eqMap = new Map(equipos.map((e) => [e.id, e]));
  const porEquipo = new Map<number, CargaInput[]>();
  for (const c of cargas) {
    if (!porEquipo.has(c.equipoId)) porEquipo.set(c.equipoId, []);
    porEquipo.get(c.equipoId)!.push(c);
  }
  const out: CargaAnalisis[] = [];
  const resumen: EquipoResumen[] = [];

  for (const [equipoId, lista] of porEquipo) {
    lista.sort((a, b) => (a.fecha === b.fecha ? a.id - b.id : a.fecha < b.fecha ? -1 : 1));
    const eq = eqMap.get(equipoId);
    const teo = eq?.consumoLh && eq.consumoLh > 0 ? eq.consumoLh : null;
    const tol = eq && eq.toleranciaPct > 0 ? eq.toleranciaPct : TOLERANCIA_COMBUSTIBLE_DEFAULT;
    const hsEq = horas.filter((h) => h.equipoId === equipoId);
    let sumL = 0;
    let sumH = 0;
    let alertas = 0;

    lista.forEach((c, i) => {
      const prev = i > 0 ? lista[i - 1] : null;
      const base: CargaAnalisis = {
        id: c.id,
        equipoId,
        fecha: c.fecha,
        litros: c.litros,
        horometro: c.horometro,
        desdeFecha: prev?.fecha ?? null,
        horasHorometro: null,
        horasParte: 0,
        horasUsadas: null,
        fuenteHoras: null,
        consumoReal: null,
        consumoTeorico: teo,
        desvioPct: null,
        estado: "PRIMERA",
        alertaHoras: false,
      };
      if (!prev) {
        out.push(base);
        return;
      }
      // Horas del parte en (carga anterior, esta carga]; el mismo día cuenta en la carga posterior
      const horasParte = round(
        hsEq.filter((h) => h.fecha > prev.fecha && h.fecha <= c.fecha).reduce((s, h) => s + h.horas, 0),
        2
      );
      base.horasParte = horasParte;
      if (c.horometro !== null && prev.horometro !== null) {
        const d = round(c.horometro - prev.horometro, 1);
        if (d < 0) {
          out.push({ ...base, horasHorometro: d, estado: "HOROMETRO_INVALIDO" });
          alertas++;
          return;
        }
        base.horasHorometro = d;
        base.horasUsadas = d;
        base.fuenteHoras = "HOROMETRO";
        if (horasParte > 0 && d > 0 && Math.abs(horasParte / d - 1) > tol / 100) base.alertaHoras = true;
      } else if (horasParte > 0) {
        base.horasUsadas = horasParte;
        base.fuenteHoras = "PARTE";
      }
      if (!base.horasUsadas) {
        out.push({ ...base, estado: "SIN_HORAS" });
        return;
      }
      const real = round(c.litros / base.horasUsadas);
      const desvio = teo ? round(real / teo - 1, 4) : null;
      const estado = estadoDe(desvio, tol);
      if (estado === "ALERTA" || estado === "REVISAR" || base.alertaHoras) alertas++;
      sumL += c.litros;
      sumH += base.horasUsadas;
      out.push({ ...base, consumoReal: real, desvioPct: desvio, estado });
    });

    const real = sumH > 0 ? round(sumL / sumH) : null;
    const desvio = real !== null && teo ? round(real / teo - 1, 4) : null;
    resumen.push({
      equipoId,
      litros: round(lista.reduce((s, c) => s + c.litros, 0), 2),
      horas: round(sumH, 2),
      consumoReal: real,
      consumoTeorico: teo,
      desvioPct: desvio,
      estado: real === null ? "SIN_HORAS" : estadoDe(desvio, tol),
      alertas,
    });
  }
  out.sort((a, b) => (a.fecha === b.fecha ? b.id - a.id : a.fecha < b.fecha ? 1 : -1));
  return { cargas: out, equipos: resumen };
}
