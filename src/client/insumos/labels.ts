import { InsumoCategoria, InsumoTipo } from "../types";
import { localIso } from "../../domain/localDate";

export const TIPO_LABEL: Record<InsumoTipo, string> = { DIRECTO: "Directo", COMUN: "Común", TIEMPO: "Tiempo" };
export const CATEGORIA_LABEL: Record<InsumoCategoria, string> = {
  MATERIAL: "Material",
  MANO_OBRA: "Mano de obra",
  EQUIPO: "Equipo",
};
export const SECTOR_LABEL: Record<string, string> = { PLANTA_BAJA: "Planta baja", PLANTA_ALTA: "Planta alta" };

/** Hoy en hora de Paraguay (America/Asuncion), sin depender del huso de la computadora. */
export const todayIso = () => localIso();
export const fmtDate = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
