import { getUser, canAccess } from "@/lib/auth";
import { q } from "@/lib/db";
import { audit } from "@/lib/audit";
import { listUses, USE_KINDS } from "@/lib/internal";
import { paymentMix, salesWhere } from "@/lib/queries";
import { salesByCategory, salesByHour, salesByWeekday, scopeIds } from "@/lib/overview";
import { book, r2, sheet, summarySheet, xlsxResponse } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEKDAYS = ["Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"];

/**
 * Exportul complet într-un singur Excel, pe perioadă și locație: sumar pe locații (vânzări, costuri, pierderi,
 * consum, rezultat estimat), vânzări pe zile / produse / ore / categorii / plăți, facturi și costuri,
 * pierderi și consum, stocul curent și toate liniile de vânzare.
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || !canAccess(user, "exports")) return new Response("Neautorizat", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest" }).format(new Date());
  let from = isDate(sp.get("from")) ? sp.get("from")! : `${today.slice(0, 7)}-01`;
  let to = isDate(sp.get("to")) ? sp.get("to")! : today;
  if (from > to) [from, to] = [to, from];
  const locationId = Number(sp.get("loc")) || null;
  if (locationId && user.locationIds !== null && !user.locationIds.includes(locationId)) return new Response("Neautorizat", { status: 401 });
  const ids = scopeIds(user, locationId);
  const costsAllowed = canAccess(user, "invoices") || canAccess(user, "profitability");
  const f = { from, to, locationId };
  const { where, params } = salesWhere(user, f);
  const locArr = ids ?? (await q<{ id: number }>("SELECT id FROM locations")).map((l) => l.id);

  const locations = await q<{ id: number; name: string; kind: string }>(
    "SELECT id, name, kind FROM locations WHERE active AND kind <> 'freezer' AND id = ANY($1::int[]) ORDER BY kind = 'production', id", [locArr]);

  const [salesLoc, daily, products, hours, weekdays, cats, mix, costs, uses, invoices, stock, lines] = await Promise.all([
    q<{ location_id: number; net: number; vat: number; gross: number; receipts: number; days: number; qty: number }>(
      `SELECT location_id, sum(net)::float8 net, sum(vat)::float8 vat, sum(gross)::float8 gross, count(DISTINCT (sold_date, receipt_no))::int receipts,
              count(DISTINCT sold_date)::int days, sum(qty)::float8 qty
         FROM sales_lines s WHERE ${where} GROUP BY 1`, params),
    q<{ day: string; location_id: number; net: number; receipts: number }>(
      `SELECT sold_date::text AS day, location_id, sum(net)::float8 net, count(DISTINCT receipt_no)::int receipts FROM sales_lines s WHERE ${where} GROUP BY 1, 2 ORDER BY 1`, params),
    q<{ name: string; code: string | null; category: string | null; location_id: number; qty: number; net: number; gross: number; unit_cost: number | null }>(
      `WITH rc AS (
         SELECT r.product_id, CASE WHEN bool_and(ip.cost_price IS NOT NULL) THEN sum(i.qty * ip.cost_price) / max(r.yield_qty) END unit_cost
           FROM recipes r JOIN recipe_items i ON i.recipe_id = r.id JOIN products ip ON ip.id = i.ingredient_id
          WHERE r.active GROUP BY r.product_id)
       SELECT coalesce(p.name, s.product_name) name, max(s.source_code) code, max(s.item_type) category, s.location_id,
              sum(s.qty)::float8 qty, sum(s.net)::float8 net, sum(s.gross)::float8 gross, max(rc.unit_cost)::float8 unit_cost
         FROM sales_lines s LEFT JOIN products p ON p.id = s.product_id LEFT JOIN rc ON rc.product_id = s.product_id
        WHERE ${where} GROUP BY 1, s.location_id`, params),
    salesByHour(user, f), salesByWeekday(user, f), salesByCategory(user, f), paymentMix(user, f),
    costsAllowed
      ? q<{ entry_date: string; location_id: number; location: string; category: string; amount: number; supplier: string | null; description: string | null; source: string; invoice_no: string | null }>(
          `SELECT e.entry_date::text entry_date, e.location_id, l.name location, c.name category, e.amount_net::float8 amount, coalesce(s.name, e.supplier) supplier,
                  e.description, e.source, i.number invoice_no
             FROM cost_entries e JOIN locations l ON l.id = e.location_id JOIN expense_categories c ON c.id = e.category_id
             LEFT JOIN invoices i ON i.id = e.invoice_id LEFT JOIN suppliers s ON s.id = i.supplier_id
            WHERE e.entry_date BETWEEN $1::date AND $2::date AND e.location_id = ANY($3::int[]) ORDER BY e.entry_date, l.name`, [from, to, locArr])
      : Promise.resolve([]),
    listUses(user, { from, to, locationId }),
    costsAllowed
      ? q<Record<string, unknown>>(
          `SELECT i.issue_date::text "Data", s.name "Furnizor", s.cif "CIF", i.number "Număr", CASE WHEN i.is_credit_note THEN 'storno' ELSE 'factură' END "Tip",
                  i.total_net::float8 "Fără TVA (lei)", i.total_vat::float8 "TVA (lei)", i.total_gross::float8 "Total cu TVA (lei)",
                  CASE i.status WHEN 'draft' THEN 'de verificat' WHEN 'verified' THEN 'verificată' ELSE 'anulată' END "Stare",
                  c.name "Categorie", coalesce(l.name, '') "Locație alocare", coalesce(rl.name, '') "Recepție la", i.source "Sursă"
             FROM invoices i JOIN suppliers s ON s.id = i.supplier_id LEFT JOIN expense_categories c ON c.id = i.category_id
             LEFT JOIN locations l ON l.id = i.allocation_location_id LEFT JOIN locations rl ON rl.id = i.receipt_location_id
            WHERE i.issue_date BETWEEN $1::date AND $2::date AND i.status <> 'cancelled'
              AND ($3::int IS NULL OR i.allocation_location_id = $3 OR i.receipt_location_id = $3
                   OR EXISTS (SELECT 1 FROM cost_entries e WHERE e.invoice_id = i.id AND e.location_id = $3))
            ORDER BY i.issue_date, s.name`, [from, to, locationId])
      : Promise.resolve([]),
    q<Record<string, unknown>>(
      `SELECT l.name "Locație", p.name "Produs", p.unit "UM", sum(m.qty)::float8 "Stoc", p.cost_price::float8 "Preț achiziție (lei)",
              round((sum(m.qty) * p.cost_price)::numeric, 2)::float8 "Valoare (lei)"
         FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN locations l ON l.id = m.location_id
        WHERE m.location_id = ANY($1::int[]) GROUP BY l.name, p.id HAVING sum(m.qty) <> 0 ORDER BY l.name, p.name`, [locArr]),
    q<Record<string, unknown>>(
      `SELECT to_char(s.sold_at, 'YYYY-MM-DD HH24:MI') "Data și ora", l.name "Locație", s.receipt_no "Bon", s.source_code "Cod", s.product_name "Produs",
              s.item_type "Categorie", s.qty::float8 "Cantitate", s.unit "UM", s.unit_price::float8 "Preț unitar fără TVA (lei)", s.net::float8 "Net (lei)",
              s.vat::float8 "TVA (lei)", s.gross::float8 "Total cu TVA (lei)", s.vat_rate::float8 "Cota TVA %", s.payment_method "Plată", s.table_name "Masă", s.client "Client"
         FROM sales_lines s JOIN locations l ON l.id = s.location_id WHERE ${where} ORDER BY s.sold_at, s.id LIMIT 250000`, params),
  ]);

  // ——— Sumar pe locații ———
  const sum = <T,>(rows: T[], loc: number | null, pick: (r: T) => number, key: (r: T) => number) =>
    rows.filter((r) => loc == null || key(r) === loc).reduce((s, r) => s + pick(r), 0);
  const cols: (number | null)[] = [...locations.map((l) => l.id), null];
  const sales = (loc: number | null, k: "net" | "vat" | "gross" | "receipts" | "days" | "qty") => sum(salesLoc, loc, (r) => r[k], (r) => r.location_id);
  const use = (loc: number | null, kind: string) => sum(uses.filter((u) => u.kind === kind), loc, (u) => u.cost ?? 0, (u) => u.location_id);
  const cost = (loc: number | null, cat?: string) => sum(costs.filter((c) => !cat || c.category === cat), loc, (c) => c.amount, (c) => c.location_id);
  const categories = [...new Set(costs.map((c) => c.category))];
  const aoa: (string | number | null)[][] = [
    [`Warose Bakery · ${from} – ${to}`, ...locations.map((l) => l.name), "Total"],
    ["Vânzări nete (fără TVA)", ...cols.map((c) => r2(sales(c, "net")))],
    ["TVA colectat", ...cols.map((c) => r2(sales(c, "vat")))],
    ["Vânzări cu TVA", ...cols.map((c) => r2(sales(c, "gross")))],
    ["Bonuri", ...cols.map((c) => sales(c, "receipts"))],
    ["Bon mediu (net)", ...cols.map((c) => r2(sales(c, "receipts") ? sales(c, "net") / sales(c, "receipts") : 0))],
    ["Zile cu vânzări", ...cols.map((c) => (c == null ? new Set(daily.map((d) => d.day)).size : sales(c, "days")))],
    ["Medie vânzări nete / zi", ...cols.map((c) => { const d = c == null ? new Set(daily.map((x) => x.day)).size : sales(c, "days"); return r2(d ? sales(c, "net") / d : 0); })],
    [],
    ["Pierderi (la cost)", ...cols.map((c) => r2(use(c, "loss")))],
    ["Pierderi % din vânzări", ...cols.map((c) => r2(sales(c, "net") ? (use(c, "loss") / sales(c, "net")) * 100 : 0))],
    ["Consum personal (la cost)", ...cols.map((c) => r2(use(c, "staff")))],
    ["Protocol (la cost)", ...cols.map((c) => r2(use(c, "protocol")))],
  ];
  if (costsAllowed) {
    aoa.push([], ["Costuri din facturi (fără TVA)", ...cols.map(() => null)]);
    for (const cat of categories) aoa.push([`   ${cat}`, ...cols.map((c) => r2(cost(c, cat)))]);
    aoa.push(["Total costuri facturi", ...cols.map((c) => r2(cost(c)))]);
    aoa.push([]);
    const res = (c: number | null) => sales(c, "net") - cost(c) - use(c, "loss") - use(c, "staff") - use(c, "protocol");
    aoa.push(["Rezultat estimat (vânzări − costuri − pierderi − consum)", ...cols.map((c) => r2(res(c)))]);
    aoa.push(["Marjă estimată %", ...cols.map((c) => r2(sales(c, "net") ? (res(c) / sales(c, "net")) * 100 : 0))]);
  }
  aoa.push([], ["Estimare operațională din datele aplicației (vânzări Publine, facturi verificate, pierderi și consum înregistrate), nu rezultatul contabil."]);

  // ——— Vânzări pe zile (coloane pe locații) ———
  const days = [...new Set(daily.map((d) => d.day))].sort();
  const dailyRows = days.map((d) => {
    const row: Record<string, unknown> = { "Data": d, "Ziua": WEEKDAYS[(new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7] };
    let tot = 0, rec = 0;
    for (const l of locations) { const x = daily.find((v) => v.day === d && v.location_id === l.id); row[`${l.name} (lei)`] = r2(x?.net ?? 0); tot += x?.net ?? 0; rec += x?.receipts ?? 0; }
    row["Total net (lei)"] = r2(tot); row["Bonuri"] = rec;
    return row;
  });

  // ——— Produse ———
  const totalNet = sales(null, "net") || 1;
  const byName = new Map<string, { code: string | null; category: string | null; qty: number; net: number; gross: number; unit_cost: number | null; perLoc: Map<number, { qty: number; net: number }> }>();
  for (const p of products) {
    const x = byName.get(p.name) ?? { code: p.code, category: p.category, qty: 0, net: 0, gross: 0, unit_cost: p.unit_cost, perLoc: new Map() };
    x.qty += p.qty; x.net += p.net; x.gross += p.gross; x.perLoc.set(p.location_id, { qty: p.qty, net: p.net }); byName.set(p.name, x);
  }
  const productRows = [...byName.entries()].sort((a, b) => b[1].net - a[1].net).map(([name, x], i) => {
    const row: Record<string, unknown> = {
      "Loc": i + 1, "Produs": name, "Cod": x.code ?? "", "Categorie": x.category ?? "", "Cantitate": r2(x.qty), "Net (lei)": r2(x.net), "Cu TVA (lei)": r2(x.gross),
      "Preț mediu net (lei)": r2(x.qty ? x.net / x.qty : 0), "Pondere %": r2((x.net / totalNet) * 100),
      "Cost unitar rețetă (lei)": r2(x.unit_cost), "Marjă estimată (lei)": x.unit_cost != null ? r2(x.net - x.qty * x.unit_cost) : null,
    };
    if (locations.length > 1) for (const l of locations) { const v = x.perLoc.get(l.id); if (l.kind === "store") { row[`Cantitate ${l.name}`] = r2(v?.qty ?? 0); row[`Net ${l.name} (lei)`] = r2(v?.net ?? 0); } }
    return row;
  });

  const useRows = (kind: string) => uses.filter((u) => u.kind === kind).map((u) => ({
    "Data": u.use_date, "Locație": u.location, "Produs": u.product, "Cantitate": u.qty, "UM": u.unit, "Cost unitar (lei)": r2(u.unit_cost),
    "Valoare la cost (lei)": r2(u.cost), "Valoare la vânzare (lei)": r2(u.sale_value), "Angajat / beneficiar": u.person ?? "", "Motiv": u.reason ?? "", "Introdus de": u.author,
  }));

  const sheets: [string, ReturnType<typeof sheet>][] = [
    ["Sumar", summarySheet(aoa, [52, ...locations.map(() => 22), 18])],
    ["Vânzări pe zile", sheet(dailyRows)],
    ["Produse", sheet(productRows)],
    ["Pe ore", sheet(hours.map((h) => ({ "Ora": `${h.hour}:00–${h.hour + 1}:00`, "Net (lei)": r2(h.net), "Bonuri": h.receipts })))],
    ["Pe zile ale săptămânii", sheet(WEEKDAYS.map((name, i) => { const w = weekdays.find((x) => x.dow === i + 1); return { "Ziua": name, "Zile": w?.days ?? 0, "Net total (lei)": r2(w?.net ?? 0), "Medie pe zi (lei)": r2(w?.days ? w.net / w.days : 0) }; }))],
    ["Categorii", sheet(cats.map((c) => ({ "Categorie": c.category, "Cantitate": r2(c.qty), "Net (lei)": r2(c.net), "Pondere %": r2((c.net / totalNet) * 100) })))],
    ["Metode de plată", sheet(mix.map((m) => ({ "Metodă": m.method, "Total cu TVA (lei)": r2(m.gross) })))],
  ];
  if (costsAllowed) {
    sheets.push(["Facturi furnizori", sheet(invoices)]);
    sheets.push(["Costuri pe locații", sheet(costs.map((c) => ({ "Data": c.entry_date, "Locație": c.location, "Categorie": c.category, "Valoare fără TVA (lei)": r2(c.amount), "Furnizor": c.supplier ?? "", "Factură": c.invoice_no ?? "", "Descriere": c.description ?? "", "Sursă": c.source === "invoice" ? "factură" : "manual" })))]);
  }
  sheets.push(
    ["Pierderi", sheet(useRows("loss"))],
    [USE_KINDS.staff.label, sheet(useRows("staff"))],
    [USE_KINDS.protocol.label, sheet(useRows("protocol"))],
    ["Stoc curent", sheet(stock)],
    ["Linii vânzări", sheet(lines)],
  );

  await audit({ userId: user.id, action: "export.complete", details: { from, to, locationId } });
  const locLabel = locationId ? locations.find((l) => l.id === locationId)?.name.replace(/[^\p{L}\p{N}]+/gu, "_") ?? "locatie" : "Toate";
  return xlsxResponse(book(sheets), `Warose_${locLabel}_${from}_${to}.xlsx`);
}
