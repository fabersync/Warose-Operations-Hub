"use server";
import bcrypt from "bcryptjs";
import { requireUser, createSession } from "@/lib/auth";
import { one } from "@/lib/db";
import { audit } from "@/lib/audit";

export type PwState = { ok?: string; error?: string };

export async function changePassword(_: PwState, form: FormData): Promise<PwState> {
  const user = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next.length < 10) return { error: "Parola nouă trebuie să aibă minimum 10 caractere." };
  if (next !== String(form.get("confirm") ?? "")) return { error: "Parolele noi nu coincid." };
  const u = await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=$1", [user.id]);
  if (!u || !(await bcrypt.compare(current, u.password_hash))) return { error: "Parola actuală este greșită." };
  if (await bcrypt.compare(next, u.password_hash)) return { error: "Parola nouă trebuie să fie diferită de cea actuală." };
  // Noua versiune de sesiune închide celelalte sesiuni; sesiunea curentă este reînnoită.
  const r = await one<{ session_version: number }>(
    "UPDATE users SET password_hash=$2, session_version = session_version + 1 WHERE id=$1 RETURNING session_version",
    [user.id, await bcrypt.hash(next, 12)]);
  await createSession(user.id, r!.session_version);
  await audit({ userId: user.id, action: "auth.password_changed" });
  return { ok: "Parola a fost schimbată." };
}
