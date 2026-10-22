import "server-only";
import { XMLParser } from "fast-xml-parser";
import { unzipSync, strFromU8 } from "fflate";

/**
 * Parser pentru facturile e-Factura (RO_CIUS / UBL 2.1), așa cum se descarcă din SPV:
 * fie XML-ul facturii, fie arhiva ZIP de la ANAF (factura + semnătura).
 * Datele sunt structurate și oficiale, deci nu e nevoie de „ghicirea” informațiilor dintr-un PDF.
 */

export interface EInvoiceLine {
  lineNo: number;
  description: string;
  supplierCode: string | null;
  qty: number;
  unit: string | null;
  unitPrice: number | null;
  net: number;
  vatRate: number | null;
  grossUnitPrice: number | null; // prețul înainte de reducere, când factura îl conține
  discount: number | null;       // valoarea totală a reducerilor de pe linie
}

export interface EInvoice {
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  isCreditNote: boolean;
  supplier: { name: string; cif: string | null };
  customerCif: string | null;
  totalNet: number;
  totalVat: number;
  totalGross: number;
  prepaid: number | null;        // ex: Metro — achitat la casă, „de plată” 0
  lines: EInvoiceLine[];
  warnings: string[];            // verificări de coerență (nu blochează importul)
}

const UNIT: Record<string, string> = { H87: "buc", C62: "buc", XPP: "buc", KGM: "kg", GRM: "g", LTR: "l", MLT: "ml", MTR: "m", XBX: "cutie", XPA: "pachet", XSA: "sac", XBG: "sac", XCT: "bax", XBO: "sticla", DAY: "zi", HUR: "ora", MON: "luna" };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false, isArray: (name) => ["InvoiceLine", "CreditNoteLine", "TaxSubtotal", "AllowanceCharge", "TaxTotal"].includes(name) });

const text = (v: any): string | null => {
  if (v == null) return null;
  if (typeof v === "object") return v["#text"] != null ? String(v["#text"]).trim() : null;
  return String(v).trim();
};
const num = (v: any): number | null => { const t = text(v); if (t == null || t === "") return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const normCif = (c: string | null) => (c ? c.toUpperCase().replace(/\s/g, "").replace(/^RO/, "") : null);

/** Extrage XML-ul facturii dintr-un fișier XML sau dintr-o arhivă ZIP descărcată din SPV. */
export function extractXml(buffer: Buffer, fileName: string): string {
  if (fileName.toLowerCase().endsWith(".zip") || (buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    const files = unzipSync(new Uint8Array(buffer));
    const xmlName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".xml") && !/semnatura|signature/i.test(n));
    if (!xmlName) throw new Error("Arhiva nu conține XML-ul facturii.");
    return strFromU8(files[xmlName]);
  }
  return buffer.toString("utf8");
}

