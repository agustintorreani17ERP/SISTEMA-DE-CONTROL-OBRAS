// Utility to convert numbers to Spanish currency words for legal invoices in Paraguay

const UNIDADES = [
  "",
  "UN",
  "DOS",
  "TRES",
  "CUATRO",
  "CINCO",
  "SEIS",
  "SIETE",
  "OCHO",
  "NUEVE",
];

const DECENAS_10_19 = [
  "DIEZ",
  "ONCE",
  "DOCE",
  "TRECE",
  "CATORCE",
  "QUINCE",
  "DIECISEIS",
  "DIECISIETE",
  "DIECIOCHO",
  "DIECINUEVE",
];

const DECENAS = [
  "",
  "DIEZ",
  "VEINTE",
  "TREINTA",
  "CUARENTA",
  "CINCUENTA",
  "SESENTA",
  "SETENTA",
  "OCHENTA",
  "NOVENTA",
];

const CENTENAS = [
  "",
  "CIENTO",
  "DOSCIENTOS",
  "TRESCIENTOS",
  "CUATROCIENTOS",
  "QUINIENTOS",
  "SEISCIENTOS",
  "SETECIENTOS",
  "OCHOCIENTOS",
  "NOVECIENTOS",
];

function leerMenorA1000(num: number): string {
  if (num === 0) return "";
  if (num === 100) return "CIEN";

  const c = Math.floor(num / 100);
  const d = Math.floor((num % 100) / 10);
  const u = num % 10;

  const centenaStr = CENTENAS[c];
  let decenaStr = "";

  if (d === 1) {
    decenaStr = DECENAS_10_19[u];
    return `${centenaStr} ${decenaStr}`.trim();
  } else if (d === 2 && u > 0) {
    decenaStr = `VEINTI${UNIDADES[u]}`;
    return `${centenaStr} ${decenaStr}`.trim();
  } else if (d > 0) {
    decenaStr = DECENAS[d];
    if (u > 0) {
      decenaStr += ` Y ${UNIDADES[u]}`;
    }
  } else if (u > 0) {
    decenaStr = UNIDADES[u];
  }

  return `${centenaStr} ${decenaStr}`.trim();
}

export function numeroALetrasGuaranies(monto: number): string {
  if (monto === 0) return "CERO GUARANÍES";
  const num = Math.floor(Math.abs(monto));

  if (num === 0) return "CERO GUARANÍES";

  const millones = Math.floor(num / 1000000);
  const miles = Math.floor((num % 1000000) / 1000);
  const resto = num % 1000;

  const partes: string[] = [];

  if (millones > 0) {
    if (millones === 1) {
      partes.push("UN MILLÓN");
    } else {
      partes.push(`${leerMenorA1000(millones)} MILLONES`);
    }
  }

  if (miles > 0) {
    if (miles === 1) {
      partes.push("MIL");
    } else {
      partes.push(`${leerMenorA1000(miles)} MIL`);
    }
  }

  if (resto > 0) {
    partes.push(leerMenorA1000(resto));
  }

  return `${partes.join(" ")} GUARANÍES`.trim();
}
