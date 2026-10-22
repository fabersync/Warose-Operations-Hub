import Link from "next/link";
import { requireUser, ROLE_LABELS } from "@/lib/auth";
import { q } from "@/lib/db";
import { relativeTime } from "@/lib/format";
import { Badge, Card, PageHeader } from "@/components/ui";
import { createLocation, mapAlias, toggleAgent, toggleUser } from "./actions";
import { AgentForm, ResetPassword, UserForm } from "./Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setări" };

const KIND_LABELS: Record<string, string> = { store: "Magazin", production: "Producție", freezer: "Congelator", warehouse: "Depozit" };

export default async function SettingsPage() {
  const me = await requireUser("settings");
  const [locations, aliases, users, agents] = await Promise.all([
    q<{ id: number; code: string; name: string; kind: string; active: boolean }>("SELECT id, code, name, kind, active FROM locations ORDER BY id"),
    q<{ id: number; source: string; alias: string; location_id: number | null }>("SELECT id, source, alias, location_id FROM location_aliases ORDER BY location_id NULLS FIRST, alias"),
    q<{ id: number; name: string; email: string; role: keyof typeof ROLE_LABELS; active: boolean; locs: string | null }>(
      `SELECT u.id, u.name, u.email, u.role, u.active,
              (SELECT string_agg(l.name, ', ' ORDER BY l.id) FROM user_locations ul JOIN locations l ON l.id = ul.location_id WHERE ul.user_id = u.id) locs
         FROM users u ORDER BY u.active DESC, u.name`,
    ),
    q<{ id: number; name: string; location: string; active: boolean; last_seen_at: string | null; agent_version: string | null }>(
      "SELECT a.id, a.name, l.name location, a.active, a.last_seen_at, a.agent_version FROM sync_agents a JOIN locations l ON l.id=a.location_id ORDER BY a.id",
    ),
  ]);
  // Agenții pot fi pe calculatoarele magazinelor (Publine) sau pe cel cu SAGA (e-Factura, de regulă la BRUTĂRIE).
  const stores = locations.filter((l) => l.kind !== "freezer" && l.active);

  return (
    <>
      <PageHeader title="Setări" description="Locații, utilizatori și permisiuni, agenți de sincronizare. Toate modificările sunt înregistrate în jurnalul de audit."
        actions={<Link href="/setari/automatizari" className="btn btn-ghost">Automatizări, alerte și rapoarte</Link>} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Locații și gestiuni" subtitle="Locațiile noi se adaugă fără modificarea aplicației" pad={false}>
          <table className="table">
            <thead><tr><th>Cod</th><th>Denumire</th><th>Tip</th></tr></thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id}><td className="font-mono text-xs">{l.code}</td><td className="font-medium text-ink">{l.name}</td><td><Badge>{KIND_LABELS[l.kind]}</Badge></td></tr>
              ))}
            </tbody>
          </table>
          <form action={createLocation} className="grid gap-2 border-t border-line p-4 sm:grid-cols-[110px_1fr_140px_auto]">
            <input name="code" placeholder="COD" required className="input" aria-label="Cod" />
            <input name="name" placeholder="Denumire locație nouă" required className="input" aria-label="Denumire" />
            <select name="kind" className="input" aria-label="Tip">{Object.entries(KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button className="btn btn-ghost">Adaugă</button>
          </form>
        </Card>

        <Card title="Asocieri cu sistemele externe" subtitle="Cum se numește fiecare locație în Publine și SAGA C" pad={false}>
          <table className="table">
            <thead><tr><th>Sursă</th><th>Denumire în sursă</th><th>Locație în aplicație</th></tr></thead>
            <tbody>
              {aliases.map((a) => (
                <tr key={a.id}>
                  <td className="text-xs uppercase text-muted">{a.source}</td>
                  <td className="font-mono text-xs text-ink">{a.alias}{!a.location_id && <span className="ml-2"><Badge tone="warn">neasociat</Badge></span>}</td>
                  <td>
                    <form action={mapAlias} className="flex gap-1.5">
                      <input type="hidden" name="alias_id" value={a.id} />
                      <select name="location_id" defaultValue={a.location_id ?? ""} className="input py-1 text-xs">
                        <option value="">— neasociat —</option>
                        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                      <button className="btn btn-ghost px-2 py-1 text-xs">Salvează</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Agenți de sincronizare Publine" subtitle="Un agent pe fiecare calculator care rulează Publine">
          <ul className="mb-5 divide-y divide-line text-sm">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <div className="font-medium text-ink">{a.name}</div>
                  <div className="text-xs text-muted">{a.location} · semnal {relativeTime(a.last_seen_at)}{a.agent_version && ` · v${a.agent_version}`}</div>
                </div>
                <form action={toggleAgent} className="flex items-center gap-2">
                  <Badge tone={a.active ? "good" : "neutral"}>{a.active ? "Activ" : "Revocat"}</Badge>
                  <input type="hidden" name="agent_id" value={a.id} />
                  <button className={`btn px-2.5 py-1 text-xs ${a.active ? "btn-danger" : "btn-ghost"}`}>{a.active ? "Revocă" : "Reactivează"}</button>
                </form>
              </li>
            ))}
            {!agents.length && <li className="py-2 text-muted">Niciun agent încă.</li>}
          </ul>
          <AgentForm locations={stores} />
        </Card>

        <Card title="Utilizatori și roluri" subtitle="Fiecare persoană are cont propriu; vede doar locațiile permise">
          <ul className="mb-5 divide-y divide-line text-sm">
            {users.map((u) => (
              <li key={u.id} className={`flex items-center justify-between gap-3 py-2.5 ${u.active ? "" : "opacity-50"}`}>
                <div className="min-w-0">
                  <div className="font-medium text-ink">{u.name} <span className="font-normal text-muted">· {u.email}</span></div>
                  <div className="text-xs text-muted">{ROLE_LABELS[u.role]}{u.locs && ` · ${u.locs}`}</div>
                </div>
                {u.id !== me.id && (
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <ResetPassword userId={u.id} />
                  <form action={toggleUser}>
                    <input type="hidden" name="user_id" value={u.id} />
                    <button className={`btn px-2.5 py-1 text-xs ${u.active ? "btn-danger" : "btn-ghost"}`}>{u.active ? "Dezactivează" : "Activează"}</button>
                  </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <UserForm locations={locations.filter((l) => l.active)} roles={Object.entries(ROLE_LABELS)} />
        </Card>
      </div>
    </>
  );
}
