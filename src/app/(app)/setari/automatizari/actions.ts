"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getSetting } from "@/lib/invoices";
import { DEFAULT_AUTOMATION, type AutomationSettings } from "@/lib/alerts";
import { runAlerts, runDailyReport, runMonthlyReport } from "@/lib/jobs";
import { sendWebhook } from "@/lib/notify";

export type FormState = { ok?: string; error?: string };
const hhmm = (v: FormDataEntryValue | null) => /^\d{2}:\d{2}$/.test(String(v)) ? String(v) : null;
const int = (v: FormDataEntryValue | null, min: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

export async function saveAutomation(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser("settings");
  const cfg: AutomationSettings = {
    daily_report_time: hhmm(form.get("daily_report_time")) ?? DEFAULT_AUTOMATION.daily_report_time,
    monthly_report_time: hhmm(form.get("monthly_report_time")) ?? DEFAULT_AUTOMATION.monthly_report_time,
    alerts_every_min: int(form.get("alerts_every_min"), 5, 240) ?? DEFAULT_AUTOMATION.alerts_every_min,
    agent_offline_min: int(form.get("agent_offline_min"), 10, 600) ?? DEFAULT_AUTOMATION.agent_offline_min,
    business_from: int(form.get("business_from"), 0, 23) ?? DEFAULT_AUTOMATION.business_from,
    business_to: int(form.get("business_to"), 1, 24) ?? DEFAULT_AUTOMATION.business_to,
  };
  if (cfg.business_from >= cfg.business_to) return { error: "Programul locațiilor: ora de început trebuie să fie înaintea celei de sfârșit." };
  await q("INSERT INTO app_settings (key, value) VALUES ('automation', $1::text::jsonb) ON CONFLICT (key) DO UPDATE SET value=$1::text::jsonb", [JSON.stringify(cfg)]);
  await audit({ userId: user.id, action: "settings.automation", details: cfg });
  revalidatePath("/setari/automatizari");
  return { ok: "Setările au fost salvate." };
}

export async function saveWebhook(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser("settings");
  const url = String(form.get("url") ?? "").trim();
  if (url && !/^https?:\/\/\S+$/.test(url)) return { error: "Adresa webhook trebuie să înceapă cu https:// (sau http:// pentru teste locale)." };
  const current = await getSetting<{ url: string; secret: string }>("webhook", { url: "", secret: "" });
  const secret = form.get("regenerate") === "1" || !current.secret ? crypto.randomBytes(24).toString("base64url") : current.secret;
  await q("INSERT INTO app_settings (key, value) VALUES ('webhook', $1::text::jsonb) ON CONFLICT (key) DO UPDATE SET value=$1::text::jsonb", [JSON.stringify({ url, secret })]);
  await audit({ userId: user.id, action: "settings.webhook", details: { url, regenerated: secret !== current.secret } });
  revalidatePath("/setari/automatizari");
  return { ok: url ? "Webhook salvat." : "Webhook dezactivat." };
}

export async function testWebhook(_: FormState): Promise<FormState> {
  await requireUser("settings");
  const r = await sendWebhook("test", { message: "Test din BakeryOps" });
  return r === "ok" ? { ok: "Webhook-ul a răspuns cu succes." } : { error: `Webhook: ${r === "not_configured" ? "neconfigurat" : r}` };
}

export async function runNow(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser("settings");
  const job = String(form.get("job"));
  const r = job === "alerts" ? await runAlerts("manual") : job === "daily_report" ? await runDailyReport("manual") : job === "monthly_report" ? await runMonthlyReport("manual") : null;
  if (!r) return { error: "Sarcină necunoscută." };
  await audit({ userId: user.id, action: "job.run_manual", details: { job, ...r } });
  revalidatePath("/", "layout");
  return r.ok ? { ok: r.message } : { error: r.message };
}
