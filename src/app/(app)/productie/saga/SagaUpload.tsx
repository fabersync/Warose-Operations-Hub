"use client";
import { useActionState } from "react";
import { uploadSagaProduction, type FormState } from "../actions";

export function SagaUpload() {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadSagaProduction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="file" name="file" accept=".xls,.xlsx" required aria-label="Raport SAGA" className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border-0 file:bg-canvas file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink hover:file:bg-line" />
      {state.error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good" role="status">{state.ok}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Se importă…" : "Importă raportul"}</button>
    </form>
  );
}
