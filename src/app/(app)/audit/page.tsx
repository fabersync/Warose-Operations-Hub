import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jurnal audit" };

export default async function AuditPage() {
  await requireUser("audit");
  const rows = await q<{ id: number; at: string; who: string | null; action: string; entity: string | null; entity_id: string | null; details: unknown }>(
    `SELECT a.id, a.at, coalesce(u.name, 'Agent · ' || s.name) who, a.action, a.entity, a.entity_id, a.details
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN sync_agents s ON s.id = a.agent_id
      ORDER BY a.id DESC LIMIT 300`,
  );
  return (
    <>
      <PageHeader title="Jurnal audit" description="Cine a făcut ce și când — autentificări, importuri, mișcări de stoc, modificări de setări. Jurnalul nu poate fi editat din aplicație." />
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Moment</th><th>Utilizator</th><th>Acțiune</th><th>Obiect</th><th>Detalii</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(r.at)}</td>
                  <td className="whitespace-nowrap">{r.who ?? "—"}</td>
                  <td className="font-mono text-xs text-ink">{r.action}</td>
                  <td className="text-xs text-muted">{r.entity ? `${r.entity} #${r.entity_id}` : "—"}</td>
                  <td className="max-w-[420px] truncate font-mono text-[11px] text-muted" title={r.details ? JSON.stringify(r.details) : ""}>{r.details ? JSON.stringify(r.details) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
