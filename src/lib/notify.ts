import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { q } from "./db";
import { getSetting } from "./invoices";
import type { Role } from "./auth";

/**
 * Livrarea notificărilor:
 * - în aplicație (clopoțelul) — întotdeauna;
 * - email — prin SMTP (SMTP_URL, MAIL_FROM); fără SMTP configurat, mesajele se scriu în .data/outbox (pentru verificare locală);
 * - webhook — un POST JSON semnat către n8n / Make, care poate trimite mai departe pe WhatsApp, Telegram, SMS etc.
 */

export interface Recipient { id: number; name: string; email: string; role: Role; locationIds: number[] | null; emailAlerts: boolean; emailReports: boolean; minSeverity: string }

export async function recipients(roles: Role[], locationId: number | null | undefined): Promise<Recipient[]> {
  const users = await q<{ id: number; name: string; email: string; role: Role; locs: number[] | null; email_alerts: boolean | null; email_reports: boolean | null; min_severity: string | null }>(
    `SELECT u.id, u.name, u.email, u.role,
            (SELECT array_agg(location_id) FROM user_locations ul WHERE ul.user_id = u.id) locs,
            p.email_alerts, p.email_reports, p.min_severity
       FROM users u LEFT JOIN notification_prefs p ON p.user_id = u.id WHERE u.active`);
  return users
    .filter((u) => u.role === "admin" || roles.includes(u.role))
    .map((u) => ({
      id: u.id, name: u.name, email: u.email, role: u.role,
      locationIds: u.role === "admin" || u.role === "accounting" ? null : u.locs ?? [],
      emailAlerts: u.email_alerts ?? true, emailReports: u.email_reports ?? true, minSeverity: u.min_severity ?? "warn",
    }))
    .filter((u) => u.locationIds === null || locationId == null || u.locationIds.includes(locationId));
}

const RANK: Record<string, number> = { info: 0, warn: 1, bad: 2 };
export const severityAtLeast = (s: string, min: string) => (RANK[s] ?? 0) >= (RANK[min] ?? 1);

let transport: nodemailer.Transporter | null | undefined;
function mailer() {
  if (transport === undefined) transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
  return transport;
}
export const emailMode = () => (process.env.SMTP_URL ? "smtp" : "outbox");

/** Trimite un email; returnează starea, pentru jurnal. Nu aruncă: o problemă de email nu oprește alertele. */
export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<string> {
  const from = process.env.MAIL_FROM || "BakeryOps <no-reply@localhost>";
  try {
    const t = mailer();
    if (t) {
      await t.sendMail({ from, to, subject, html, text });
      return "sent";
    }
    const dir = path.join(process.cwd(), ".data", "outbox");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}.eml`);
    await fs.writeFile(file, `From: ${from}\nTo: ${to}\nSubject: ${subject}\nContent-Type: text/html; charset=utf-8\n\n${html}`);
    return "outbox";
  } catch (e) {
    return `error: ${(e as Error).message}`.slice(0, 200);
  }
}

/** POST către webhook-ul configurat (n8n / Make), semnat HMAC-SHA256 în antetul X-BakeryOps-Signature. */
export async function sendWebhook(event: string, payload: unknown): Promise<string> {
  const cfg = await getSetting<{ url: string; secret: string }>("webhook", { url: "", secret: "" });
  if (!cfg.url) return "not_configured";
  const body = JSON.stringify({ event, sent_at: new Date().toISOString(), data: payload });
  const signature = crypto.createHmac("sha256", cfg.secret || "").update(body).digest("hex");
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BakeryOps-Event": event, "X-BakeryOps-Signature": `sha256=${signature}` },
      body,
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? "ok" : `http ${res.status}`;
  } catch (e) {
    return `error: ${(e as Error).message}`.slice(0, 200);
  }
}

export async function notifyUser(userId: number, n: { kind: "alert" | "report" | "info"; severity: string; title: string; body?: string | null; link?: string | null; alertKey?: string | null; emailStatus?: string | null }) {
  await q(
    "INSERT INTO notifications (user_id, kind, severity, alert_key, title, body, link, email_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [userId, n.kind, n.severity, n.alertKey ?? null, n.title, n.body ?? null, n.link ?? null, n.emailStatus ?? null],
  );
}

export function appUrl(link: string) {
  return `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}${link}`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Șablon de email sobru, cu stiluri inline (clienții de email ignoră CSS-ul extern). */
export function emailLayout(title: string, intro: string, rowsHtml: string, cta?: { label: string; link: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1d1b18">
<div style="max-width:640px;margin:0 auto;padding:28px 16px">
  <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a5a2e;font-weight:600">BakeryOps</div>
  <h1 style="font-size:22px;margin:6px 0 4px">${esc(title)}</h1>
  <p style="margin:0 0 18px;color:#7c766d;font-size:14px">${esc(intro)}</p>
  <div style="background:#fff;border:1px solid #e8e5df;border-radius:12px;padding:18px">${rowsHtml}</div>
  ${cta ? `<p style="margin:20px 0"><a href="${esc(appUrl(cta.link))}" style="background:#1d1b18;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">${esc(cta.label)}</a></p>` : ""}
  <p style="font-size:12px;color:#a8a198">Mesaj automat. Preferințele de notificare se schimbă din aplicație → Notificări.</p>
</div></body></html>`;
}
export { esc };
