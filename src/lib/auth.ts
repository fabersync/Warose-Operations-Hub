import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { one, q } from "./db";

export const SESSION_COOKIE = "warose_session";

export type Role = "admin" | "production" | "location_manager" | "staff" | "accounting";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  production: "Responsabil BRUTĂRIE",
  location_manager: "Manager de locație",
  staff: "Personal operațional",
  accounting: "Contabilitate",
};

/** Ce module vede fiecare rol. Administratorul vede tot. */
export const MODULE_ACCESS: Record<string, Role[]> = {
  dashboard: ["admin", "production", "location_manager", "accounting"],
  sales: ["admin", "location_manager", "accounting"],
  stock: ["admin", "production", "location_manager", "staff", "accounting"],
  freezer: ["admin", "production", "location_manager", "staff"],
  inventory: ["admin", "production", "location_manager", "staff", "accounting"],
  production: ["admin", "production", "accounting"],
  orders: ["admin", "production", "location_manager", "staff"],
  purchasing: ["admin", "production", "location_manager", "accounting"],
  proofing: ["admin", "production", "location_manager", "staff"],
  invoices: ["admin", "accounting"],
  profitability: ["admin", "accounting"],
  imports: ["admin", "accounting"],
  products: ["admin", "production", "accounting"],
  settings: ["admin"],
  audit: ["admin"],
};

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  /** null = toate locațiile */
  locationIds: number[] | null;
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET lipsește sau este prea scurt (min. 32 caractere).");
  return new TextEncoder().encode(s);
}

export async function createSession(userId: number, sessionVersion: number) {
  const token = await new SignJWT({ v: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const u = await one<{ id: number; email: string; name: string; role: Role; session_version: number; active: boolean }>(
      "SELECT id, email, name, role, session_version, active FROM users WHERE id = $1",
      [Number(payload.sub)],
    );
    if (!u || !u.active || u.session_version !== payload.v) return null;
    let locationIds: number[] | null = null;
    if (u.role !== "admin" && u.role !== "accounting") {
      locationIds = (await q<{ location_id: number }>("SELECT location_id FROM user_locations WHERE user_id = $1", [u.id]))
        .map((r) => r.location_id);
    }
    return { id: u.id, email: u.email, name: u.name, role: u.role, locationIds };
  } catch {
    return null;
  }
}

export async function requireUser(module?: keyof typeof MODULE_ACCESS): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (module && !canAccess(user, module)) redirect("/?denied=1");
  return user;
}

export function canAccess(user: SessionUser, module: keyof typeof MODULE_ACCESS) {
  return user.role === "admin" || MODULE_ACCESS[module]?.includes(user.role);
}

export function canSeeLocation(user: SessionUser, locationId: number) {
  return user.locationIds === null || user.locationIds.includes(locationId);
}

/** Filtru SQL pentru locațiile permise. Returnează fragmentul și parametrul. */
export function locationScope(user: SessionUser, column: string, paramIndex: number): { sql: string; params: unknown[] } {
  if (user.locationIds === null) return { sql: "TRUE", params: [] };
  return { sql: `${column} = ANY($${paramIndex}::int[])`, params: [user.locationIds] };
}
