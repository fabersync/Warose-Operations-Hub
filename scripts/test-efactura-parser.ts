// Verifică parserul e-Factura pe fișierele reale descărcate de SAGA (doar citire).
// Utilizare: npx tsx --conditions=react-server scripts/test-efactura-parser.ts "C:\SAGA C.3.0\e-Factura\DAVID_WAROSE_SRL"
import fs from "node:fs";
import path from "node:path";
import { extractXml, parseEInvoice } from "../src/lib/efactura";

const root = process.argv[2];
const files: string[] = [];
const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/facturiprimite/i.test(p) && /\.xml$/i.test(e.name)) files.push(p); } };
walk(root);
let ok = 0, warn = 0, credit = 0, withDiscount = 0, prepaid = 0;
const errors: string[] = [], warnings: string[] = [];
const customers = new Map<string, number>();
for (const f of files) {
  try {
    const inv = parseEInvoice(extractXml(fs.readFileSync(f), f));
    ok++;
    if (inv.isCreditNote) credit++;
    if (inv.lines.some((l) => l.discount)) withDiscount++;
    if (inv.prepaid) prepaid++;
    customers.set(inv.customerCif ?? "?", (customers.get(inv.customerCif ?? "?") ?? 0) + 1);
    if (inv.warnings.length) { warn++; if (warnings.length < 8) warnings.push(`${path.basename(f)}: ${inv.warnings.join(" ")}`); }
  } catch (e) {
    if (errors.length < 8) errors.push(`${path.basename(f)}: ${(e as Error).message}`);
  }
}
console.log(JSON.stringify({ total: files.length, ok, errors: files.length - ok, withWarnings: warn, creditNotes: credit, withDiscount, prepaid, customerCifs: Object.fromEntries(customers) }, null, 2));
if (errors.length) console.log("ERORI:\n" + errors.join("\n"));
if (warnings.length) console.log("AVERTIZARI:\n" + warnings.join("\n"));
