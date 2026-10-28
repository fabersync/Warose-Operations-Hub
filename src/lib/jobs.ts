import "server-only";
import { one, q } from "./db";
import { addDays } from "./format";
import { computeAlerts, DEFAULT_AUTOMATION, nowLocal, type AutomationSettings } from "./alerts";
import { getSetting } from "./invoices";
import { emailLayout, esc, notifyUser, recipients, sendEmail, sendWebhook, severityAtLeast } from "./notify";
import { buildDailyReport, buildMonthlyReport, dailyEmailRows, monthlyEmailRows, monthTitle } from "./reports";

export type JobName = "alerts" | "daily_report" | "monthly_report";
export type Trigger = "scheduler" | "cron" | "manual";

/** Rulează o sarcină cu înregistrare în jurnal (job_runs): început, sfârșit, rezultat sau eroare. */
async function logged(job: string, trigger: Trigger, fn: () => Promise<string>) {
  const run = await one<{ id: number }>("INSERT INTO job_runs (job, trigger) VALUES ($1,$2) RETURNING id", [job, trigger]);
  try {
    const message = await fn();
    await q("UPDATE job_runs SET status='ok', finished_at=now(), message=$2 WHERE id=$1", [run!.id, message]);
    return { ok: true, message };
  } catch (e) {
    const message = (e as Error).message;
    await q("UPDATE job_runs SET status='error', finished_at=now(), message=$2 WHERE id=$1", [run!.id, message]);
    return { ok: false, message };
  }
}

/**
 * Evaluează regulile de alertă. O alertă nouă (sau reapărută după rezolvare) produce o singură notificare
 * pentru fiecare persoană responsabilă, plus email (după preferințe) și un eveniment webhook.
 */
export async function runAlerts(trigger: Trigger) {
  return logged("alerts", trigger, async () => {
    const alerts = await computeAlerts();
    const keys = alerts.map((a) => a.key);
    let created = 0, emails = 0;
    const fresh = [];
    for (const a of alerts) {
      const prev = await one<{ resolved_at: string | null; notified_at: string | null }>("SELECT resolved_at, notified_at FROM alert_state WHERE key=$1", [a.key]);
      await q(
        `INSERT INTO alert_state (key, severity, title, detail, link, roles, location_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (key) DO UPDATE SET severity=$2, title=$3, detail=$4, link=$5, roles=$6, location_id=$7, last_seen=now(),
           resolved_at=NULL, first_seen = CASE WHEN alert_state.resolved_at IS NOT NULL THEN now() ELSE alert_state.first_seen END`,
        [a.key, a.severity, a.title, a.detail ?? null, a.link, a.roles, a.locationId ?? null]);
      if (prev && !prev.resolved_at && prev.notified_at) continue; // deja anunțată și încă activă
      fresh.push(a);
      for (const r of await recipients(a.roles, a.locationId)) {
        let emailStatus: string | null = null;
        if (r.emailAlerts && severityAtLeast(a.severity, r.minSeverity)) {
          emailStatus = await sendEmail(r.email, `[BakeryOps] ${a.title}`,
            emailLayout(a.title, a.detail ?? "", `<p style="margin:0;font-size:14px">${esc(a.detail ?? a.title)}</p>`, { label: "Deschide în aplicație", link: a.link }),
            `${a.title}\n${a.detail ?? ""}`);
          emails++;
        }
        await notifyUser(r.id, { kind: "alert", severity: a.severity, title: a.title, body: a.detail, link: a.link, alertKey: a.key, emailStatus });
        created++;
      }
      await q("UPDATE alert_state SET notified_at=now() WHERE key=$1", [a.key]);
    }
    const resolved = await q<{ key: string; title: string }>(
      "UPDATE alert_state SET resolved_at=now() WHERE resolved_at IS NULL AND NOT (key = ANY($1::text[])) RETURNING key, title", [keys]);
    let hook = "fără evenimente";
    if (fresh.length || resolved.length) {
      hook = await sendWebhook("alerts", {
        new: fresh.map((a) => ({ key: a.key, severity: a.severity, title: a.title, detail: a.detail, link: a.link })),
        resolved: resolved.map((r) => ({ key: r.key, title: r.title })),
      });
    }
    return `${alerts.length} active, ${fresh.length} noi, ${resolved.length} rezolvate · ${created} notificări, ${emails} emailuri · webhook: ${hook}`;
  });
}

