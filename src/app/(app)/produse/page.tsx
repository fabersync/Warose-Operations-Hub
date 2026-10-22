import { Tag } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtRon } from "@/lib/format";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { createProduct, remapCode, updateProduct } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produse" };

const CATEGORY_LABELS: Record<string, string> = {
  finished: "Produs finit", raw: "Materie primă", merchandise: "Marfă", packaging: "Ambalaj", service: "Serviciu", other: "Altele",
};

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser("products");
  const sp = await searchParams;
  const search = sp.q?.trim() ?? "";
  const products = await q<{ id: number; name: string; unit: string; category: string; is_frozen: boolean; track_stock: boolean; sale_price: string | null; vat_rate: string | null; codes: { id: number; source: string; code: string; name_in_source: string }[] | null }>(
    `SELECT p.id, p.name, p.unit, p.category, p.is_frozen, p.track_stock, p.sale_price, p.vat_rate,
            (SELECT json_agg(json_build_object('id', c.id, 'source', c.source, 'code', c.code, 'name_in_source', c.name_in_source) ORDER BY c.source, c.code)
               FROM product_codes c WHERE c.product_id = p.id) codes
       FROM products p WHERE ($1 = '' OR p.name ILIKE '%' || $1 || '%') ORDER BY p.name`,
    [search],
  );
  const all = await q<{ id: number; name: string }>("SELECT id, name FROM products ORDER BY name");

  return (
    <>
      <PageHeader
        title="Produse & coduri"
        description="Catalogul unic al aplicației și asocierea cu codurile din Publine și SAGA C. Codurile Publine noi creează automat un produs, pe care îl puteți reasocia. La produsele cu „stoc gestionat”, vânzările importate de acum înainte scad automat din stocul locației."
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Catalog" subtitle={`${products.length} produse`} pad={false}
          action={<form><input name="q" defaultValue={search} placeholder="Caută…" className="input w-44 py-1.5" /></form>}>
          {products.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Produs</th><th>Coduri externe</th><th className="num">Preț vânzare</th><th>Clasificare</th></tr></thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium text-ink">{p.name}</td>
                      <td className="text-xs">
                        {(p.codes ?? []).map((c) => (
                          <details key={c.id} className="group">
                            <summary className="cursor-pointer list-none text-ink-2"><span className="uppercase text-muted">{c.source}</span> {c.code}</summary>
                            <form action={remapCode} className="mt-1.5 flex gap-1.5">
                              <input type="hidden" name="code_id" value={c.id} />
                              <select name="product_id" defaultValue={p.id} className="input py-1 text-xs">
                                {all.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                              </select>
                              <button className="btn btn-ghost px-2 py-1 text-xs">Asociază</button>
                            </form>
                          </details>
                        ))}
                        {!p.codes?.length && <span className="text-faint">—</span>}
                      </td>
                      <td className="num">{p.sale_price ? fmtRon(Number(p.sale_price), true) : "—"}{p.vat_rate && <div className="text-xs text-muted">TVA {Number(p.vat_rate)}%</div>}</td>
                      <td>
                        <form action={updateProduct} className="flex flex-wrap items-center gap-1.5">
                          <input type="hidden" name="id" value={p.id} />
                          <select name="category" defaultValue={p.category} className="input w-auto py-1 text-xs">
                            {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                          <input name="unit" defaultValue={p.unit} className="input w-16 py-1 text-xs" aria-label="Unitate de măsură" />
                          <label className="flex items-center gap-1 text-xs text-ink-2"><input type="checkbox" name="is_frozen" defaultChecked={p.is_frozen} className="accent-crust" />congelat</label>
                          <label className="flex items-center gap-1 text-xs text-ink-2" title="Vânzările Publine importate de acum înainte scad din stocul locației"><input type="checkbox" name="track_stock" defaultChecked={p.track_stock} className="accent-crust" />stoc gestionat</label>
                          <button className="btn btn-ghost px-2 py-1 text-xs">Salvează</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon={<Tag className="size-5" />} title="Niciun produs">Produsele apar automat după primul import Publine.</EmptyState>}
        </Card>

        <Card title="Produs nou" subtitle="Ex: materii prime, produse congelate din BRUTĂRIE">
          <form action={createProduct} className="space-y-3">
            <div className="field"><label className="label" htmlFor="name">Denumire</label><input id="name" name="name" required className="input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="field"><label className="label" htmlFor="unit">UM</label><input id="unit" name="unit" defaultValue="buc" className="input" /></div>
              <div className="field">
                <label className="label" htmlFor="category">Categorie</label>
                <select id="category" name="category" defaultValue="finished" className="input">
                  {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="is_frozen" className="accent-crust" />Produs congelat</label>
            <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="track_stock" defaultChecked className="accent-crust" />Stoc gestionat (apare în stocuri și inventar)</label>
            <button className="btn btn-primary w-full">Adaugă</button>
          </form>
        </Card>
      </div>
    </>
  );
}
