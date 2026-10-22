import { Undo2 } from "lucide-react";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { MOVEMENT_LABELS } from "@/lib/queries";
import { reverseMovement } from "@/app/(app)/stocuri/actions";
import { Badge } from "./ui";

type Mv = { id: number; occurred_at: string; location: string; product: string; unit: string; qty: number; kind: string; lot: string | null; counterpart: string | null; document_ref: string | null; note: string | null; user_name: string; reverses_id: number | null; reversed: boolean };

export function MovementTable({ rows }: { rows: Mv[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>Data</th><th>Operațiune</th><th>Produs</th><th>Locație</th><th className="num">Cantitate</th><th>Detalii</th><th>Utilizator</th><th></th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className={m.reversed ? "opacity-50" : ""}>
              <td className="whitespace-nowrap text-xs">{fmtDateTime(m.occurred_at)}</td>
              <td><Badge tone={m.kind === "reversal" ? "neutral" : m.qty > 0 ? "good" : "warn"}>{MOVEMENT_LABELS[m.kind] ?? m.kind}</Badge></td>
              <td className="font-medium text-ink">{m.product}</td>
              <td className="whitespace-nowrap text-xs">{m.location}{m.counterpart && <span className="text-muted"> {m.qty < 0 ? "→" : "←"} {m.counterpart}</span>}</td>
              <td className={`num font-medium ${m.qty > 0 ? "text-good" : "text-bad"}`}>{m.qty > 0 ? "+" : ""}{fmtNum(m.qty)} <span className="font-normal text-muted">{m.unit}</span></td>
              <td className="max-w-[240px] text-xs text-muted">
                {[m.lot && `Lot ${m.lot}`, m.document_ref, m.note].filter(Boolean).join(" · ") || "—"}
                {m.reversed && <div className="text-bad">Stornată</div>}
              </td>
              <td className="whitespace-nowrap text-xs">{m.user_name}</td>
              <td>
                {!m.reversed && !["reversal", "sale", "inventory"].includes(m.kind) && (
                  <form action={reverseMovement}>
                    <input type="hidden" name="movement_id" value={m.id} />
                    <button className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-bad" title="Stornează (creează mișcarea inversă)" aria-label="Stornează"><Undo2 className="size-4" /></button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
