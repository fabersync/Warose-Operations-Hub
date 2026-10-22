"use client";
import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { createAgent, createUser, resetPassword, type AgentState, type ResetState, type UserState } from "./actions";

type Loc = { id: number; name: string };

export function AgentForm({ locations }: { locations: Loc[] }) {
  const [state, action, pending] = useActionState<AgentState, FormData>(createAgent, {});
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field"><label className="label" htmlFor="agent_name">Nume calculator</label><input id="agent_name" name="name" required placeholder="PC casă Sibiu" className="input" /></div>
        <div className="field">
          <label className="label" htmlFor="agent_loc">Locație</label>
          <select id="agent_loc" name="location_id" className="input">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </div>
      </div>
      {state.error && <p className="text-sm text-bad">{state.error}</p>}
      {state.token && (
        <div className="rounded-xl border border-warn/25 bg-warn-soft p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-warn"><KeyRound className="size-4" />Cheia pentru „{state.name}” — afișată o singură dată</div>
          <p className="mt-1 text-ink-2">Copiați-o în fișierul <code>config.json</code> al agentului de pe calculatorul din locație. Nu o trimiteți pe chat sau email.</p>
          <input readOnly value={state.token} onFocus={(e) => e.currentTarget.select()} className="input mt-3 font-mono text-xs" />
        </div>
      )}
      <button className="btn btn-primary" disabled={pending}>Generează agent</button>
    </form>
  );
}

export function UserForm({ locations, roles }: { locations: Loc[]; roles: [string, string][] }) {
  const [state, action, pending] = useActionState<UserState, FormData>(createUser, {});
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field"><label className="label" htmlFor="u_name">Nume</label><input id="u_name" name="name" required className="input" /></div>
        <div className="field"><label className="label" htmlFor="u_email">Email</label><input id="u_email" name="email" type="email" required className="input" /></div>
        <div className="field">
          <label className="label" htmlFor="u_role">Rol</label>
          <select id="u_role" name="role" className="input" defaultValue="location_manager">{roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
        <div className="field"><label className="label" htmlFor="u_pass">Parolă inițială</label><input id="u_pass" name="password" type="password" minLength={10} required autoComplete="new-password" className="input" /></div>
      </div>
      <fieldset>
        <legend className="label mb-1.5">Locații permise</legend>
        <div className="flex flex-wrap gap-2">
          {locations.map((l) => (
            <label key={l.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 has-[:checked]:border-crust has-[:checked]:bg-crust-soft">
              <input type="checkbox" name="locations" value={l.id} className="accent-crust" />{l.name}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">Administratorul și Contabilitatea văd toate locațiile.</p>
      </fieldset>
      {state.error && <p className="text-sm text-bad">{state.error}</p>}
      {state.ok && <p className="text-sm text-good">{state.ok}</p>}
      <button className="btn btn-primary" disabled={pending}>Creează cont</button>
    </form>
  );
}

export function ResetPassword({ userId }: { userId: number }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPassword, {});
  if (state.password) {
    return (
      <div className="text-xs">
        <div className="text-muted">Parolă temporară (o singură dată):</div>
        <input readOnly value={state.password} onFocus={(e) => e.currentTarget.select()} className="input mt-1 w-40 py-1 font-mono text-xs" />
      </div>
    );
  }
  return (
    <form action={action}>
      <input type="hidden" name="user_id" value={userId} />
      <button className="btn btn-ghost px-2.5 py-1 text-xs" disabled={pending} title="Generează o parolă temporară și închide sesiunile utilizatorului">Resetează parola</button>
      {state.error && <span className="ml-2 text-xs text-bad">{state.error}</span>}
    </form>
  );
}
