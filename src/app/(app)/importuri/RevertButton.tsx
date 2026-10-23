"use client";
import { revertImport } from "./actions";

export function RevertButton({ batchId, fileName, lines }: { batchId: number; fileName: string; lines: number }) {
  return (
    <form
      action={revertImport}
      onSubmit={(e) => {
        if (!confirm(`Anulați importul #${batchId} (${fileName})?\n\nCele ${lines} linii ale lui se scot din vânzări și rapoarte, iar mișcările de stoc se stornează. Fișierul rămâne păstrat și poate fi reimportat.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="batch_id" value={batchId} />
      <button className="btn btn-ghost px-2.5 py-1 text-xs text-bad">Anulează</button>
    </form>
  );
}
