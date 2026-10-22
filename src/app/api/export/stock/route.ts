import * as XLSX from "xlsx";
import { getUser, canAccess } from "@/lib/auth";
import { q } from "@/lib/db";
import { audit } from "@/lib/audit";
import { MOVEMENT_LABELS } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Export Excel al stocurilor: stocul operațional curent (cu valoare la ultimul preț de achiziție),
 * loturile în stoc și mișcările dintr-o perioadă. ?loc= locația (opțional), ?from=&to= perioada mișcărilor.
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || !canAccess(user, "stock")) return new Response("Neautorizat", { status: 401 });
  const url = new URL(req.url);
  const loc = Number(url.searchParams.get("loc")) || null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest" }).format(new Date());
  const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : `${today.slice(0, 7)}-01`;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : today;

  const params: unknown[] = [];
  const where = ["TRUE"];
  if (user.locationIds !== null) { params.push(user.locationIds); where.push(`m.location_id = ANY($${params.length}::int[])`); }
  if (loc) { params.push(loc); where.push(`m.location_id = $${params.length}`); }
  const w = where.join(" AND ");

  const stock = await q(
    `SELECT l.name "Locație", p.name "Produs", p.unit "UM", sum(m.qty)::float8 "Stoc",
            p.cost_price::float8 "Preț achiziție", round((sum(m.qty) * p.cost_price)::numeric, 2)::float8 "Valoare",
            to_char(max(m.occurred_at) AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI') "Ultima mișcare"
       FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN locations l ON l.id = m.location_id
      WHERE ${w} GROUP BY l.name, p.id HAVING sum(m.qty) <> 0 ORDER BY l.name, p.name`, params);
  const lots = await q(
    `SELECT l.name "Locație", p.name "Produs", coalesce(m.lot, '') "Lot",
            min(m.produced_on) FILTER (WHERE m.qty > 0)::text "Produs la", min(m.expires_on) FILTER (WHERE m.qty > 0)::text "Expiră",
            sum(m.qty)::float8 "Cantitate", p.unit "UM"
       FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN locations l ON l.id = m.location_id
      WHERE ${w} AND m.lot IS NOT NULL GROUP BY l.name, p.id, m.lot HAVING sum(m.qty) > 0 ORDER BY l.name, p.name, 4`, params);
  const moves = (await q<{ kind: string } & Record<string, unknown>>(
    `SELECT to_char(m.occurred_at AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI') "Data", l.name "Locație", m.kind,
            p.name "Produs", m.qty::float8 "Cantitate", p.unit "UM", coalesce(m.lot, '') "Lot", coalesce(cl.name, '') "Către / de la",
            coalesce(m.document_ref, '') "Document", coalesce(m.note, '') "Observații", coalesce(u.name, 'import') "Utilizator"
       FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN locations l ON l.id = m.location_id
       LEFT JOIN locations cl ON cl.id = m.counterpart_location_id LEFT JOIN users u ON u.id = m.created_by
      WHERE ${w} AND (m.occurred_at AT TIME ZONE 'Europe/Bucharest')::date BETWEEN '${from}'::date AND '${to}'::date
      ORDER BY m.occurred_at, m.id LIMIT 100000`, params))
    .map(({ kind, ...r }) => ({ ...r, "Operațiune": MOVEMENT_LABELS[kind] ?? kind }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stock.length ? stock : [{ "Locație": "Nicio poziție în stoc" }]), "Stoc curent");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lots.length ? lots : [{ "Locație": "Niciun lot în stoc" }]), "Loturi");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(moves.length ? moves : [{ "Data": `Nicio mișcare ${from} – ${to}` }]), `Mișcări ${from.slice(5)}–${to.slice(5)}`);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  await audit({ userId: user.id, action: "export.stock", details: { loc, from, to } });
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Stocuri_${loc ?? "toate"}_${today}.xlsx"`,
    },
  });
}
