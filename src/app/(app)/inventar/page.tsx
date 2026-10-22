import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { fmtDateTime, fmtRon } from "@/lib/format";
import { canManageInventory, listCounts } from "@/lib/inventory";
import { locationsFor } from "@/lib/queries";
import { Badge, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { StartForm } from "./Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inventar" };

export default async function InventoryPage() {
  const user = await requireUser("inventory");
  const [counts, locations] = await Promise.all([listCounts(user), locationsFor(user)]);
  const now = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date()).replace(" ", "T");

  return (
    <>
      <PageHeader
        title="Inventar"
        description="Inventarul lunar pe fiecare locație, numărat direct de pe telefon. La închidere, diferențele dintre stocul scriptic și cel faptic se înregistrează automat ca mișcări de stoc."
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Inventare" subtitle="Deschise, închise și anulate" pad={false}>
          {counts.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>#</th><th>Locație</th><th>Data inventarului</th><th>Stare</th><th className="num">Numărate</th><th className="num">Diferențe</th><th className="num">Valoare diferențe</th></tr></thead>
                <tbody>
                  {counts.map((c) => (
                    <tr key={c.id}>
                      <td className="text-muted tabular-nums">{c.id}</td>
                      <td><Link href={`/inventar/${c.id}`} className="font-medium text-ink hover:text-crust">{c.location}</Link><div className="text-xs text-muted">{c.started_by}</div></td>
                      <td className="whitespace-nowrap text-xs">{fmtDateTime(c.as_of)}</td>
                      <td>{c.status === "open" ? <Badge tone="info">În lucru</Badge> : c.status === "closed" ? <Badge tone="good">Închis</Badge> : <Badge>Anulat</Badge>}</td>
                      <td className="num">{c.counted}/{c.lines}</td>
                      <td className="num">{c.diff_lines}</td>
                      <td className="num">{c.status === "closed" ? <span className={(c.posted_value ?? 0) < 0 ? "text-bad" : ""}>{fmtRon(c.posted_value ?? 0, true)}</span> : <span className="text-muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<ClipboardCheck className="size-5" />} title="Niciun inventar încă">Începeți primul inventar din formularul alăturat. El va deveni punctul de plecare al stocului în fiecare locație.</EmptyState>
          )}
        </Card>
        <div className="space-y-4">
          {canManageInventory(user) ? (
            <Card title="Inventar nou"><StartForm locations={locations} defaultAsOf={now} /></Card>
          ) : (
            <Notice>Inventarul este deschis de managerul locației. Puteți număra din inventarul aflat „În lucru”.</Notice>
          )}
          <Notice title="Cum se calculează stocul scriptic">
            Din mișcările înregistrate până la data inventarului: recepții, transferuri, producție, pierderi și vânzările din Publine ale produselor marcate „stoc gestionat”. Este stocul operațional al aplicației, nu stocul contabil din SAGA C.
          </Notice>
        </div>
      </div>
    </>
  );
}