export async function runDailyReport(trigger: Trigger, today = nowLocal().date) {
  return logged("daily_report", trigger, async () => {
    const report = await buildDailyReport(today);
    const saved = await one<{ id: number }>(
      `INSERT INTO reports (kind, period_from, period_to, title, data) VALUES ('daily', $1, $1, $2, $3::text::jsonb)
       ON CONFLICT (kind, period_from) DO UPDATE SET data = $3::text::jsonb, created_at = now() RETURNING id`,
      [report.date, `Raport zilnic · ${report.date.split("-").reverse().join(".")}`, JSON.stringify(report)]);
    const link = `/rapoarte/${saved!.id}`;
    const total = report.locations.reduce((s, l) => s + l.net, 0);
    const title = `Raportul zilei ${report.date.split("-").reverse().join(".")}`;
    const intro = `Vânzări nete ${new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", maximumFractionDigits: 0 }).format(total)} · ${report.alerts.length} alerte active`;
    let sent = 0;
    for (const r of await recipients(["admin", "accounting", "location_manager", "production"], null)) {
      const status = r.emailReports ? await sendEmail(r.email, `[BakeryOps] ${title}`, emailLayout(title, intro, dailyEmailRows(report), { label: "Raportul complet", link }), `${title}\n${intro}`) : null;
      if (status) sent++;
      await notifyUser(r.id, { kind: "report", severity: "info", title, body: intro, link, emailStatus: status });
    }
    const hook = await sendWebhook("daily_report", { ...report, link });
    return `Raport ${report.date} · ${sent} emailuri · webhook: ${hook}`;
  });
}

export async function runMonthlyReport(trigger: Trigger, month?: string) {
  const m = month ?? addDays(`${nowLocal().date.slice(0, 7)}-01`, -1).slice(0, 7); // implicit: luna încheiată
  return logged("monthly_report", trigger, async () => {
    const report = await buildMonthlyReport(m);
    const last = addDays(`${addDays(`${m}-28`, 7).slice(0, 7)}-01`, -1);
    const saved = await one<{ id: number }>(
      `INSERT INTO reports (kind, period_from, period_to, title, data) VALUES ('monthly', $1, $2, $3, $4::text::jsonb)
       ON CONFLICT (kind, period_from) DO UPDATE SET data = $4::text::jsonb, created_at = now() RETURNING id`,
      [`${m}-01`, last, `Raport lunar · ${monthTitle(m)}`, JSON.stringify(report)]);
    const link = `/rapoarte/${saved!.id}`;
    const title = `Raportul lunii ${monthTitle(m)}`;
    const intro = "Vânzări, costuri și rezultat estimat pe locații. Exportul pentru planul de business este atașat în aplicație.";
    let sent = 0;
    for (const r of await recipients(["admin", "accounting"], null)) {
      const status = r.emailReports ? await sendEmail(r.email, `[BakeryOps] ${title}`, emailLayout(title, intro, monthlyEmailRows(report), { label: "Raportul complet", link }), `${title}\n${intro}`) : null;
      if (status) sent++;
      await notifyUser(r.id, { kind: "report", severity: "info", title, body: intro, link, emailStatus: status });
    }
    const hook = await sendWebhook("monthly_report", { ...report, link, excel: `/api/export/costs?m=${m}` });
    return `Raport ${m} · ${sent} emailuri · webhook: ${hook}`;
  });
}

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/**
 * Un „tic” al planificatorului: rulează ce este scadent. Idempotent — poate fi apelat de oricâte ori
 * (planificatorul intern la fiecare minut, un cron extern sau n8n).
 */
export async function tick(trigger: Trigger) {
  const cfg: AutomationSettings = { ...DEFAULT_AUTOMATION, ...(await getSetting<Partial<AutomationSettings>>("automation", {})) };
  const now = nowLocal();
  const nowMin = now.hour * 60 + now.minute;
  const done: string[] = [];

  const lastAlerts = await one<{ mins: number }>(
    "SELECT (extract(epoch FROM now() - max(started_at)) / 60)::float8 mins FROM job_runs WHERE job='alerts'");
  if (lastAlerts?.mins == null || lastAlerts.mins >= cfg.alerts_every_min - 0.5) { await runAlerts(trigger); done.push("alerts"); }

  if (nowMin >= minutes(cfg.daily_report_time)) {
    const exists = await one("SELECT 1 FROM reports WHERE kind='daily' AND period_from = $1::date - 1", [now.date]);
    if (!exists) { await runDailyReport(trigger, now.date); done.push("daily_report"); }
  }
  if (nowMin >= minutes(cfg.monthly_report_time)) {
    const prev = addDays(`${now.date.slice(0, 7)}-01`, -1).slice(0, 7);
    const exists = await one("SELECT 1 FROM reports WHERE kind='monthly' AND period_from = $1::date", [`${prev}-01`]);
    if (!exists) { await runMonthlyReport(trigger, prev); done.push("monthly_report"); }
  }
  return done;
}

const g = globalThis as unknown as { __waroseScheduler?: NodeJS.Timeout; __waroseTickRunning?: boolean };

/** Planificatorul intern (pornit din instrumentation.ts). În cloud se poate înlocui cu un cron extern pe /api/cron/run. */
export function startScheduler() {
  if (g.__waroseScheduler) return;
  const run = async () => {
    if (g.__waroseTickRunning) return;
    g.__waroseTickRunning = true;
    try { await tick("scheduler"); } catch (e) { console.error("[scheduler]", e); } finally { g.__waroseTickRunning = false; }
  };
  g.__waroseScheduler = setInterval(run, 60_000);
  setTimeout(run, 15_000);
  console.log("[scheduler] pornit: alerte și rapoarte programate");
}
