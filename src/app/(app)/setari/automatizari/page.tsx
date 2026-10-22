import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { getSetting } from "@/lib/invoices";
import { DEFAULT_AUTOMATION, type AutomationSettings } from "@/lib/alerts";
import { emailMode } from "@/lib/notify";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { RunNow, ScheduleForm, WebhookForm } from "./Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Automatizări" };

const JOB_LABEL: Record<string, string> = { alerts: "Verificare alerte", daily_report: "Raport zilnic", monthly_report: "Raport lunar" };

export default async function AutomationPage() {
  await requireUser("settings");
  const [cfg, webhook, runs] = await Promise.all([
    getSetting<Partial<AutomationSettings>>("automation", {}),
    getSetting<{ url: string; secret: string }>("webhook", { url: "", secret: "" }),
    q<{ id: number; job: string; trigger: string; started_at: string; finished_at: string | null; status: string; message: string | null }>(
      "SELECT id, job, trigger, started_at, finished_at, status, message FROM job_runs ORDER BY id DESC LIMIT 40"),
  ]);
  const mail = emailMode();

  return (
    <>
      <PageHeader title="Automatizări" description="Alertele și rapoartele rulează automat. Aici se stabilesc orele, canalele de trimitere și se vede jurnalul fiecărei rulări."
        actions={<Link href="/setari" className="btn btn-ghost"><ArrowLeft className="size-4" />Setări</Link>} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card title="Programare"><ScheduleForm cfg={{ ...DEFAULT_AUTOMATION, ...cfg }} /></Card>
          <Card title="Jurnal rulări" subtitle="Ultimele 40" pad={false}>
            <table className="table">
              <thead><tr><th>Sarcină</th><th>Pornită</th><th>Sursă</th><th>Stare</th><th>Rezultat</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-ink">{JOB_LABEL[r.job] ?? r.job}</td>
                    <td className="whitespace-nowrap text-xs">{fmtDateTime(r.started_at)}</td>
                    <td className="text-xs">{r.trigger === "scheduler" ? "automat" : r.trigger === "cron" ? "cron extern" : "manual"}</td>
                    <td>{r.status === "ok" ? <Badge tone="good">OK</Badge> : r.status === "error" ? <Badge tone="bad">Eroare</Badge> : <Badge tone="info">Rulează</Badge>}</td>
                    <td className="max-w-[380px] text-xs text-muted">{r.message}</td>
                  </tr>
                ))}
                {!runs.length && <tr><td colSpan={5} className="text-center text-muted">Nicio rulare încă.</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Rulează acum">
            <div className="space-y-2">
              <RunNow job="alerts" label="Verifică alertele" />
              <RunNow job="daily_report" label="Generează raportul zilnic" />
              <RunNow job="monthly_report" label="Generează raportul lunii trecute" />
            </div>
          </Card>
          <Card title="Email">
            {mail === "smtp"
              ? <Notice tone="good">SMTP configurat: emailurile se trimit către adresele utilizatorilor.</Notice>
              : <Notice tone="warn" title="SMTP neconfigurat">Emailurile sunt salvate local în <code>.data/outbox</code>. Pentru trimitere reală setați SMTP_URL și MAIL_FROM la găzduire.</Notice>}
          </Card>
          <Card title="Webhook pentru n8n / Make" subtitle="Evenimente: alerts, daily_report, monthly_report, test">
            <WebhookForm url={webhook.url} secret={webhook.secret} />
            <p className="mt-3 text-xs text-muted">n8n / Make primesc evenimentele și le pot trimite pe WhatsApp, Telegram sau SMS. Logica și datele rămân în aplicație; automatizările externe doar livrează mesajele.</p>
          </Card>
          <Card title="Cron extern (în cloud)">
            <p className="text-sm text-ink-2">Pe lângă planificatorul intern, găzduirea sau n8n pot apela la fiecare 5 minute:</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-canvas p-3 text-xs">POST /api/cron/run{"\n"}Authorization: Bearer CRON_SECRET</pre>
            <p className="mt-2 text-xs text-muted">Apelurile repetate sunt sigure: rapoartele nu se generează de două ori, iar alertele nu se retrimit.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
