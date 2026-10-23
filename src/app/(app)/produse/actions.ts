"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { audit } from "@/lib/audit";

const CATEGORIES = ["finished", "raw", "merchandise", "packaging", "service", "other"];

export async function createProduct(form: FormData) {
  const user = await requireUser("products");
  const name = String(form.get("name") ?? "").trim().toUpperCase();
  const unit = String(form.get("unit") ?? "buc").trim() || "buc";
  const category = String(form.get("category") ?? "other");
  if (!name || !CATEGORIES.includes(category)) return;
  const p = await one<{ id: number }>(
    "INSERT INTO products (name, unit, category, is_frozen, track_stock) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [name, unit, category, form.get("is_frozen") === "on", form.get("track_stock") === "on"],
  );
  await audit({ userId: user.id, action: "product.create", entity: "product", entityId: p!.id, details: { name, unit, category } });
  revalidatePath("/produse");
}

export async function updateProduct(form: FormData) {
  const user = await requireUser("products");
  const id = Number(form.get("id"));
  const category = String(form.get("category"));
  const isFrozen = form.get("is_frozen") === "on";
  const trackStock = form.get("track_stock") === "on";
  const unit = String(form.get("unit") ?? "").trim() || "buc";
  // Produsele preparate în magazin scad ingredientele rețetei; nu pot avea și stoc propriu (s-ar scădea de două ori).
  const recipeOnSale = form.get("consume_recipe_on_sale") === "on" && !trackStock;
  if (!id || !CATEGORIES.includes(category)) return;
  await q("UPDATE products SET category=$2, is_frozen=$3, unit=$4, track_stock=$5, consume_recipe_on_sale=$6 WHERE id=$1", [id, category, isFrozen, unit, trackStock, recipeOnSale]);
  await audit({ userId: user.id, action: "product.update", entity: "product", entityId: id, details: { category, isFrozen, unit, trackStock, recipeOnSale } });
  revalidatePath("/produse");
}

/** Asociază un cod extern cu alt produs (ex: două denumiri Publine pentru același produs). Liniile de vânzare se actualizează. */
export async function remapCode(form: FormData) {
  const user = await requireUser("products");
  const codeId = Number(form.get("code_id"));
  const productId = Number(form.get("product_id"));
  const code = await one<{ source: string; code: string; product_id: number | null }>("SELECT source, code, product_id FROM product_codes WHERE id=$1", [codeId]);
  if (!code || !productId) return;
  await q("UPDATE product_codes SET product_id=$2 WHERE id=$1", [codeId, productId]);
  if (code.source === "publine") await q("UPDATE sales_lines SET product_id=$2 WHERE source_code=$1", [code.code, productId]);
  await audit({ userId: user.id, action: "product_code.remap", entity: "product_code", entityId: codeId, details: { from: code.product_id, to: productId } });
  revalidatePath("/", "layout");
}
