"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { one } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const MAX_FAILED = 8;      // încercări greșite permise
const WINDOW_MIN = 15;     // în intervalul (minute)

export async function login(_: unknown, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Introduceți emailul și parola." };

  // Protecție împotriva ghicirii parolei: blocare temporară după prea multe încercări greșite pentru același email.
  const failed = (await one<{ n: number }>(
    `SELECT count(*)::int n FROM audit_log WHERE action = 'auth.login_failed' AND details->>'email' = $1
       AND at > now() - make_interval(mins => $2)`, [email, WINDOW_MIN]))!.n;
  if (failed >= MAX_FAILED) {
    await audit({ action: "auth.login_blocked", details: { email } });
    return { error: `Prea multe încercări greșite. Încercați din nou peste ${WINDOW_MIN} minute.` };
  }

  const u = await one<{ id: number; password_hash: string; active: boolean; session_version: number }>(
    "SELECT id, password_hash, active, session_version FROM users WHERE email=$1",
    [email],
  );
  const ok = u && u.active && (await bcrypt.compare(password, u.password_hash));
  if (!ok) {
    await audit({ userId: u?.id ?? null, action: "auth.login_failed", details: { email } });
    return { error: "Email sau parolă incorectă." };
  }
  await createSession(u!.id, u!.session_version);
  await audit({ userId: u!.id, action: "auth.login" });
  redirect("/");
}
