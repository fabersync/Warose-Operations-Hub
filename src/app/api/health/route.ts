import { NextResponse } from "next/server";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificarea de sănătate pentru găzduire: aplicația răspunde și baza de date este accesibilă. */
export async function GET() {
  try {
    const r = await one<{ migrations: number }>("SELECT count(*)::int migrations FROM _migrations");
    return NextResponse.json({ ok: true, migrations: r?.migrations ?? 0, time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
