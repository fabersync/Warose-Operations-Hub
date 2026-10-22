import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { canConfigureProofing } from "@/lib/proofing";
import { locationsFor } from "@/lib/queries";
import { Badge, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { saveLocationSettings } from "../actions";
import { ProductConfigForm } from "../Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setări dospire" };

export default async function ProofingSettingsPage() {
  const user = await requireUser("proofing");
  const edit = canConfigureProofing(user);
  const [configs, products, locations, settings] = await Promise.all([
    q<{ product_id: number; name: string; thaw: number; proof: number; bake: number; validated: boolean; note: string | null; updated_by: string | null; updated_at: string }>(
      `SELECT c.product_id, p.name, c.thaw_minutes thaw, c.proof_minutes proof, c.bake_minutes bake, c.validated, c.note, u.name updated_by, c.updated_at
         FROM product_proofing c JOIN products p ON p.id = c.product_id LEFT JOIN users u ON u.id = c.updated_by ORDER BY p.name`,
    ),
    q<{ id: number; name: string }>("SELECT id, name FROM products WHERE active AND category IN ('finished','merchandise','other') ORDER BY is_frozen DESC, name"),
    locationsFor(user, ["store", "production"]),
    q<{ location_id: number; ready_time: string; capacity: number | null }>("SELECT location_id, to_char(ready_time, 'HH24:MI') ready_time, capacity FROM proofing_settings"),
  ]);
  const total = (c: { thaw: number; proof: number; bake: number }) => c.thaw + c.proof + c.bake;
  const h = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;

  return (
    <>
      <PageHeader
        title="Setări dospire"
        description="Duratele de decongelare, dospire și coacere pe produs și ora la care fiecare locație are nevoie de produse. Nimic nu este presupus fix: completați valorile validate în practică."
        actions={<Link href="/dospire" className="btn btn-ghost"><ArrowLeft className="size-4" />Plan dospire</Link>}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card title="Durate pe produs" subtitle={`${configs.length} produse configurate`} pad={false}>
            {configs.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Produs</th><th className="num">Decongelare</th><th className="num">Dospire</th><th className="num">Coacere</th><th className="num">Total</th><th>Stare</th><th>Actualizat</th></tr></thead>
                  <tbody>
                    {configs.map((c) => (
                      <tr key={c.product_id}>
                        <td className="font-medium text-ink">{c.name}{c.note && <div className="text-xs font-normal text-muted">{c.note}</div>}</td>
                        <td className="num">{c.thaw} min</td>
                        <td className="num">{c.proof} min</td>
                        <td className="num">{c.bake} min</td>
                        <td className="num font-medium">{h(total(c))}</td>
                        <td>{c.validated ? <Badge tone="good">validat</Badge> : <Badge tone="warn">orientativ</Badge>}</td>
                        <td className="text-xs text-muted">{c.updated_by ?? "—"}, {fmtDate(c.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="Nicio durată configurată">Adăugați primul produs din formularul alăturat.</EmptyState>}
          </Card>
          <Card title="Locații" subtitle="Ora „gata” este propusă la crearea fiecărui plan și poate fi schimbată pe plan" pad={false}>
            <table className="table">
              <thead><tr><th>Locație</th><th>Gata la</th><th>Capacitate dospitor (buc)</th><th></th></tr></thead>
              <tbody>
                {locations.map((l) => {
                  const s = settings.find((x) => x.location_id === l.id);
                  return (
                    <tr key={l.id}>
                      <td className="font-medium text-ink">{l.name}</td>
                      <td colSpan={3}>
                        <form action={saveLocationSettings} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="location_id" value={l.id} />
                          <input name="ready_time" type="time" defaultValue={s?.ready_time ?? "05:00"} className="input w-28 py-1" aria-label={`Ora gata ${l.name}`} />
                          <input name="capacity" inputMode="numeric" defaultValue={s?.capacity ?? ""} placeholder="nelimitat" className="input w-28 py-1 text-right" aria-label={`Capacitate ${l.name}`} />
                          <button className="btn btn-ghost px-2.5 py-1 text-xs">Salvează</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="space-y-4">
          {edit ? (
            <Card title="Adaugă / modifică durate" subtitle="Alegerea unui produs deja configurat îi actualizează duratele">
              <ProductConfigForm products={products} />
            </Card>
          ) : <Notice>Duratele sunt stabilite de responsabilul BRUTĂRIE.</Notice>}
          <Notice title="Cum se calculează orele">
            Pornind de la ora „gata”: ora intrării la cuptor = gata − coacere; intrarea în dospitor = cuptor − dospire; scoaterea din congelator = dospitor − decongelare.
          </Notice>
        </div>
      </div>
    </>
  );
}
