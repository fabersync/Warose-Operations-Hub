"use server";
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth";
import { q } from "@/lib/db";

async function me() {
  const u = await getUser();
  if (!u) throw new Error("Neautentificat.");
  return u;
}

export async function markRead(form: FormData) {
  const u = await me();
  const id = Number(form.get("id")) || null;
  await q(id ? "UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = $2 AND read_at IS NULL"
             : "UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", id ? [u.id, id] : [u.id]);
  revalidatePath("/", "layout");
}

export async function savePrefs(form: FormData) {
  const u = await me();
  const min = String(form.get("min_severity") ?? "warn");
  await q(
    `INSERT INTO notification_prefs (user_id, email_alerts, email_reports, min_severity) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO UPDATE SET email_alerts=$2, email_reports=$3, min_severity=$4`,
    [u.id, form.get("email_alerts") === "on", form.get("email_reports") === "on", ["info", "warn", "bad"].includes(min) ? min : "warn"],
  );
  revalidatePath("/notificari");
}
