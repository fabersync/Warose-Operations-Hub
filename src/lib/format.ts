export const TZ = "Europe/Bucharest";

const ron = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", maximumFractionDigits: 0 });
const ron2 = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 });

export const fmtRon = (v: number | null | undefined, decimals = false) => (v == null ? "—" : (decimals ? ron2 : ron).format(Number(v)));
export const fmtNum = (v: number | null | undefined) => (v == null ? "—" : num.format(Number(v)));
export const fmtPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${num.format(Math.round(v * 10) / 10)}%`;

export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** Data de azi (YYYY-MM-DD) în fusul orar al firmei. */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;
}

export function monthStart(iso: string) {
  return iso.slice(0, 8) + "01";
}

export function fmtDate(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v.length === 10 ? v + "T12:00:00Z" : v) : v;
  return new Intl.DateTimeFormat("ro-RO", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }).format(d);
}

export function fmtDateTime(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return new Intl.DateTimeFormat("ro-RO", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

/** Pentru timestamp fără fus orar (ora locală Publine), afișat ca atare. */
export function fmtLocalTs(v: string | Date | null | undefined) {
  if (!v) return "—";
  const s = typeof v === "string" ? v : localIso(v);
  const [d, t] = s.replace("T", " ").split(" ");
  return `${fmtDate(d)}, ${t?.slice(0, 5) ?? ""}`;
}

function localIso(d: Date) {
  // PGlite / postgres-js întorc `timestamp` (fără fus) ca Date interpretat UTC.
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export function relativeTime(v: string | Date | null | undefined) {
  if (!v) return "niciodată";
  const ms = Date.now() - new Date(v).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "acum";
  if (min < 60) return `acum ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `acum ${h} h`;
  const d = Math.round(h / 24);
  return `acum ${d} ${d === 1 ? "zi" : "zile"}`;
}
