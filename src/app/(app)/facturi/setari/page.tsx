import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtRon } from "@/lib/format";
import { getSetting } from "@/lib/invoices";
import { Card } from "@/components/ui";
import { RuleForm } from "../Forms";
import { saveFinanceSettings, saveSupplier } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Furnizori & alocări" };

export default async function FinanceSettingsPage() {
  await requireUser("invoices");
  const [suppliers, categories, rules, locations, cif, eur] = await Promise.all([
    q<{ id: number; name: string; cif: string | null; default_category_id: number | null; default_rule_id: number | null; default_location_id: number | null; invoices: number; total: number | null }>(
      `SELECT s.id, s.name, s.cif, s.default_category_id, s.default_rule_id, s.default_location_id,
              count(i.id) FILTER (WHERE i.status = 'verified')::int invoices, sum(i.total_net) FILTER (WHERE i.status = 'verified')::float8 total
         FROM suppliers s LEFT JOIN invoices i ON i.supplier_id = s.id GROUP BY s.id ORDER BY total DESC NULLS LAST, s.name`),
    q<{ id: number; name: string }>("SELECT id, name FROM expense_categories WHERE active ORDER BY sort, name"),
    q<{ id: number; name: string; splits: { location_id: number; pct: number }[] }>("SELECT id, name, splits FROM allocation_rules ORDER BY name"),
    q<{ id: number; name: string }>("SELECT id, name FROM locations WHERE active AND kind <> 'freezer' ORDER BY id"),
    getSetting<string>("company_cif", ""),
    getSetting<number>("eur_rate", 5),
  ]);
  const locName = (id: number) => locations.find((l) => l.id === id)?.name ?? `#${id}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card title="Furnizori" subtitle="Categoria și alocarea implicite se propun automat la fiecare factură nouă a furnizorului" pad={false}>
        <table className="table">
          <thead><tr><th>Furnizor</th><th className="num">Achiziții</th><th>Implicit</th></tr></thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id}>
                <td><div className="font-medium text-ink">{s.name}</div><div className="text-xs text-muted">{s.cif ?? "fără CIF"}</div></td>
                <td className="num">{s.total ? fmtRon(s.total) : "—"}<div className="text-xs text-muted">{s.invoices} facturi</div></td>
                <td>
                  <form action={saveSupplier} className="flex flex-wrap gap-1.5">
                    <input type="hidden" name="supplier_id" value={s.id} />
                    <select name="category_id" defaultValue={s.default_category_id ?? ""} className="input w-auto py-1 text-xs" aria-label="Categorie implicită">
                      <option value="">categorie…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select name="location_id" defaultValue={s.default_location_id ?? ""} className="input w-auto py-1 text-xs" aria-label="Locație implicită">
                      <option value="">locație…</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                    <select name="rule_id" defaultValue={s.default_rule_id ?? ""} className="input w-auto py-1 text-xs" aria-label="Regulă implicită">
                      <option value="">fără regulă</option>{rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <button className="btn btn-ghost px-2 py-1 text-xs">Salvează</button>
                  </form>
                </td>
              </tr>
            ))}
            {!suppliers.length && <tr><td colSpan={3} className="text-center text-muted">Furnizorii apar automat la importul primei facturi.</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="space-y-4">
        <Card title="Firmă">
          <form action={saveFinanceSettings} className="space-y-3">
            <div className="field"><label className="label" htmlFor="company_cif">CIF firmă (client pe facturi)</label><input id="company_cif" name="company_cif" defaultValue={cif} className="input" /></div>
            <div className="field"><label className="label" htmlFor="eur_rate">Curs EUR pentru rapoarte</label><input id="eur_rate" name="eur_rate" defaultValue={String(eur).replace(".", ",")} inputMode="decimal" className="input" /></div>
            <button className="btn btn-ghost w-full">Salvează</button>
          </form>
        </Card>
        <Card title="Reguli de alocare" subtitle="Pentru costuri comune (ex: contabilitate, utilități împărțite)">
          {rules.length > 0 && (
            <ul className="mb-4 space-y-2 text-sm">
              {rules.map((r) => <li key={r.id}><div className="font-medium text-ink">{r.name}</div><div className="text-xs text-muted">{r.splits.map((s) => `${locName(s.location_id)} ${s.pct}%`).join(" · ")}</div></li>)}
            </ul>
          )}
          <RuleForm locations={locations} />
        </Card>
      </div>
    </div>
  );
}
