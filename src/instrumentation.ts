/** Pornește planificatorul intern de alerte și rapoarte când rulează serverul Node.js. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.INTERNAL_SCHEDULER !== "off") {
    const { startScheduler } = await import("./lib/jobs");
    startScheduler();
  }
}
