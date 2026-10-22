"use client";
import { startTransition, useActionState } from "react";
import { runNow, saveAutomation, saveWebhook, testWebhook, type FormState } from "./actions";

function Msg({ state }: { state: FormState }) {
  if (state.error) return <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>;
  if (state.ok) return <p className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good" role="status">{state.ok}</p>;
  return null;
}
function submitKeep(action: (d: FormData) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => action(data));
  };
}

type Cfg = { daily_report_time: string; monthly_report_time: string; alerts_every_min: number; agent_offline_min: number; business_from: number; business_to: number };

export function ScheduleForm({ cfg }: { cfg: Cfg }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveAutomation, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="field"><label className="label" htmlFor="daily_report_time">Raport zilnic la</label><input id="daily_report_time" name="daily_report_time" type="time" defaultValue={cfg.daily_report_time} className="input" /></div>
        <div className="field"><label className="label" htmlFor="monthly_report_time">Raport lunar (ziua 1) la</label><input id="monthly_report_time" name="monthly_report_time" type="time" defaultValue={cfg.monthly_report_time} className="input" /></div>
        <div className="field"><label className="label" htmlFor="alerts_every_min">Verificare alerte (minute)</label><input id="alerts_every_min" name="alerts_every_min" inputMode="numeric" defaultValue={cfg.alerts_every_min} className="input" /></div>
        <div className="field"><label className="label" htmlFor="agent_offline_min">Agent offline după (minute)</label><input id="agent_offline_min" name="agent_offline_min" inputMode="numeric" defaultValue={cfg.agent_offline_min} className="input" /></div>
        <div className="field"><label className="label" htmlFor="business_from">Program locații de la (ora)</label><input id="business_from" name="business_from" inputMode="numeric" defaultValue={cfg.business_from} className="input" /></div>
        <div className="field"><label className="label" htmlFor="business_to">până la (ora)</label><input id="business_to" name="business_to" inputMode="numeric" defaultValue={cfg.business_to} className="input" /></div>
      </div>
      <p className="text-xs text-muted">În afara programului locațiilor nu se trimit alerte pentru agenții Publine opriți (calculatoarele sunt închise noaptea).</p>
      <Msg state={state} />
      <button className="btn btn-primary" disabled={pending}>Salvează programarea</button>
    </form>
  );
}

export function WebhookForm({ url, secret }: { url: string; secret: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveWebhook, {});
  const [tState, tAction, tPending] = useActionState<FormState, FormData>(testWebhook, {});
  return (
    <div className="space-y-3">
      <form onSubmit={submitKeep(action)} className="space-y-3">
        <div className="field"><label className="label" htmlFor="wh_url">Adresa webhook (n8n / Make)</label><input id="wh_url" name="url" defaultValue={url} placeholder="https://n8n.exemplu.ro/webhook/warose" className="input" /></div>
        {secret && (
          <div className="field">
            <label className="label" htmlFor="wh_secret">Cheie de semnătură (HMAC-SHA256, antet X-Warose-Signature)</label>
            <input id="wh_secret" readOnly value={secret} onFocus={(e) => e.currentTarget.select()} className="input font-mono text-xs" />
          </div>
        )}
        <Msg state={state} />
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={pending}>Salvează</button>
          {secret && <button name="regenerate" value="1" className="btn btn-ghost" disabled={pending}>Generează altă cheie</button>}
        </div>
      </form>
      {url && (
        <form onSubmit={submitKeep(tAction)} className="space-y-2">
          <Msg state={tState} />
          <button className="btn btn-ghost" disabled={tPending}>{tPending ? "Se trimite…" : "Trimite un eveniment de test"}</button>
        </form>
      )}
    </div>
  );
}

export function RunNow({ job, label }: { job: string; label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(runNow, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-2">
      <input type="hidden" name="job" value={job} />
      <button className="btn btn-ghost w-full" disabled={pending}>{pending ? "Rulează…" : label}</button>
      <Msg state={state} />
    </form>
  );
}
