import "server-only";
import * as XLSX from "xlsx";

/**
 * Foi Excel lizibile: lățimea coloanelor după conținut, filtre pe antet, formate de număr
 * (lei cu 2 zecimale, cantități, procente) recunoscute după numele coloanei.
 */
type Row = Record<string, unknown>;

const MONEY = /(lei|valoare|net|brut|tva|total|cost|pre[țt]|rezultat|venit|cheltuieli|marj[aă] \(lei\)|bon mediu|sum[aă])/i;
const PCT = /(%|procent|pondere|evolu[țt]ie)/i;
const QTY = /(cantitate|cant\.|bonuri|linii|nr\.|zile|stoc|minim|[țt]int[aă]|necesar|de comandat)/i;

export function sheet(rows: Row[], empty = "Nicio înregistrare în perioada aleasă"): XLSX.WorkSheet {
  const data = rows.length ? rows : [{ "": empty }];
  const ws = XLSX.utils.json_to_sheet(data);
  const headers = Object.keys(data[0]);
  ws["!cols"] = headers.map((h) => {
    let w = h.length;
    for (let i = 0; i < Math.min(data.length, 400); i++) { const v = data[i][h]; const len = v == null ? 0 : typeof v === "number" ? 12 : String(v).length; if (len > w) w = len; }
    return { wch: Math.min(Math.max(w + 2, 8), 48) };
  });
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  headers.forEach((h, c) => {
    const z = PCT.test(h) ? '0.0"%"' : MONEY.test(h) ? "#,##0.00" : QTY.test(h) ? "#,##0.###" : null;
    if (!z) return;
    for (let r = 1; r <= range.e.r; r++) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.t === "n") cell.z = z; }
  });
  if (rows.length) ws["!autofilter"] = { ref: ws["!ref"]! };
  return ws;
}

/** Foaie de tip tabel cu antet pe rânduri (cheie / valoare), pentru sumar. */
export function summarySheet(aoa: (string | number | null)[][], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let r = 0; r <= range.e.r; r++) for (let c = 1; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (cell && cell.t === "n") cell.z = String(aoa[r]?.[0] ?? "").includes("%") ? '0.0"%"' : "#,##0.00";
  }
  return ws;
}

export function book(sheets: [string, XLSX.WorkSheet][]) {
  const wb = XLSX.utils.book_new();
  for (const [name, ws] of sheets) XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  return wb;
}

export function xlsxResponse(wb: XLSX.WorkBook, fileName: string) {
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}

export const r2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);
