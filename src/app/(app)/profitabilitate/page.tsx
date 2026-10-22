import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate, fmtNum, fmtRon, todayLocal } from "@/lib/format";
import { recipeList } from "@/lib/production";
import { Badge, Card, EmptyState, Notice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profitabilitate" };

const MONTHS = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "nov", "dec"];
const ml = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

export default async function ProfitabilityPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireUser("profitability");
  const sp = await searchParams;
  const months = (await q<{ m: string }>(
    `SELECT DISTINCT to_char(d, 'YYYY-MM') m FROM (SELECT entry_date d FROM cost_entries UNION SELECT sold_date FROM sales_lines) x ORDER BY 1 DESC LIMIT 12`)).map((x) => x.m);
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : months[0] ?? todayLocal().slice(0, 7);
  const from = `${month}-01`;

  const [trend, recipes, sold, prices] = await Promise.all([
    q<{ m: string; location: string; revenue: number; costs: number; materials: number }>(
      `WITH r AS (SELECT to_char(sold_date,'YYYY-MM') m, location_id, sum(net) v FROM sales_lines GROUP BY 1, 2),
            c AS (SELECT to_char(entry_date,'YYYY-MM') m, location_id, sum(amount_net) v,
                         sum(amount_net) FILTER (WHERE category_id = (SELECT id FROM expense_categories WHERE name = 'Materii Prime')) mp
                    FROM cost_entries GROUP BY 1, 2)
       SELECT coalesce(r.m, c.m) m, l.name location, coalesce(r.v,0)::float8 revenue, coalesce(c.v,0)::float8 costs, coalesce(c.mp,0)::float8 materials
         FROM r FULL JOIN c ON c.m = r.m AND c.location_id = r.location_id
         JOIN locations l ON l.id = coalesce(r.location_id, c.location_id)
        WHERE coalesce(r.m, c.m) = ANY($1::text[])
        ORDER BY 1 DESC, 2`, [months.slice(0, 6)]),
    recipeList(),
    q<{ product_id: number; qty: number; net: number }>(
      `SELECT product_id, sum(qty)::float8 qty, sum(net)::float8 net FROM sales_lines
        WHERE sold_date >= $1::date AND sold_date < $1::date + interval '1 month' AND product_id IS NOT NULL GROUP BY 1`, [from]),
    q<{ name: string; unit: string; last: number; prev: number | null; last_date: string; supplier: string | null }>(
      `SELECT p.name, p.unit, h.unit_cost::float8 last, h.price_date::text last_date, s.name supplier,
              (SELECT h2.unit_cost::float8 FROM price_history h2 WHERE h2.product_id = h.product_id AND (h2.price_date, h2.id) < (h.price_date, h.id)
                ORDER BY h2.price_date DESC, h2.id DESC LIMIT 1) prev
         FROM (SELECT DISTINCT ON (product_id) * FROM price_history ORDER BY product_id, price_date DESC, id DESC) h
         JOIN products p ON p.id = h.product_id LEFT JOIN suppliers s ON s.id = h.supplier_id`),
  ]);

  const current = trend.filter((t) => t.m === month);
  const margins = recipes
    .filter((r) => r.recipe_id && r.missing_prices === 0 && r.batch_cost != null && r.sale_price != null)
    .map((r) => {
      const unitCost = r.batch_cost! / r.yield_qty!;
      const net = r.sale_price! / (1 + (r.vat_rate ?? 0) / 100);
      const s = sold.find((x) => x.product_id === r.product_id);
      return { ...r, unitCost, net, margin: ((net - unitCost) / net) * 100, qty: s?.qty ?? 0, contribution: s ? s.net - s.qty * unitCost : 0 };
    })
    .sort((a, b) => a.margin - b.margin);
  const incomplete = recipes.filter((r) => r.recipe_id && r.missing_prices > 0).length;
  const changes = prices.filter((p) => p.prev != null && Math.abs((p.last - p.prev!) / p.prev!) >= 0.005)
    .map((p) => ({ ...p, pct: ((p.last - p.prev!) / p.prev!) * 100 })).sort((a, b) => b.pct - a.pct);

  return (
    <>
      <PageHeader
        title="Profitabilitate"
        description="Marja estimată pe produs (rețetă vs. preț de vânzare) și rezultatul estimat pe locație (vânzări Publine − costuri înregistrate). Sunt estimări operaționale, nu profitul contabil al firmei."
        actions={months.length > 0 ? (
          <form className="flex items-center gap-2">
            <select name="m" defaultValue={month} className="input w-auto py-1.5" aria-label="Luna">{months.map((m) => <option key={m} value={m}>{ml(m)}</option>)}</select>
            <button className="btn btn-ghost py-1.5">Arată</button>
          </form>
        ) : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {current.map((c) => {
          const res = c.revenue - c.costs;
          return (
            <div key={c.location} className="card card-pad">
              <div className="eyebrow">{c.location} · {ml(month)}</div>
              <div className={`mt-2.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums ${res < 0 ? "text-bad" : "text-ink"}`}>{fmtRon(res)}</div>
              <dl className="mt-3 grid grid-cols-2 gap-1 text-xs">
                <dt className="text-muted">Vânzări nete</dt><dd className="text-right tabular-nums">{fmtRon(c.revenue)}</dd>
                <dt className="text-muted">Costuri înregistrate</dt><dd className="text-right tabular-nums">{fmtRon(c.costs)}</dd>
                <dt className="text-muted">Materii prime / vânzări</dt><dd className="text-right tabular-nums">{c.revenue ? `${Math.round((c.materials / c.revenue) * 100)}%` : "—"}</dd>
              </dl>
            </div>
          );
        })}
        {!current.length && <Card className="sm:col-span-2 xl:col-span-3"><EmptyState title="Nicio dată pentru luna aleasă" /></Card>}
      </div>
      <div className="mt-4"><Notice tone="warn">Rezultatul include doar costurile introduse în aplicație (facturi verificate și costuri manuale). Fără salarii, chirie sau amortizări introduse, rezultatul este supraestimat.</Notice></div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Marja estimată pe produs" subtitle={`Cost ingrediente din rețetă vs. preț fără TVA · vânzări ${ml(month)}${incomplete ? ` · ${incomplete} rețete fără prețuri complete nu apar` : ""}`} pad={false}>
          {margins.length ? (
            <table className="table">
              <thead><tr><th>Produs</th><th className="num">Cost / buc</th><th className="num">Preț net</th><th className="num">Marjă</th><th className="num">Vândut</th><th className="num">Contribuție</th></tr></thead>
              <tbody>
                {margins.map((m) => (
                  <tr key={m.product_id}>
                    <td className="font-medium text-ink"><Link href={`/productie/retete/${m.product_id}`} className="hover:text-crust">{m.product}</Link></td>
                    <td className="num">{fmtRon(m.unitCost, true)}</td>
                    <td className="num text-muted">{fmtRon(m.net, true)}</td>
                    <td className="num"><Badge tone={m.margin < 50 ? "bad" : m.margin < 65 ? "warn" : "good"}>{Math.round(m.margin)}%</Badge></td>
                    <td className="num">{fmtNum(m.qty)}</td>
                    <td className="num">{m.qty ? fmtRon(m.contribution) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState title="Nicio rețetă cu prețuri complete">Marja apare după ce rețetele au toate materiile prime cu preț (din facturi sau introduse manual).</EmptyState>}
        </Card>

        <Card title="Modificări de preț la achiziție" subtitle="Ultimul preț din facturi vs. precedentul">
          {changes.length ? (
            <ul className="space-y-2.5 text-sm">
              {changes.map((c) => (
                <li key={c.name} className="flex items-start justify-between gap-3">
                  <span className="min-w-0"><span className="block truncate text-ink-2">{c.name}</span><span className="text-xs text-muted">{c.supplier ?? "—"} · {fmtDate(c.last_date)}</span></span>
                  <span className="shrink-0 text-right tabular-nums">{fmtRon(c.last, true)}/{c.unit}<div className={`text-xs ${c.pct > 0 ? "text-bad" : "text-good"}`}>{c.pct > 0 ? "+" : ""}{c.pct.toFixed(1)}%</div></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Nicio modificare de preț încă. Apar după a doua factură verificată pentru aceeași materie primă.</p>}
        </Card>
      </div>

      {trend.length > 0 && (
        <Card className="mt-4" title="Evoluție lunară" subtitle="Ultimele 6 luni cu date" pad={false}>
          <table className="table">
            <thead><tr><th>Luna</th><th>Locație</th><th className="num">Vânzări nete</th><th className="num">Costuri</th><th className="num">Rezultat estimat</th></tr></thead>
            <tbody>
              {trend.map((t) => (
                <tr key={t.m + t.location}>
                  <td className="text-xs">{ml(t.m)}</td><td>{t.location}</td>
                  <td className="num">{fmtRon(t.revenue)}</td><td className="num">{fmtRon(t.costs)}</td>
                  <td className={`num font-medium ${t.revenue - t.costs < 0 ? "text-bad" : ""}`}>{fmtRon(t.revenue - t.costs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
