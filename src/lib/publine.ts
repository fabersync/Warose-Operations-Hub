import "server-only";
import * as XLSX from "xlsx";
import { readBiff8 } from "./biff";

/**
 * Parser pentru exportul Publine „Situație comenzi” (.xls / .xlsx / .csv).
 * Structura a fost verificată pe exporturile reale din ianuarie și februarie 2026:
 * coloanele sunt găsite după denumirea din antet, nu după poziție, deoarece exportul
 * conține în stânga un bloc de sumar care poate muta tabelul.
 */

export interface PublineLine {
  rowNo: number;
  soldAt: string; // "YYYY-MM-DD HH:MM:SS", ora locală
  receiptNo: string | null;
  invoiceNo: string | null;
  tableName: string | null;
  gestiune: string;
  itemType: string | null;
  code: string | null;
  name: string;
  qty: number;
  unit: string | null;
  unitPrice: number | null;
  net: number;
  vat: number;
  gross: number;
  vatRate: number | null;
  priceWithVat: number | null;
  client: string | null;
  paymentMethod: string | null;
}

export interface ParseResult {
  lines: PublineLine[];
  errors: { rowNo: number; message: string; raw: unknown }[];
}

const COLS = {
  date: ["data"],
  receipt: ["nr. com.", "nr com", "nr. comanda"],
  invoice: ["nr. factura", "nr factura"],
  table: ["masa"],
  gestiune: ["gestiune"],
  type: ["tip"],
  code: ["cod"],
  name: ["articol", "denumire"],
  qty: ["cantitate"],
  unit: ["um"],
  price: ["pret"],
  net: ["valoare"],
  vat: ["tva"],
  gross: ["total"],
  client: ["client"],
  vatRate: ["tva2", "cota tva"],
  priceWithVat: ["pret_tva"],
  payment: ["metode_incasare"],
} as const;
type ColKey = keyof typeof COLS;
const REQUIRED: ColKey[] = ["date", "name", "qty", "net", "vat", "gross"];

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Exporturile .xls (BIFF8) se citesc cu cititorul propriu, care are nevoie de puțină memorie (un export pe
 * 5 luni depășea cu SheetJS memoria serverului și îl oprea). .xlsx / .csv / alte formate: SheetJS, doar valori.
 */
function* readSheets(buffer: Buffer): Generator<{ rows: unknown[][] }> {
  const biff = readBiff8(buffer);
  if (biff) { for (const s of biff) yield s; return; }
  const wb = XLSX.read(buffer, { type: "buffer", dense: true, cellDates: false, cellText: false, cellHTML: false, cellNF: false, cellStyles: false, cellFormula: false });
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    delete wb.Sheets[name];
    yield { rows };
  }
}

export function parsePublineSales(buffer: Buffer): ParseResult {
  const result: ParseResult = { lines: [], errors: [] };
  let found = false;
  // Toate foile cu antet: un export lung poate fi împărțit pe mai multe foi (.xls are maximum 65.536 de rânduri pe foaie).
  for (const { rows } of readSheets(buffer)) {
    const headerIdx = rows.findIndex((r) => {
      const cells = (r ?? []).map(norm);
      return cells.includes("articol") && cells.includes("cantitate") && cells.includes("valoare");
    });
    if (headerIdx === -1) continue;
    const header = rows[headerIdx].map(norm);
    const col: Partial<Record<ColKey, number>> = {};
    for (const key of Object.keys(COLS) as ColKey[]) {
      const idx = header.findIndex((h) => (COLS[key] as readonly string[]).includes(h));
      if (idx >= 0) col[key] = idx;
    }
    const missing = REQUIRED.filter((k) => col[k] === undefined);
    if (missing.length) throw new Error(`Exportul nu conține coloanele obligatorii: ${missing.join(", ")}`);
    const part = parseRows(rows, headerIdx, col);
    for (const l of part.lines) result.lines.push(l);
    for (const e of part.errors) result.errors.push(e);
    found = true;
  }
  if (found) return result;
  throw new Error("Fișierul nu pare a fi un export Publine „Situație comenzi” (nu am găsit antetul cu Articol / Cantitate / Valoare).");
}

function parseRows(rows: unknown[][], headerIdx: number, col: Partial<Record<ColKey, number>>): ParseResult {
  const lines: PublineLine[] = [];
  const errors: ParseResult["errors"] = [];
  const get = (r: unknown[], k: ColKey) => (col[k] === undefined ? null : r[col[k]!]);
  const str = (v: unknown) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v;
    const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  const codeStr = (v: unknown) => {
    const s = str(v);
    if (s === null) return null;
    return /^\d+(\.0+)?$/.test(s) ? s.replace(/\.0+$/, "").padStart(8, "0") : s;
  };

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const rowNo = i + 1;
    const rawDate = get(r, "date");
    const name = str(get(r, "name"));
    if (rawDate === null && name === null) continue; // rând gol
    const soldAt = toLocalDateTime(rawDate);
    const qty = num(get(r, "qty"));
    const net = num(get(r, "net"));
    const vat = num(get(r, "vat"));
    const gross = num(get(r, "gross"));
    if (!soldAt || !name || qty === null || net === null || vat === null || gross === null) {
      errors.push({ rowNo, message: "Rând incomplet sau cu valori nenumerice (dată, articol, cantitate, valoare, TVA, total).", raw: r });
      continue;
    }
    lines.push({
      rowNo,
      soldAt,
      receiptNo: str(num(get(r, "receipt")) ?? get(r, "receipt")),
      invoiceNo: str(num(get(r, "invoice")) ?? get(r, "invoice")),
      tableName: str(get(r, "table")),
      gestiune: (str(get(r, "gestiune")) ?? "").toUpperCase().replace(/\s+/g, " "),
      itemType: str(get(r, "type")),
      code: codeStr(get(r, "code")),
      name: name.replace(/\s+/g, " "),
      qty,
      unit: str(get(r, "unit")),
      unitPrice: num(get(r, "price")),
      net,
      vat,
      gross,
      vatRate: num(get(r, "vatRate")),
      priceWithVat: num(get(r, "priceWithVat")),
      client: str(get(r, "client")),
      paymentMethod: str(get(r, "payment")),
    });
  }
  return { lines, errors };
}

/** Excel serial (1900) sau text „dd.mm.yyyy hh:mm:ss” → „YYYY-MM-DD HH:MM:SS”. */
export function toLocalDateTime(v: unknown): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    let days = Math.floor(v);
    let secs = Math.round((v - days) * 86400);
    if (secs >= 86400) { days += 1; secs -= 86400; }
    const d = new Date(Date.UTC(1899, 11, 30) + days * 86400000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(Math.floor(secs / 3600))}:${p(Math.floor((secs % 3600) / 60))}:${p(secs % 60)}`;
  }
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      const p = (s: string | undefined) => String(Number(s ?? 0)).padStart(2, "0");
      return `${m[3]}-${p(m[2])}-${p(m[1])} ${p(m[4])}:${p(m[5])}:${p(m[6])}`;
    }
    const iso = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}:${iso[6] ?? "00"}`;
  }
  return null;
}
