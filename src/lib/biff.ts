import "server-only";
import * as XLSX from "xlsx";

/**
 * Cititor .xls (BIFF8) cu memorie mică: parcurge înregistrările fișierului o singură dată și păstrează
 * doar valorile celulelor. Un export Publine pe câteva luni (~16 MB, ~50.000 de rânduri) are nevoie
 * de peste 512 MB cu cititorul complet SheetJS; aici rămâne sub ~100 MB.
 * Întoarce null dacă fișierul nu este BIFF8 (atunci se folosește cititorul SheetJS).
 */
export type Cell = string | number | boolean | null;
export interface BiffSheet { name: string; rows: Cell[][] }

export function readBiff8(buffer: Buffer): BiffSheet[] | null {
  if (buffer.length < 8 || buffer.readUInt32LE(0) !== 0xe011cfd0) return null;
  const cfb = XLSX.CFB.read(buffer, { type: "buffer" }) as { FileIndex: { name: string; type: number; content?: unknown }[] };
  const entry = cfb.FileIndex.find((f) => f.type === 2 && /^workbook$/i.test(f.name));
  if (!entry?.content) return null; // BIFF5 („Book”) sau alt document OLE
  const wbBuf = Buffer.from(entry.content as Uint8Array);

  const sst: string[] = [];
  const sheetNames: string[] = [];
  const sheets: BiffSheet[] = [];
  let current: BiffSheet | null = null;
  const stack: (BiffSheet | null)[] = []; // o diagramă inclusă într-o foaie are propriul BOF…EOF
  let pending = new Map<number, Cell[]>(); // rândurile blocului curent (BIFF8 grupează câte 32 de rânduri)
  let formulaCell: [number, number] | null = null;
  let sstParts: Buffer[] | null = null;

  const set = (r: number, c: number, v: Cell) => {
    let row = pending.get(r);
    if (!row) { row = []; pending.set(r, row); }
    row[c] = v;
  };
  const flush = () => {
    if (!current) return;
    for (const r of [...pending.keys()].sort((a, b) => a - b)) {
      const row = pending.get(r)!;
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
      current.rows[r] = row;
    }
    pending = new Map();
  };

  let pos = 0;
  while (pos + 4 <= wbBuf.length) {
    const type = wbBuf.readUInt16LE(pos);
    const len = wbBuf.readUInt16LE(pos + 2);
    const d = wbBuf.subarray(pos + 4, pos + 4 + len);
    pos += 4 + len;

    if (sstParts && type !== 0x003c) { parseSst(sstParts, sst); sstParts = null; }
    switch (type) {
      case 0x0809: { // BOF
        const dt = d.readUInt16LE(2);
        stack.push(current);
        if (dt === 0x0010) { current = { name: sheetNames[sheets.length] ?? `Sheet${sheets.length + 1}`, rows: [] }; sheets.push(current); }
        else current = null; // foaia globală, diagrame, macro: fără celule de citit
        break;
      }
      case 0x0085: { // BOUNDSHEET: numele foii
        const cch = d[6], high = d[7] & 1;
        sheetNames.push(high ? d.subarray(8, 8 + cch * 2).toString("utf16le") : d.subarray(8, 8 + cch).toString("latin1"));
        break;
      }
      case 0x00fc: sstParts = [d]; break; // SST, urmat de CONTINUE
      case 0x003c: if (sstParts) sstParts.push(d); break;
      case 0x00fd: if (current) set(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? null); break; // LABELSST
      case 0x0203: if (current) set(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6)); break; // NUMBER
      case 0x027e: if (current) set(d.readUInt16LE(0), d.readUInt16LE(2), rk(d.readInt32LE(6))); break; // RK
      case 0x00bd: { // MULRK
        if (!current) break;
        const r = d.readUInt16LE(0); let c = d.readUInt16LE(2);
        for (let o = 4; o + 6 <= d.length - 2; o += 6) set(r, c++, rk(d.readInt32LE(o + 2)));
        break;
      }
      case 0x0204: { // LABEL
        if (!current) break;
        const cch = d.readUInt16LE(6), high = d[8] & 1;
        set(d.readUInt16LE(0), d.readUInt16LE(2), high ? d.subarray(9, 9 + cch * 2).toString("utf16le") : d.subarray(9, 9 + cch).toString("latin1"));
        break;
      }
      case 0x0205: if (current) set(d.readUInt16LE(0), d.readUInt16LE(2), d[7] ? null : d[6] === 1); break; // BOOLERR
      case 0x0006: { // FORMULA: valoarea calculată
        if (!current) break;
        const r = d.readUInt16LE(0), c = d.readUInt16LE(2);
        if (d.readUInt16LE(12) === 0xffff) {
          const kind = d[6];
          if (kind === 0) formulaCell = [r, c]; // textul vine în înregistrarea STRING următoare
          else set(r, c, kind === 1 ? d[8] === 1 : kind === 3 ? "" : null);
        } else set(r, c, d.readDoubleLE(6));
        break;
      }
      case 0x0207: { // STRING (rezultatul text al formulei anterioare)
        if (current && formulaCell) {
          const cch = d.readUInt16LE(0), high = d[2] & 1;
          set(formulaCell[0], formulaCell[1], high ? d.subarray(3, 3 + cch * 2).toString("utf16le") : d.subarray(3, 3 + cch).toString("latin1"));
        }
        formulaCell = null;
        break;
      }
      case 0x00d7: flush(); break; // DBCELL: sfârșitul unui bloc de rânduri
      case 0x000a: flush(); if (current) current.rows = densify(current.rows); current = stack.pop() ?? null; break; // EOF
    }
  }
  return sheets;
}

