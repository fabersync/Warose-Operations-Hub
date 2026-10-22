import * as XLSX from "xlsx";
import { getUser, canAccess } from "@/lib/auth";
import { q } from "@/lib/db";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Export Excel al vânzărilor: sumar pe produse + liniile brute, pentru planul de business sau verificări. */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || !canAccess(user, "sales")) return new Response("Neautorizat", { status: 401 });
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return new Response("Perioadă invalidă", { status: 400 });

  const params: unknown[] = [from, to];
  const where = ["s.sold_date BETWEEN $1::date AND $2::date"];
  if (user.locationIds !== null) { params.push(user.locationIds); where.push(`s.location_id = ANY($${params.length}::int[])`); }
  const loc = Number(url.searchParams.get("loc"));
  if (loc) { params.push(loc); where.push(`s.location_id = $${params.length}`); }
  const search = url.searchParams.get("q");
  if (search) { params.push(`%${search}%`); where.push(`s.product_name ILIKE $${params.length}`); }

  const summary = await q(
    `SELECT l.name "Locație", s.product_name "Produs", s.source_code "Cod Publine", sum(s.qty)::float8 "Cantitate",
            sum(s.net)::float8 "Valoare fără TVA", sum(s.vat)::float8 "TVA", sum(s.gross)::float8 "Total cu TVA"
       FROM sales_lines s JOIN locations l ON l.id = s.location_id
      WHERE ${where.join(" AND ")}
      GROUP BY l.name, s.product_name, s.source_code ORDER BY l.name, sum(s.net) DESC`,
    params,
  );
  const daily = await q(
    `SELECT s.sold_date::text "Data", l.name "Locație", count(DISTINCT s.receipt_no)::int "Bonuri",
            sum(s.net)::float8 "Valoare fără TVA", sum(s.vat)::float8 "TVA", sum(s.gross)::float8 "Total cu TVA"
       FROM sales_lines s JOIN locations l ON l.id = s.location_id
      WHERE ${where.join(" AND ")} GROUP BY 1, 2 ORDER BY 1, 2`,
    params,
  );
  const lines = await q(
    `SELECT to_char(s.sold_at,'YYYY-MM-DD HH24:MI:SS') "Data și ora", l.name "Locație", s.receipt_no "Nr. comandă", s.invoice_no "Nr. factură",
            s.source_code "Cod", s.product_name "Articol", s.qty::float8 "Cantitate", s.unit "UM", s.net::float8 "Valoare",
            s.vat::float8 "TVA", s.gross::float8 "Total", s.vat_rate::float8 "Cota TVA", s.payment_method "Încasare", s.batch_id "Import #"
       FROM sales_lines s JOIN locations l ON l.id = s.location_id
      WHERE ${where.join(" AND ")} ORDER BY s.sold_at, s.id LIMIT 200000`,
    params,
  );

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Sumar produse");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(daily), "Pe zile");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lines), "Linii");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  await audit({ userId: user.id, action: "export.sales", details: { from, to, loc: loc || null, q: search } });
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Vanzari_${from}_${to}.xlsx"`,
    },
  });
}
