"use client";
import { useActionState } from "react";
import { changePassword, type PwState } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState<PwState, FormData>(changePassword, {});
  return (
    <form action={action} className="space-y-3">
      <div className="field"><label className="label" htmlFor="current">Parola actuală</label><input id="current" name="current" type="password" autoComplete="current-password" required className="input" /></div>
      <div className="field"><label className="label" htmlFor="next">Parola nouă</label><input id="next" name="next" type="password" autoComplete="new-password" minLength={10} required className="input" /></div>
      <div className="field"><label className="label" htmlFor="confirm">Confirmați parola nouă</label><input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required className="input" /></div>
      <p className="text-xs text-muted">Minimum 10 caractere.</p>
      {state.error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good" role="status">{state.ok}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>Schimbă parola</button>
    </form>
  );
}
