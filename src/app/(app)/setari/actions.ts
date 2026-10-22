"use server";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { one, q, tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashToken, newAgentToken } from "@/lib/agents";

const ROLES = ["admin", "production", "location_manager", "staff", "accounting"];
const KINDS = ["store", "production", "freezer", "warehouse"];

export async function createLocation(form: FormData) {
  const user = await requireUser("settings");
  const code = String(form.get("code") ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "");
  const name = String(form.get("name") ?? "").trim();
  const kind = String(form.get("kind"));
  if (!code || !name || !KINDS.includes(kind)) return;
  const l = await one<{ id: number }>("INSERT INTO locations (code, name, kind) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING RETURNING id", [code, name, kind]);
  if (l) await audit({ userId: user.id, action: "location.create", entity: "location", entityId: l.id, details: { code, name, kind } });
  revalidatePath("/", "layout");
}

export async function mapAlias(form: FormData) {
  const user = await requireUser("settings");
  const aliasId = Number(form.get("alias_id"));
  const locationId = Number(form.get("location_id")) || null;
  await q("UPDATE location_aliases SET location_id=$2 WHERE id=$1", [aliasId, locationId]);
  await audit({ userId: user.id, action: "location_alias.map", entity: "location_alias", entityId: aliasId, details: { locationId } });
  revalidatePath("/", "layout");
}

export type UserState = { ok?: string; error?: string };

export async function createUser(_: UserState, form: FormData): Promise<UserState> {
  const admin = await requireUser("settings");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const role = String(form.get("role"));
  const password = String(form.get("password") ?? "");
  const locationIds = form.getAll("locations").map(Number).filter(Boolean);
  if (!email.includes("@") || !name) return { error: "Completați numele și un email valid." };
  if (!ROLES.includes(role)) return { error: "Rol invalid." };
  if (password.length < 10) return { error: "Parola inițială trebuie să aibă minimum 10 caractere." };
  if (!["admin", "accounting"].includes(role) && !locationIds.length) return { error: "Alegeți cel puțin o locație pentru acest rol." };
  try {
    await tx(async (tq) => {
      const u = (await tq<{ id: number }>(
        "INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id",
        [email, name, await bcrypt.hash(password, 12), role],
      ))[0];
      for (const l of locationIds) await tq("INSERT INTO user_locations (user_id, location_id) VALUES ($1,$2)", [u.id, l]);
      await audit({ userId: admin.id, action: "user.create", entity: "user", entityId: u.id, details: { email, role, locationIds } }, tq);
    });
  } catch (e) {
    return { error: String(e).includes("unique") || String(e).includes("duplicate") ? "Există deja un utilizator cu acest email." : String(e) };
  }
  revalidatePath("/setari");
  return { ok: `Contul pentru ${name} a fost creat.` };
}

export async function toggleUser(form: FormData) {
  const admin = await requireUser("settings");
  const id = Number(form.get("user_id"));
  if (id === admin.id) return;
  // Dezactivarea invalidează imediat sesiunile existente (session_version).
  await q("UPDATE users SET active = NOT active, session_version = session_version + 1 WHERE id=$1", [id]);
  await audit({ userId: admin.id, action: "user.toggle_active", entity: "user", entityId: id });
  revalidatePath("/setari");
}

export type AgentState = { token?: string; name?: string; error?: string };

export async function createAgent(_: AgentState, form: FormData): Promise<AgentState> {
  const admin = await requireUser("settings");
  const name = String(form.get("name") ?? "").trim();
  const locationId = Number(form.get("location_id"));
  if (!name || !locationId) return { error: "Completați numele și locația." };
  const token = newAgentToken();
  const a = await one<{ id: number }>("INSERT INTO sync_agents (name, location_id, token_hash) VALUES ($1,$2,$3) RETURNING id", [name, locationId, hashToken(token)]);
  await audit({ userId: admin.id, action: "agent.create", entity: "sync_agent", entityId: a!.id, details: { name, locationId } });
  revalidatePath("/", "layout");
  return { token, name };
}

export async function toggleAgent(form: FormData) {
  const admin = await requireUser("settings");
  const id = Number(form.get("agent_id"));
  await q("UPDATE sync_agents SET active = NOT active WHERE id=$1", [id]);
  await audit({ userId: admin.id, action: "agent.toggle_active", entity: "sync_agent", entityId: id });
  revalidatePath("/", "layout");
}

export type ResetState = { password?: string; error?: string };

/** Resetare parolă de către administrator: parolă temporară afișată o singură dată; sesiunile utilizatorului se închid. */
export async function resetPassword(_: ResetState, form: FormData): Promise<ResetState> {
  const admin = await requireUser("settings");
  const id = Number(form.get("user_id"));
  if (!id) return { error: "Utilizator invalid." };
  const crypto = await import("node:crypto");
  const password = crypto.randomBytes(9).toString("base64url");
  const r = await q("UPDATE users SET password_hash=$2, session_version = session_version + 1 WHERE id=$1 RETURNING id", [id, await bcrypt.hash(password, 12)]);
  if (!r.length) return { error: "Utilizatorul nu există." };
  await audit({ userId: admin.id, action: "user.password_reset", entity: "user", entityId: id });
  return { password };
}
