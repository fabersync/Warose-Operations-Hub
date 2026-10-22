import "server-only";
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import bcrypt from "bcryptjs";

/**
 * Un singur punct de acces la PostgreSQL.
 * - În cloud: DATABASE_URL (PostgreSQL real: Supabase, Neon, RDS etc).
 * - Local, fără DATABASE_URL: PGlite (PostgreSQL embedded) în .data/pglite.
 * Ambele primesc exact același SQL, deci nu există diferențe de logică între local și producție.
 */

export type Row = Record<string, any>;
export type Query = <T extends Row = Row>(text: string, params?: unknown[]) => Promise<T[]>;

interface Driver {
  query: Query;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Query) => Promise<T>): Promise<T>;
}

const g = globalThis as unknown as { __waroseDb?: Promise<Driver> };

/** Literal de array PostgreSQL ({1,2} / {"a","b"}); postgres.js nu serializează singur array-urile din sql.unsafe. */
function pgArray(a: unknown[]): string {
  return "{" + a.map((v) => v == null ? "NULL" : typeof v === "number" || typeof v === "boolean" ? String(v)
    : '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",") + "}";
}

async function createDriver(): Promise<Driver> {
  const url = process.env.DATABASE_URL;
  if (!url && process.env.NODE_ENV === "production" && process.env.ALLOW_EMBEDDED_DB !== "1") {
    // În producție datele trebuie să fie într-un PostgreSQL administrat, cu backup — nu pe discul serverului.
    throw new Error("DATABASE_URL lipsește: în producție aplicația necesită o bază PostgreSQL.");
  }
  if (url) {
    const postgres = (await import("postgres")).default;
    // Sesiunile folosesc ora României, ca orice comparație dată / oră din SQL să fie în timpul firmei.
    const sql = postgres(url, {
      max: 10,
      prepare: false,
      connection: { TimeZone: "Europe/Bucharest" },
      types: {
        // Datele trimise ca text („2026-02-01 10:04:03”, ora locală din Publine) ajung neschimbate la PostgreSQL.
        // Implicit, postgres.js le-ar converti prin fusul orar al serverului Node și le-ar decala cu câteva ore.
        date: {
          to: 1184,
          from: [1082, 1114, 1184],
          serialize: (x: unknown) => (x instanceof Date ? x.toISOString() : String(x)),
          parse: (x: string) => new Date(x),
        },
      },
    });
    const wrap = (s: any): Query => async (text, params = []) =>
      (await s.unsafe(text, (params as unknown[]).map((p) => (Array.isArray(p) ? pgArray(p) : p)))) as any;
    return {
      query: wrap(sql),
      exec: async (text) => { await sql.unsafe(text); },
      tx: (fn) => sql.begin((t) => fn(wrap(t))) as any,
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = path.join(process.cwd(), ".data", "pglite");
  fs.mkdirSync(dir, { recursive: true });
  const pg = await PGlite.create(dir);
  await pg.exec("SET TIME ZONE 'Europe/Bucharest'");
  const wrap = (s: any): Query => async (text, params = []) => (await s.query(text, params)).rows as any;
  return {
    query: wrap(pg),
    exec: async (text) => { await pg.exec(text); },
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
  };
}

async function migrate(d: Driver) {
  await d.exec(`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = path.join(process.cwd(), "db", "migrations");
  const done = new Set((await d.query<{ name: string }>("SELECT name FROM _migrations")).map((r) => r.name));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await d.tx(async (q) => {
      for (const stmt of splitSql(sql)) await q(stmt);
      await q("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    });
    console.log(`[db] migrare aplicată: ${file}`);
  }
}

function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

async function bootstrapAdmin(d: Driver) {
  const [{ n }] = await d.query<{ n: number }>("SELECT count(*)::int AS n FROM users");
  if (n > 0) return;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("[db] Nu există utilizatori. Setați ADMIN_EMAIL și ADMIN_PASSWORD pentru a crea administratorul.");
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  await d.query(
    "INSERT INTO users (email, name, password_hash, role) VALUES ($1, 'Administrator', $2, 'admin')",
    [email.toLowerCase(), hash],
  );
  console.log(`[db] administrator inițial creat: ${email}`);
}

function driver(): Promise<Driver> {
  if (!g.__waroseDb) {
    g.__waroseDb = (async () => {
      const d = await createDriver();
      await migrate(d);
      await bootstrapAdmin(d);
      return d;
    })().catch((e) => {
      g.__waroseDb = undefined;
      throw e;
    });
  }
  return g.__waroseDb;
}

// În interiorul unei tranzacții, orice interogare (inclusiv cele făcute prin q/one/audit fără conexiune explicită)
// merge pe conexiunea tranzacției. Altfel, cu baza embedded (o singură conexiune), ar aștepta la nesfârșit.
const currentTx = new AsyncLocalStorage<Query>();

export const q: Query = async (text, params) => {
  const t = currentTx.getStore();
  return t ? t(text, params) : (await driver()).query(text, params);
};
export async function one<T extends Row = Row>(text: string, params?: unknown[]): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}
export async function tx<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  const outer = currentTx.getStore();
  if (outer) return fn(outer); // tranzacție imbricată: rulează în cea existentă
  return (await driver()).tx((t) => currentTx.run(t, () => fn(t)));
}
