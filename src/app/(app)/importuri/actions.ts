"use server";
import { revalidatePath } from "next/cache";
import { requireUser, canSeeLocation } from "@/lib/auth";
import { ingestPublineSales, retryBatch, revertBatch, type ImportResult } from "@/lib/imports";

export type UploadState = { results?: (ImportResult & { fileName: string })[]; error?: string };

export async function uploadPubline(_: UploadState, form: FormData): Promise<UploadState> {
  const user = await requireUser("imports");
  const locationId = Number(form.get("location_id"));
  if (!locationId || !canSeeLocation(user, locationId)) return { error: "Alegeți locația căreia îi aparține exportul." };
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Alegeți cel puțin un fișier exportat din Publine." };
  const results = [];
  for (const f of files) {
    const r = await ingestPublineSales({ buffer: Buffer.from(await f.arrayBuffer()), fileName: f.name, defaultLocationId: locationId, userId: user.id });
    results.push({ ...r, fileName: f.name });
  }
  revalidatePath("/", "layout");
  return { results };
}

/** Doar administratorul: scoate din vânzări un import (ex. exporturi vechi încărcate din greșeală). */
export async function revertImport(form: FormData) {
  const user = await requireUser("imports");
  if (user.role !== "admin") throw new Error("Doar administratorul poate anula un import.");
  await revertBatch(Number(form.get("batch_id")), user.id);
  revalidatePath("/", "layout");
}

export async function retryImport(form: FormData) {
  const user = await requireUser("imports");
  await retryBatch(Number(form.get("batch_id")), user.id);
  revalidatePath("/", "layout");
}
