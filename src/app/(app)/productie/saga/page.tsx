import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtNum } from "@/lib/format";
import { canEditProduction } from "@/lib/production";
import { sagaComparison } from "@/lib/saga";
import { Badge, Card, EmptyState, Notice } from "@/components/ui";
import { mapSagaCode } from "../actions";
import { SagaUpload } from "./SagaUpload";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comparație SAGA" };

const MONTHS = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export default async function SagaPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser("production");
  const edit = canEditProduction(user);
  const months = (await q<{ m: string }>(
    `SELECT DISTINCT to_char(d, 'YYYY-MM') m FROM (
       SELECT doc_date d FROM saga_production_lines UNION SELECT planned_for FROM production_orders WHERE status = 'approved') x ORDER BY 1 DESC`,
  )).map((r) => r.m);
  const sp = await searchParams;
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : months[0];
  const [rows, unmapped, products] = await Promise.all([
    month ? sagaComparison(month) : Promise.resolve([]),
    q<{ id: number; code: string; name: string; qty: number; unit: string | null }>(
      `SELECT c.id, c.code, c.name_in_source name, coalesce(sum(s.qty),0)::float8 qty, max(s.unit) unit
         FROM product_codes c LEFT JOIN saga_production_lines s ON s.code = c.code
        WHERE c.source = 'saga' AND c.product_id IS NULL GROUP BY c.id ORDER BY qty DESC`,
    ),
    q<{ id: number; name: string }>("SELECT id, name FROM products WHERE active ORDER BY name"),
  ]);
  const matched = rows.filter((r) => r.product_id && Math.abs(r.saga_qty - r.hub_qty) < 1e-9 && r.saga_qty > 0).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Producție SAGA vs. aplicație" subtitle={month ? `Documente aprobate în aplicație comparate cu „Situația producției” din SAGA · ${monthLabel(month)}` : undefined}
          action={months.length > 1 ? (
            <form className="flex gap-1.5">
              <select name="m" defaultValue={month} className="input py-1 text-xs" aria-label="Luna">{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
              <button className="btn btn-ghost px-2 py-1 text-xs">Arată</button>
            </form>
          ) : undefined} pad={false}>
          {rows.length ? (
            <>
              <div className="border-b border-line px-5 py-3 text-xs text-muted sm:px-6">{matched} produse identice · {rows.length - matched} cu diferențe sau neasociate</div>
              <div className="max-h-[620px] overflow-auto">
                <table className="table">
                  <thead className="sticky top-0 bg-surface"><tr><th>Produs</th><th>Cod SAGA</th><th className="num">SAGA</th><th className="num">Aplicație</th><th className="num">Diferență</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const d = r.hub_qty - r.saga_qty;
                      return (
                        <tr key={`${r.product}-${i}`}>
                          <td className="font-medium text-ink">{r.product}{!r.product_id && <span className="ml-2"><Badge tone="warn">neasociat</Badge></span>}</td>
                          <td className="font-mono text-xs">{r.codes || "—"}</td>
                          <td className="num">{fmtNum(r.saga_qty)}</td>
                          <td className="num">{fmtNum(r.hub_qty)}</td>
                          <td className="num">{Math.abs(d) < 1e-9 ? <Badge tone="good">egal</Badge> : <span className={d < 0 ? "text-bad" : "text-warn"}>{d > 0 ? "+" : ""}{fmtNum(d)}</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <EmptyState title="Nimic de comparat încă">Importați raportul SAGA „Situația producției” pentru o lună și aprobați documentele de producție din aceeași lună.</EmptyState>
          )}
        </Card>
        <div className="space-y-4">
          {edit && (
            <Card title="Import raport SAGA" subtitle="SAGA C → Rapoarte → Situația producției → export Excel">
              <SagaUpload />
            </Card>
          )}
          <Notice title="Cum se citește">
            Diferențele arată documente introduse doar într-un sistem sau cu cantități diferite. Aplicația nu modifică SAGA; corecțiile se fac de contabilitate.
          </Notice>
        </div>
      </div>

      {unmapped.length > 0 && (
        <Card title="Coduri SAGA neasociate" subtitle="Asociați fiecare cod SAGA cu produsul din aplicație (ex: „CROISSANT CIOCOLATA PF” = „CROISSANT CU CIOCOLATA 100 G” din Publine)" pad={false}>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Cod</th><th>Denumire SAGA</th><th className="num">Cantitate în rapoarte</th><th>Asociere</th></tr></thead>
              <tbody>
                {unmapped.map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono text-xs">{c.code}</td>
                    <td className="font-medium text-ink">{c.name}</td>
                    <td className="num">{fmtNum(c.qty)} {c.unit ?? ""}</td>
                    <td>
                      {edit ? (
                        <div className="flex flex-wrap gap-1.5">
                          <form action={mapSagaCode} className="flex gap-1.5">
                            <input type="hidden" name="code_id" value={c.id} />
                            <select name="product_id" required defaultValue="" className="input max-w-[260px] py-1 text-xs" aria-label={`Produs pentru ${c.name}`}>
                              <option value="" disabled>Alegeți produsul…</option>
                              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <button className="btn btn-ghost px-2 py-1 text-xs">Asociază</button>
                          </form>
                          <form action={mapSagaCode}>
                            <input type="hidden" name="code_id" value={c.id} />
                            <input type="hidden" name="create" value="1" />
                            <button className="btn btn-ghost px-2 py-1 text-xs" title="Creează un produs finit nou cu denumirea din SAGA">Produs nou</button>
                          </form>
                        </div>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
