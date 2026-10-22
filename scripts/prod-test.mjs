// Pornește build-ul de producție local, conectat la PostgreSQL-ul real de test (npm run db:local-postgres).
// Folosește administratorul de test din .env.local. Doar pentru verificări locale.
import fs from "node:fs";
import { randomBytes } from "node:crypto";

const local = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
Object.assign(process.env, {
  NODE_ENV: "production", PORT: "3100", HOSTNAME: "127.0.0.1",
  DATABASE_URL: "postgres://warose:warose@127.0.0.1:5433/warose",
  AUTH_SECRET: randomBytes(32).toString("base64url"),
  CRON_SECRET: local.CRON_SECRET,
  FILE_STORAGE_DIR: ".data/files-pgtest",
  ADMIN_EMAIL: local.ADMIN_EMAIL,
  ADMIN_PASSWORD: local.ADMIN_PASSWORD,
  APP_URL: "http://127.0.0.1:3100",
});
await import("../.next/standalone/server.js");
