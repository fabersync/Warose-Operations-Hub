import { CheckCircle2, AlertTriangle, XCircle, Copy, Loader2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDateTime, fmtLocalTs, fmtNum, fmtRon, relativeTime } from "@/lib/format";
import { locationsFor, syncStatus } from "@/lib/queries";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { UploadForm } from "./UploadForm";
import { retryImport } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Importuri" };

export default async function ImportsPage() {
  const user = await requireUser("imports");
  const [locations, sync, batches, errors] = await Promise.all([
    locationsFor(user, ["store"]),
    syncStatus(),
    q<{ id: number; file_name: string; status: string; rows_total: number; rows_inserted: number; rows_duplicate: number; rows_error: number; file_net_total: string | null; db_net_total: string | null; reconciled: boolean | null; period_from: string | null; period_to: string | null; error: string | null; created_at: string; warnings: string[]; source_label: string }>(
      `SELECT b.id, b.file_name, b.status, b.rows_total, b.rows_inserted, b.rows_duplicate, b.rows_error, b.file_net_total, b.db_net_total,
              b.reconciled, to_char(b.period_from,'YYYY-MM-DD HH24:MI:SS') period_from, to_char(b.period_to,'YYYY-MM-DD HH24:MI:SS') period_to,
              b.error, b.created_at, b.warnings,
              coalesce('Agent · ' || a.name, 'Manual · ' || u.name, '—') source_label
         FROM import_batches b LEFT JOIN sync_agents a ON a.id=b.agent_id LEFT JOIN users u ON u.id=b.user_id
        ORDER BY b.id DESC LIMIT 100`,
    ),
    q<{ batch_id: number; row_no: number; message: string }>(
      "SELECT batch_id, row_no, message FROM import_errors WHERE batch_id IN (SELECT id FROM import_batches ORDER BY id DESC LIMIT 100) ORDER BY batch_id DESC, row_no LIMIT 200",
    ),
  ]);

  return (
    <>
      <PageHeader
        title="Importuri & sincronizare"
        description="Exporturile Publine ajung aici automat prin agentul instalat în locație sau manual. Fiecare fișier este păstrat, verificat față de totalurile proprii și nu poate fi importat de două ori."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Import manual" subtitle="Pentru exporturi istorice sau când agentul nu este încă instalat">
          {locations.length ? <UploadForm locations={locations} /> : <p className="text-sm text-muted">Nu aveți acces la nicio locație de vânzare.</p>}
        </Card>
        <Card title="Agenți de sincronizare" subtitle="Calculatoarele cu Publine din locații">
          <ul className="space-y-3.5 text-sm">
            {sync.agents.map((a) => {
              const fresh = a.last_seen_at && Date.now() - new Date(a.last_seen_at).getTime() < 30 * 60000;
              return (
                <li key={a.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{a.name}</span>
                    <Badge tone={!a.active ? "neutral" : fresh ? "good" : "warn"}>{!a.active ? "Inactiv" : fresh ? "Online" : "Offline"}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{a.location} · ultimul semnal {relativeTime(a.last_seen_at)}</div>
                  <div className="text-xs text-muted">Ultima încărcare {relativeTime(a.last_upload_at)} · {a.last_status ?? "—"}</div>
                  {a.agent_status && (
                    <div className="mt-1 space-y-0.5 text-xs">
                      <div className="text-muted">v{a.agent_status.version} pe {a.agent_status.host} · în coadă {a.agent_status.queued ?? 0}{a.agent_status.rejected ? ` · respinse ${a.agent_status.rejected}` : ""}</div>
                      {a.agent_status.sources?.map((s) => (
                        <div key={s.type + s.folder} className={s.ok ? "text-ink-2" : "text-bad"}>
                          {s.type === "efactura" ? "e-Factura (SAGA)" : "Publine"}: {s.ok ? `${s.files ?? 0} fișiere în folder` : s.message} <span className="text-faint">· {s.folder}</span>
                        </div>
                      ))}
                      {a.agent_status.lastError && <div className="text-bad">Ultima eroare: {a.agent_status.lastError}</div>}
                    </div>
                  )}
                </li>
              );
            })}
            {!sync.agents.length && <li className="text-muted">Niciun agent. Creați unul din Setări → Agenți de sincronizare, apoi instalați-l pe calculatorul din locație.</li>}
          </ul>
        </Card>
      </div>

      <Card className="mt-4" title="Istoric importuri" subtitle="Ultimele 100 de fișiere primite" pad={false}>
        {batches.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>#</th><th>Fișier</th><th>Sursă</th><th>Perioadă</th><th className="num">Linii noi</th><th className="num">Ignorate</th><th className="num">Total fișier</th><th className="num">În sistem</th><th>Stare</th><th></th></tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const errs = errors.filter((e) => e.batch_id === b.id);
                  return (
                    <tr key={b.id}>
                      <td className="text-muted tabular-nums">{b.id}</td>
                      <td>
                        <div className="max-w-[260px] truncate font-medium text-ink" title={b.file_name}>{b.file_name}</div>
                        <div className="text-xs text-muted">{fmtDateTime(b.created_at)}</div>
                        {b.error && <div className="mt-1 max-w-[320px] text-xs text-bad">{b.error}</div>}
                        {b.warnings?.map((w) => <div key={w} className="mt-1 max-w-[320px] text-xs text-warn">{w}</div>)}
                        {errs.length > 0 && (
                          <details className="mt-1 text-xs text-bad">
                            <summary className="cursor-pointer">{b.rows_error} rânduri cu erori</summary>
                            <ul className="mt-1 space-y-0.5">{errs.slice(0, 15).map((e) => <li key={e.row_no}>Rândul {e.row_no}: {e.message}</li>)}</ul>
                          </details>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs">{b.source_label}</td>
                      <td className="whitespace-nowrap text-xs">{b.period_from ? <>{fmtLocalTs(b.period_from)}<br />{fmtLocalTs(b.period_to)}</> : "—"}</td>
                      <td className="num">{fmtNum(b.rows_inserted)}</td>
                      <td className="num text-muted">{fmtNum(b.rows_duplicate)}</td>
                      <td className="num">{b.file_net_total ? fmtRon(Number(b.file_net_total), true) : "—"}</td>
                      <td className="num">{b.db_net_total ? fmtRon(Number(b.db_net_total), true) : "—"}</td>
                      <td><StatusBadge status={b.status} reconciled={b.reconciled} /></td>
                      <td>
                        {b.status === "failed" && (
                          <form action={retryImport}><input type="hidden" name="batch_id" value={b.id} /><button className="btn btn-ghost px-2.5 py-1 text-xs">Reia</button></form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Niciun import încă">Primul export încărcat va apărea aici, împreună cu rezultatul verificării.</EmptyState>
        )}
      </Card>
    </>
  );
}

function StatusBadge({ status, reconciled }: { status: string; reconciled: boolean | null }) {
  if (status === "processing") return <Badge tone="info"><Loader2 className="size-3 animate-spin" />În lucru</Badge>;
  if (status === "failed") return <Badge tone="bad"><XCircle className="size-3" />Eșuat</Badge>;
  if (status === "duplicate") return <Badge><Copy className="size-3" />Duplicat blocat</Badge>;
  return reconciled ? <Badge tone="good"><CheckCircle2 className="size-3" />Reconciliat</Badge> : <Badge tone="warn"><AlertTriangle className="size-3" />De verificat</Badge>;
}
