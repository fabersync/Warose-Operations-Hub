/** Pornește planificatorul intern de alerte și rapoarte când rulează serverul Node.js. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // O singură instanță: la pornire, nimic nu mai poate fi „în lucru”.
    const { failInterruptedImports } = await import("./lib/imports");
    const n = await failInterruptedImports().catch((e) => { console.error("Verificarea importurilor întrerupte a eșuat:", e); return 0; });
    if (n) console.warn(`${n} import(uri) întrerupte la repornire au fost marcate „eșuat”.`);
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.INTERNAL_SCHEDULER !== "off") {
    const { startScheduler } = await import("./lib/jobs");
    startScheduler();
  }
}
