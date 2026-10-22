import { getUser, canAccess } from "@/lib/auth";
import { one } from "@/lib/db";
import { readFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Documentul original al facturii (PDF atașat sau XML e-Factura), doar pentru utilizatorii cu acces la facturi. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user || !canAccess(user, "invoices")) return new Response("Neautorizat", { status: 401 });
  const kind = new URL(req.url).searchParams.get("kind") === "pdf" ? "pdf" : "original";
  const inv = await one<{ file_path: string | null; file_name: string | null; pdf_path: string | null }>(
    "SELECT file_path, file_name, pdf_path FROM invoices WHERE id=$1", [Number((await params).id)]);
  const p = kind === "pdf" ? inv?.pdf_path : inv?.file_path;
  if (!p) return new Response("Fișier inexistent", { status: 404 });
  const buf = await readFile(p);
  const type = p.endsWith(".pdf") ? "application/pdf" : p.endsWith(".zip") ? "application/zip" : /\.(png|jpe?g)$/.test(p) ? `image/${p.split(".").pop()!.replace("jpg", "jpeg")}` : "application/xml";
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": type, "Content-Disposition": `inline; filename="${(inv?.file_name ?? p.split("/").pop())!.replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff" },
  });
}
