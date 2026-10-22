import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Păstrarea fișierelor originale importate (cerință: „Păstrează fișierele originale”).
 * Local: FILE_STORAGE_DIR (implicit .data/files). În cloud se montează un volum persistent
 * sau se înlocuiește implementarea cu un bucket (S3 / Supabase Storage) — interfața rămâne aceeași.
 */
const root = () => path.resolve(process.env.FILE_STORAGE_DIR || path.join(process.cwd(), ".data", "files"));

export async function saveFile(relPath: string, data: Buffer) {
  const full = path.join(root(), relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return relPath;
}

export async function readFile(relPath: string) {
  const full = path.join(root(), relPath);
  if (!full.startsWith(root())) throw new Error("Cale invalidă");
  return fs.readFile(full);
}
