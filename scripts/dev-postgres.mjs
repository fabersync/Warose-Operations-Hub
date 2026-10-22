// PostgreSQL real, local, pentru testarea compatibilității cu baza din cloud (nu se folosește în producție).
// Utilizare: node scripts/dev-postgres.mjs  →  DATABASE_URL=postgres://warose:warose@127.0.0.1:5433/warose
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";

const dir = ".data/pg-real";
// UTF-8 ca în cloud (fără aceasta, pe Windows clusterul ar folosi WIN1252 și ar respinge diacriticele).
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "warose", password: "warose", port: 5433, persistent: true, initdbFlags: ["--encoding=UTF8", "--locale=C"] });
if (!fs.existsSync(`${dir}/PG_VERSION`)) await pg.initialise();
await pg.start();
try { await pg.createDatabase("warose"); } catch { /* există deja */ }
console.log("PostgreSQL pornit: postgres://warose:warose@127.0.0.1:5433/warose");
const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
