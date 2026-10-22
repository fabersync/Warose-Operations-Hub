"use client";
import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="space-y-4">
      <div className="field">
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" />
      </div>
      <div className="field">
        <label className="label" htmlFor="password">Parolă</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      {state?.error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>}
      <button className="btn btn-primary w-full py-2.5" disabled={pending}>{pending ? "Se verifică…" : "Autentificare"}</button>
    </form>
  );
}
