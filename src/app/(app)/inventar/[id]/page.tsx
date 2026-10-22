import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDateTime, fmtNum, fmtRon } from "@/lib/format";
import { canManageInventory, canSeeBook, getCount, getCountLines } from "@/lib/inventory";
import { Badge, Card, Kpi, Notice, PageHeader } from "@/components/ui";
import { CloseForm, CountSheet } from "../Forms";
import { addLine, cancelInventory } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inventar" };

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("inventory");
  const { id } = await params;
  const count = await getCount(user, Number(id));
  if (!count) notFound();
  const lines = await getCountLines(count.id);
  const showBook = canSeeBook(user);
  const manage = canManageInventory(user);

  const back = <Link href="/inventar" className="btn btn-ghost"><ArrowLeft className="size-4" />Inventare</Link>;
  const subtitle = <>Se referă la {fmtDateTime(count.as_of)} · deschis de {count.started_by}{count.note && ` · ${count.note}`}</>;

  if (count.status !== "open") {
    const withDiff = lines.filter((l) => l.counted_qty !== null && Math.abs(l.counted_qty - l.book_qty) > 1e-9);
    const minus = withDiff.reduce((s, l) => s + Math.min(l.counted_qty! - l.book_qty, 0) * (l.unit_value ?? 0), 0);
    const plus = withDiff.reduce((s, l) => s + Math.max(l.counted_qty! - l.book_qty, 0) * (l.unit_value ?? 0), 0);
    const noPrice = withDiff.filter((l) => l.unit_value == null).length;
    return (
      <>
        <PageHeader
          eyebrow={`Inventar #${count.id}`}
          title={count.location}
          description={subtitle}
          actions={<>{back}{count.status === "closed" && <a href={`/api/export/inventory/${count.id}`} className="btn btn-primary"><Download className="size-4" />Raport Excel</a>}</>}
        />
        {count.status === "cancelled" ? (
          <Notice tone="warn">Inventar anulat de {count.closed_by} la {fmtDateTime(count.closed_at)}. Nu a modificat stocul.</Notice>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Produse cu diferențe" value={fmtNum(withDiff.length)} hint={<span>din {lines.length} produse</span>} />
              <Kpi label="Lipsuri (valoare)" value={<span className="text-bad">{fmtRon(minus, true)}</span>} hint={<span>la preț de vânzare cu TVA</span>} />
              <Kpi label="Plusuri (valoare)" value={fmtRon(plus, true)} hint={<span>la preț de vânzare cu TVA</span>} />
              <Kpi label="Diferență netă" value={fmtRon(count.posted_value ?? 0, true)} hint={<span>închis de {count.closed_by}, {fmtDateTime(count.closed_at)}</span>} />
            </div>
            {noPrice > 0 && <div className="mt-4"><Notice tone="warn">{noPrice} produse cu diferențe nu au preț în catalog și nu sunt incluse în valoare.</Notice></div>}
            {count.uncounted_as_zero && <div className="mt-4"><Notice>Produsele nenumărate au fost considerate cu stoc faptic 0.</Notice></div>}
          </>
        )}
        <Card className="mt-4" title="Rezultat" subtitle="Diferențele au fost înregistrate ca mișcări „Diferență inventar” la data inventarului" pad={false}>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Produs</th><th className="num">Scriptic</th><th className="num">Faptic</th><th className="num">Diferență</th><th className="num">Preț</th><th className="num">Valoare</th><th>Numărat de</th></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const d = l.counted_qty === null ? null : l.counted_qty - l.book_qty;
                  return (
                    <tr key={l.id}>
                      <td className="font-medium text-ink">{l.product}</td>
                      <td className="num">{fmtNum(l.book_qty)} <span className="text-muted">{l.unit}</span></td>
                      <td className="num">{l.counted_qty === null ? <Badge>nenumărat</Badge> : fmtNum(l.counted_qty)}</td>
                      <td className={`num font-medium ${d && d < 0 ? "text-bad" : d && d > 0 ? "text-good" : "text-muted"}`}>{d === null ? "—" : `${d > 0 ? "+" : ""}${fmtNum(d)}`}</td>
                      <td className="num text-muted">{l.unit_value != null ? fmtRon(l.unit_value, true) : "—"}</td>
                      <td className="num">{d && l.unit_value != null ? fmtRon(d * l.unit_value, true) : "—"}</td>
                      <td className="text-xs text-muted">{l.counted_by ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </>
    );
  }

  const listed = new Set(lines.map((l) => l.product_id));
  const others = (await q<{ id: number; name: string }>("SELECT id, name FROM products WHERE active ORDER BY name")).filter((p) => !listed.has(p.id));
  const uncounted = lines.filter((l) => l.counted_qty === null).length;

  return (
    <>
      <PageHeader eyebrow={`Inventar #${count.id} · în lucru`} title={count.location} description={subtitle} actions={back} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          {lines.length ? (
            <CountSheet lines={lines} showBook={showBook} />
          ) : (
            <p className="py-6 text-center text-sm text-muted">Lista este goală: în această locație nu există încă produse cu stoc gestionat sau mișcări. Adăugați produsele găsite folosind „Produs găsit în plus”.</p>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Produs găsit în plus" subtitle="Nu era pe listă, dar există fizic">
            <form action={addLine} className="space-y-2">
              <input type="hidden" name="count_id" value={count.id} />
              <select name="product_id" className="input" required defaultValue="" aria-label="Produs">
                <option value="" disabled>Alegeți produsul…</option>
                {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="btn btn-ghost w-full">Adaugă în inventar</button>
            </form>
          </Card>
          {manage ? (
            <Card title="Finalizare" subtitle="Verificați lista înainte de închidere">
              <CloseForm countId={count.id} uncounted={uncounted} />
              <form action={cancelInventory} className="mt-2">
                <input type="hidden" name="count_id" value={count.id} />
                <button className="btn btn-danger w-full">Anulează inventarul</button>
              </form>
            </Card>
          ) : (
            <Notice>Numărați fiecare produs; valorile se salvează automat. Managerul locației închide inventarul.</Notice>
          )}
          {!showBook && <Notice title="Numărare fără stoc scriptic">Stocul din evidență nu este afișat, pentru o numărare corectă.</Notice>}
        </div>
      </div>
    </>
  );
}
