import * as XLSX from "xlsx";
import { getUser, canAccess } from "@/lib/auth";
import { q } from "@/lib/db";
import { audit } from "@/lib/audit";
import { costMonth, getSetting } from "@/lib/invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTHS = ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"];
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Exportul lunar în structura „Raport Costuri – Venituri” folosită pentru planul de business:
 * sumar pe locații (venituri, cheltuieli, rezultat, RON și EUR) și, alături, lista cheltuielilor fiecărei locații
 * (Data, Tip Costuri, RON, EUR, Furnizor, Comentariu).
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || !canAccess(user, "invoices")) return new Response("Neautorizat", { status: 401 });
  const month = new URL(req.url).searchParams.get("m") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response("Lună invalidă", { status: 400 });
  const [data, locations, categories, eur] = await Promise.all([
    costMonth(month),
    q<{ id: number; name: string }>("SELECT id, name FROM locations WHERE active AND kind <> 'freezer' ORDER BY kind = 'store', id"),
    q<{ id: number; name: string }>("SELECT id, name FROM expense_categories ORDER BY sort, name"),
    getSetting<number>("eur_rate", 5),
  ]);
  const title = `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  const rev = (l: number) => data.revenue.find((x) => x.location_id === l)?.amount ?? 0;
  const cost = (l: number) => data.cells.filter((c) => c.location_id === l).reduce((s, c) => s + c.amount, 0);

  const aoa: (string | number | null)[][] = [];
  aoa.push([title, "Venituri RON", "Venituri EUR", "Cheltuieli RON", "Cheltuieli EUR", "Rezultat (RON)", "Rezultat (€)"]);
  for (const l of locations) {
    aoa.push([l.name, r2(rev(l.id)), r2(rev(l.id) / eur), r2(cost(l.id)), r2(cost(l.id) / eur), r2(rev(l.id) - cost(l.id)), r2((rev(l.id) - cost(l.id)) / eur)]);
  }
  const tr = data.revenue.reduce((s, r) => s + r.amount, 0);
  const tc = data.cells.reduce((s, c) => s + c.amount, 0);
  aoa.push(["Total", r2(tr), r2(tr / eur), r2(tc), r2(tc / eur), r2(tr - tc), r2((tr - tc) / eur)]);
  aoa.push([]);
  aoa.push(["Cheltuieli pe categorii (RON)", ...locations.map((l) => l.name), "Total"]);
  for (const c of categories) {
    const vals = locations.map((l) => data.cells.find((x) => x.location_id === l.id && x.category_id === c.id)?.amount ?? 0);
    if (vals.some((v) => v)) aoa.push([c.name, ...vals.map(r2), r2(vals.reduce((s, v) => s + v, 0))]);
  }
  aoa.push([]);
  const start = aoa.length;
  // Blocurile de detaliu, unul lângă altul, ca în raportul existent.
  const blocks = locations.map((l) => data.entries.filter((e) => e.location_id === l.id));
  const width = 8;
  const header: (string | null)[] = [];
  const subheader: (string | null)[] = [];
  locations.forEach((l) => {
    header.push(l.name, null, null, null, null, null, null, null);
    subheader.push(l.name, "Data", "Tip Costuri", "RON", "EUR", "Furnizor", "Comentariu", null);
  });
  aoa.push(header, subheader);
  const rows = Math.max(0, ...blocks.map((b) => b.length));
  for (let i = 0; i < rows; i++) {
    const row: (string | number | null)[] = [];
    blocks.forEach((b, j) => {
      const e = b[i];
      if (e) row.push(locations[j].name, e.entry_date, e.category, r2(e.amount_net), r2(e.amount_net / eur), e.supplier ?? "", e.description ?? "", null);
      else row.push(...Array(width).fill(null));
    });
    aoa.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = Array.from({ length: Math.max(8, locations.length * width) }, (_, i) => ({ wch: i % width === 6 ? 34 : i % width === 5 ? 22 : 14 }));
  ws["!freeze"] = { xSplit: 0, ySplit: start + 2 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  await audit({ userId: user.id, action: "export.costs", details: { month } });
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Raport_Costuri_Venituri_${month}.xlsx"`,
    },
  });
}
