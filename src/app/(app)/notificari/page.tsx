import Link from "next/link";
import { AlertTriangle, Bell, FileBarChart, Info, XCircle } from "lucide-react";
import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { one, q } from "@/lib/db";
import { fmtDateTime, relativeTime } from "@/lib/format";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { markRead, savePrefs } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notificări" };

const ICON = { bad: XCircle, warn: AlertTriangle, info: Info } as const;
const TONE = { bad: "text-bad", warn: "text-warn", info: "text-info" } as const;

export default async function NotificationsPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  const [items, prefs, active] = await Promise.all([
    q<{ id: number; kind: string; severity: keyof typeof ICON; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null; email_status: string | null }>(
      "SELECT id, kind, severity, title, body, link, created_at, read_at, email_status FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [user.id]),
    one<{ email_alerts: boolean; email_reports: boolean; min_severity: string }>("SELECT email_alerts, email_reports, min_severity FROM notification_prefs WHERE user_id=$1", [user.id]),
    q<{ key: string; severity: keyof typeof ICON; title: string; detail: string | null; link: string | null; first_seen: string; roles: string[]; location_id: number | null }>(
      `SELECT key, severity, title, detail, link, first_seen, roles, location_id FROM alert_state WHERE resolved_at IS NULL
        ORDER BY CASE severity WHEN 'bad' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, first_seen`),
  ]);
  const mine = active.filter((a) => (user.role === "admin" || a.roles.includes(user.role)) && (user.locationIds === null || a.location_id == null || user.locationIds.includes(a.location_id)));
  const unread = items.filter((i) => !i.read_at).length;

  return (
    <>
      <PageHeader title="Notificări" description="Alertele și rapoartele trimise automat de aplicație. Fiecare situație este anunțată o singură dată, cât timp rămâne nerezolvată."
        actions={unread > 0 ? <form action={markRead}><button className="btn btn-ghost">Marchează toate ca citite ({unread})</button></form> : undefined} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Mesaje" pad={false}>
          {items.length ? (
            <ul className="divide-y divide-line">
              {items.map((n) => {
                const Icon = n.kind === "report" ? FileBarChart : ICON[n.severity] ?? Info;
                return (
                  <li key={n.id} className={`flex gap-3 px-5 py-3.5 sm:px-6 ${n.read_at ? "" : "bg-crust-soft/30"}`}>
                    <Icon className={`mt-0.5 size-4 shrink-0 ${n.kind === "report" ? "text-crust" : TONE[n.severity] ?? "text-info"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink">{n.link ? <Link href={n.link} className="hover:text-crust">{n.title}</Link> : n.title}</div>
                      {n.body && <div className="mt-0.5 text-sm text-ink-2">{n.body}</div>}
                      <div className="mt-1 text-xs text-muted">{fmtDateTime(n.created_at)}{n.email_status && ` · email: ${n.email_status === "sent" ? "trimis" : n.email_status === "outbox" ? "salvat local (SMTP neconfigurat)" : n.email_status}`}</div>
                    </div>
                    {!n.read_at && <form action={markRead}><input type="hidden" name="id" value={n.id} /><button className="text-xs font-medium text-crust hover:text-crust-strong">Citit</button></form>}
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState icon={<Bell className="size-5" />} title="Nicio notificare încă">Alertele și rapoartele programate vor apărea aici.</EmptyState>}
        </Card>
        <div className="space-y-4">
          <Card title="Alerte active acum" subtitle={`${mine.length} situații care necesită atenție`}>
            {mine.length ? (
              <ul className="space-y-3 text-sm">
                {mine.map((a) => {
                  const Icon = ICON[a.severity];
                  return (
                    <li key={a.key} className="flex gap-2.5">
                      <Icon className={`mt-0.5 size-4 shrink-0 ${TONE[a.severity]}`} />
                      <div><Link href={a.link ?? "#"} className="font-medium text-ink hover:text-crust">{a.title}</Link><div className="text-xs text-muted">de {relativeTime(a.first_seen)}</div></div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-good">Nicio alertă activă.</p>}
          </Card>
          <Card title="Preferințe email">
            <form action={savePrefs} className="space-y-3 text-sm">
              <label className="flex items-center gap-2 text-ink-2"><input type="checkbox" name="email_alerts" defaultChecked={prefs?.email_alerts ?? true} className="accent-crust" />Alerte pe email</label>
              <div className="field">
                <label className="label" htmlFor="min_severity">Doar alertele de nivel</label>
                <select id="min_severity" name="min_severity" defaultValue={prefs?.min_severity ?? "warn"} className="input">
                  <option value="bad">Critice</option><option value="warn">Atenționări și critice</option><option value="info">Toate</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-ink-2"><input type="checkbox" name="email_reports" defaultChecked={prefs?.email_reports ?? true} className="accent-crust" />Rapoartele zilnice și lunare pe email</label>
              <p className="text-xs text-muted">Emailurile se trimit la {user.email}.</p>
              <button className="btn btn-ghost w-full">Salvează</button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
