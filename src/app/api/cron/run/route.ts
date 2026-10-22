import { NextResponse } from "next/server";
import { runAlerts, runDailyReport, runMonthlyReport, tick } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Declanșare externă a sarcinilor automate (cron de la găzduire, n8n, Make).
 * Authorization: Bearer <CRON_SECRET>. Parametru opțional ?job=alerts|daily_report|monthly_report (implicit: tick).
 * Pentru rapoarte istorice: &date=YYYY-MM-DD (raportul zilei precedente acestei date) sau &month=YYYY-MM.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET nu este configurat." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Neautorizat." }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const job = sp.get("job");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("date") ?? "") ? sp.get("date")! : undefined;
  const month = /^\d{4}-\d{2}$/.test(sp.get("month") ?? "") ? sp.get("month")! : undefined;
  if (job === "alerts") return NextResponse.json(await runAlerts("cron"));
  if (job === "daily_report") return NextResponse.json(await runDailyReport("cron", date));
  if (job === "monthly_report") return NextResponse.json(await runMonthlyReport("cron", month));
  return NextResponse.json({ ran: await tick("cron") });
}

export const GET = handle;
export const POST = handle;