export function parseEInvoice(xml: string): EInvoice {
  const doc = parser.parse(xml);
  const root = doc.Invoice ?? doc.CreditNote;
  if (!root) throw new Error("Fișierul nu este o factură e-Factura (UBL Invoice / CreditNote).");
  if (!/xmlns(?::\w+)?\s*=\s*["']urn:oasis:names:specification:ubl:schema:xsd:(Invoice|CreditNote)-2["']/.test(xml.slice(0, 4000))) {
    throw new Error("XML-ul nu are spațiul de nume UBL 2.1 al unei facturi e-Factura.");
  }
  const isCredit = !!doc.CreditNote;
  const sup = root.AccountingSupplierParty?.Party ?? {};
  const cus = root.AccountingCustomerParty?.Party ?? {};
  const cifOf = (p: any) => normCif(text(p.PartyTaxScheme?.CompanyID) ?? text(p.PartyLegalEntity?.CompanyID));
  const total = root.LegalMonetaryTotal ?? {};
  // Doar totalul de TVA în moneda documentului (pot exista două TaxTotal: în valută și în RON).
  const docCurrency = text(root.DocumentCurrencyCode) ?? "RON";
  const taxTotals: any[] = root.TaxTotal ?? [];
  const taxInDoc = taxTotals.filter((t) => (t.TaxAmount?.["@currencyID"] ?? docCurrency) === docCurrency);
  const vat = (taxInDoc.length ? taxInDoc : taxTotals.slice(0, 1)).reduce((s: number, t: any) => s + (num(t.TaxAmount) ?? 0), 0);
  const allowances = (list: any[] | undefined) => (list ?? []).reduce((acc, a) => {
    const amt = num(a.Amount) ?? 0;
    return text(a.ChargeIndicator) === "true" ? { ...acc, charge: acc.charge + amt } : { ...acc, allowance: acc.allowance + amt };
  }, { allowance: 0, charge: 0 });
  const rawLines: any[] = (isCredit ? root.CreditNoteLine : root.InvoiceLine) ?? [];

  const lines: EInvoiceLine[] = rawLines.map((l, i) => {
    const qtyNode = isCredit ? l.CreditedQuantity : l.InvoicedQuantity;
    const unitCode = typeof qtyNode === "object" ? qtyNode["@unitCode"] : null;
    return {
      lineNo: i + 1, // în ordinea din factură; unele facturi folosesc ID-uri ierarhice („1.1”), nu numere întregi
      description: text(l.Item?.Name) ?? text(l.Item?.Description) ?? `Linia ${i + 1}`,
      supplierCode: text(l.Item?.SellersItemIdentification?.ID) ?? text(l.Item?.StandardItemIdentification?.ID),
      qty: num(qtyNode) ?? 0,
      unit: unitCode ? UNIT[unitCode] ?? unitCode.toLowerCase() : null,
      unitPrice: num(l.Price?.PriceAmount),
      net: num(l.LineExtensionAmount) ?? 0,
      vatRate: num(l.Item?.ClassifiedTaxCategory?.Percent),
      ...(() => {
        // Reducere în preț (Price/AllowanceCharge: BaseAmount = preț brut) și/sau pe linie (InvoiceLine/AllowanceCharge).
        const priceAc = l.Price?.AllowanceCharge?.[0];
        const qty = num(qtyNode) ?? 0;
        const perUnit = priceAc ? num(priceAc.Amount) ?? 0 : 0;
        const lineAc = allowances(l.AllowanceCharge);
        const discount = Math.round((perUnit * qty + lineAc.allowance - lineAc.charge) * 100) / 100;
        return { grossUnitPrice: priceAc ? num(priceAc.BaseAmount) : null, discount: discount ? discount : null };
      })(),
    };
  });

  // Reducerile / costurile la nivel de document devin linii separate, ca suma liniilor să fie egală cu totalul fără TVA.
  for (const a of root.AllowanceCharge ?? []) {
    const isCharge = text(a.ChargeIndicator) === "true";
    const amt = num(a.Amount) ?? 0;
    if (!amt) continue;
    lines.push({
      lineNo: lines.length + 1,
      description: `${isCharge ? "Cost suplimentar" : "Reducere"} document${text(a.AllowanceChargeReason) ? `: ${text(a.AllowanceChargeReason)}` : ""}`,
      supplierCode: null, qty: 1, unit: null, unitPrice: isCharge ? amt : -amt, net: isCharge ? amt : -amt,
      vatRate: num(a.TaxCategory?.Percent), grossUnitPrice: null, discount: null,
    });
  }

  const number = text(root.ID);
  const issueDate = text(root.IssueDate);
  if (!number || !issueDate) throw new Error("Factura nu are număr sau dată de emitere.");
  const totalNet = num(total.TaxExclusiveAmount) ?? lines.reduce((s, l) => s + l.net, 0);
  const totalGross = num(total.TaxInclusiveAmount) ?? num(total.PayableAmount) ?? totalNet + vat;
  const warnings: string[] = [];
  const sumLines = Math.round(lines.reduce((s, l) => s + l.net, 0) * 100) / 100;
  if (Math.abs(sumLines - totalNet) > 0.05) warnings.push(`Suma liniilor (${sumLines.toFixed(2)}) diferă de totalul fără TVA (${totalNet.toFixed(2)}).`);
  if (Math.abs(totalNet + vat - totalGross) > 0.05) warnings.push(`Fără TVA + TVA (${(totalNet + vat).toFixed(2)}) diferă de totalul cu TVA (${totalGross.toFixed(2)}).`);
  if (!lines.length) warnings.push("Factura nu are linii.");
  return {
    number,
    issueDate,
    dueDate: text(root.DueDate) ?? text(root.PaymentMeans?.PaymentDueDate),
    currency: docCurrency,
    isCreditNote: isCredit,
    supplier: { name: text(sup.PartyLegalEntity?.RegistrationName) ?? text(sup.PartyName?.Name) ?? "Furnizor necunoscut", cif: cifOf(sup) },
    customerCif: cifOf(cus),
    totalNet,
    totalVat: Math.round(vat * 100) / 100,
    totalGross,
    prepaid: num(total.PrepaidAmount),
    lines,
    warnings,
  };
}

export { normCif };