/** Rânduri lipsă → [], ca la sheet_to_json cu blankrows:false se elimină ulterior. */
function densify(rows: Cell[][]): Cell[][] {
  const out: Cell[][] = [];
  for (let i = 0; i < rows.length; i++) out.push(rows[i] ?? []);
  return out;
}

function rk(v: number): number {
  let n: number;
  if (v & 2) n = v >> 2;
  else { const b = Buffer.alloc(8); b.writeInt32LE(v & 0xfffffffc, 4); n = b.readDoubleLE(0); }
  return v & 1 ? n / 100 : n;
}

/** Tabela de texte partajate (SST), inclusiv textele împărțite între înregistrările CONTINUE. */
function parseSst(parts: Buffer[], out: string[]) {
  let seg = 0, off = 8; // primii 8 octeți: număr total / număr unic
  const total = parts[0].readUInt32LE(4);
  const avail = () => parts[seg].length - off;
  const next = () => { seg++; off = 0; };
  const bytes = (n: number): Buffer => { // citire brută peste granițele CONTINUE
    if (avail() >= n) { const b = parts[seg].subarray(off, off + n); off += n; return b; }
    const chunks: Buffer[] = []; let left = n;
    while (left > 0) { if (avail() === 0) next(); const k = Math.min(left, avail()); chunks.push(parts[seg].subarray(off, off + k)); off += k; left -= k; }
    return Buffer.concat(chunks);
  };
  for (let i = 0; i < total && seg < parts.length; i++) {
    if (avail() === 0) { if (seg + 1 >= parts.length) break; next(); }
    const cch = bytes(2).readUInt16LE(0);
    const flags = bytes(1)[0];
    let high = flags & 1;
    const runs = flags & 8 ? bytes(2).readUInt16LE(0) : 0;
    const ext = flags & 4 ? bytes(4).readUInt32LE(0) : 0;
    let s = "", left = cch;
    while (left > 0) {
      if (avail() === 0) { next(); high = parts[seg][off++] & 1; } // la CONTINUE: un octet nou de opțiuni
      const k = Math.min(left, high ? Math.floor(avail() / 2) : avail());
      const b = parts[seg].subarray(off, off + k * (high ? 2 : 1));
      s += high ? b.toString("utf16le") : b.toString("latin1");
      off += b.length; left -= k;
    }
    if (runs) bytes(runs * 4);
    if (ext) bytes(ext);
    out.push(s);
  }
}
