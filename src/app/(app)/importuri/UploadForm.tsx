"use client";
import { useActionState, useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, UploadCloud, XCircle, Copy } from "lucide-react";
import { uploadPubline, type UploadState } from "./actions";

const ron = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", minimumFractionDigits: 2 });

export function UploadForm({ locations }: { locations: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadPubline, {});
  const [names, setNames] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_2fr]">
        <div className="field">
          <label className="label" htmlFor="location_id">Locația exportului</label>
          <select id="location_id" name="location_id" className="input" defaultValue={locations[0]?.id} required>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <p className="text-xs text-muted">Folosită pentru liniile fără gestiune în export.</p>
        </div>
        <label
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-canvas/50 px-4 py-6 text-center transition hover:border-crust hover:bg-crust-soft/40"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (input.current && e.dataTransfer.files.length) {
              input.current.files = e.dataTransfer.files;
              setNames([...e.dataTransfer.files].map((f) => f.name));
            }
          }}
        >
          <UploadCloud className="size-6 text-muted" strokeWidth={1.5} />
          <span className="mt-2 text-sm font-medium text-ink">{names.length ? names.join(", ") : "Trageți aici exporturile sau alegeți fișierele"}</span>
          <span className="mt-0.5 text-xs text-muted">Publine „Situație comenzi” · .xls, .xlsx, .csv</span>
          <input ref={input} type="file" name="files" multiple accept=".xls,.xlsx,.csv" className="sr-only"
            onChange={(e) => setNames([...(e.target.files ?? [])].map((f) => f.name))} />
        </label>
      </div>
      <div className="flex items-center justify-end gap-3">
        {pending && <span className="text-sm text-muted">Se procesează și se verifică totalurile…</span>}
        <button className="btn btn-primary" disabled={pending || !names.length}>Importă</button>
      </div>

      {state.error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>}
      {state.results?.map((r) => (
        <div key={r.batchId} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${r.status === "failed" ? "border-bad/25 bg-bad-soft" : r.status === "duplicate" ? "border-line bg-canvas" : r.reconciled ? "border-good/20 bg-good-soft" : "border-warn/25 bg-warn-soft"}`} role="status">
          {r.status === "failed" ? <XCircle className="mt-0.5 size-4 shrink-0 text-bad" /> : r.status === "duplicate" ? <Copy className="mt-0.5 size-4 shrink-0 text-muted" /> : r.reconciled ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" /> : <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-warn" />}
          <div className="text-ink-2">
            <div className="font-medium text-ink">{r.fileName}</div>
            {r.status === "failed" && <div>Import eșuat: {r.error}</div>}
            {r.status === "duplicate" && <div>Fișierul a fost deja importat (import #{r.duplicateOf}). Nu s-a înregistrat nimic de două ori.</div>}
            {r.status === "done" && (
              <div>
                {r.rowsInserted} linii noi · {r.rowsDuplicate} linii existente ignorate · {r.rowsError} erori.{" "}
                Total fișier {ron.format(r.fileNet)} net · în sistem {ron.format(r.dbNet)} —{" "}
                <strong>{r.reconciled ? "reconciliat" : "necesită verificare"}</strong>.
                {r.warnings.map((w) => <div key={w} className="mt-1 text-warn">{w}</div>)}
              </div>
            )}
          </div>
        </div>
      ))}
    </form>
  );
}
