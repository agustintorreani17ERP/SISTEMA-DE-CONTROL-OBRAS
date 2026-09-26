import React, { useEffect, useState } from "react";

// Utilidades de planilla tipo Excel: navegación con Tab/Enter/flechas y pegado desde Excel.

export const focusCell = (grid: string, r: number, c: number): boolean => {
  const el = document.querySelector<HTMLInputElement>(
    `[data-grid="${grid}"][data-r="${r}"][data-c="${c}"]`
  );
  if (!el) return false;
  el.focus();
  if (typeof el.select === "function") el.select();
  return true;
};

const MAX_COLS = 12;

export const gridKeyDown = (e: React.KeyboardEvent<HTMLElement>, maxRows: number) => {
  const el = e.currentTarget as HTMLInputElement;
  const grid = el.dataset.grid;
  const r = Number(el.dataset.r);
  const c = Number(el.dataset.c);
  if (!grid || Number.isNaN(r) || Number.isNaN(c)) return;

  const len = el.value?.length ?? 0;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? len;
  let dr = 0;
  let dc = 0;
  switch (e.key) {
    case "Enter":
    case "ArrowDown":
      dr = e.key === "Enter" && e.shiftKey ? -1 : 1;
      break;
    case "ArrowUp":
      dr = -1;
      break;
    case "ArrowRight":
      if (end < len) return;
      dc = 1;
      break;
    case "ArrowLeft":
      if (start > 0) return;
      dc = -1;
      break;
    case "Tab":
      dc = e.shiftKey ? -1 : 1;
      break;
    default:
      return;
  }

  if (dr !== 0) {
    for (let nr = r + dr; nr >= 0 && nr < maxRows; nr += dr) {
      if (focusCell(grid, nr, c)) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Enter") e.preventDefault();
    return;
  }

  // Movimiento horizontal: busca la siguiente celda editable; Tab salta de fila
  let nr = r;
  let nc = c;
  for (let i = 0; i < MAX_COLS * 2; i++) {
    nc += dc;
    if (nc < 0 || nc >= MAX_COLS) {
      if (e.key !== "Tab") return;
      nr += dc;
      if (nr < 0 || nr >= maxRows) return;
      nc = dc > 0 ? -1 : MAX_COLS;
      continue;
    }
    if (focusCell(grid, nr, nc)) {
      e.preventDefault();
      return;
    }
  }
};

// Devuelve la matriz pegada si el portapapeles trae varias celdas (tabulaciones / saltos de línea)
export const readPastedMatrix = (e: React.ClipboardEvent): string[][] | null => {
  const text = e.clipboardData.getData("text/plain");
  if (!text || (!text.includes("\t") && !text.includes("\n"))) return null;
  const lines = text.replace(/\r/g, "").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.map((l) => l.split("\t"));
};

// Acepta "1.234,56", "1234,56", "1234.56"
export const parseNum = (raw: string): number => {
  let s = String(raw ?? "").replace(/\s/g, "").replace(/[^\d.,-]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

interface NumCellProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: number;
  onValue: (n: number) => void;
}

// Celda numérica con borrador de texto (permite escribir coma decimal sin perder foco)
export const NumCell: React.FC<NumCellProps> = ({ value, onValue, onFocus, onBlur, ...rest }) => {
  const [text, setText] = useState<string>(value ? String(value) : "");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(value ? String(value) : "");
  }, [value, editing]);

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onFocus={(e) => {
        setEditing(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setEditing(false);
        onBlur?.(e);
      }}
      onChange={(e) => {
        setText(e.target.value);
        onValue(parseNum(e.target.value));
      }}
    />
  );
};

export const cellInputCls =
  "w-full h-full bg-transparent px-2 py-1.5 outline-hidden focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 disabled:cursor-not-allowed";
