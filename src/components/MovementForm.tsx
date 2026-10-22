"use client";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { recordMovement, type MovementState } from "@/app/(app)/stocuri/actions";

type Opt = { id: number; name: string };

const KINDS = [
  { v: "receipt", l: "Recepție (intrare)" },
  { v: "production", l: "Intrare din producție" },
  { v: "transfer", l: "Transfer către altă locație" },
  { v: "consumption", l: "Consum" },
  { v: "loss", l: "Pierdere / rebut" },
  { v: "adjustment_in", l: "Ajustare plus" },
  { v: "adjustment_out", l: "Ajustare minus" },
];

export function MovementForm({ locations, products, defaultLocationId, defaultKind = "receipt", showLots = false }: {
  locations: Opt[]; products: (Opt & { unit: string })[]; defaultLocationId?: number; defaultKind?: string; showLots?: boolean;
}) {
  const [state, action, pending] = useActionState<MovementState, FormData>(recordMovement, {});
  const [kind, setKind] = useState(defaultKind);
  const [productId, setProductId] = useState<number | "">("");
  const formRef = useRef<HTMLFormElement>(null);
  const unit = products.find((p) => p.id === productId)?.unit ?? "";

  useEffect(() => {
    if (state.ok) {
      formRef.current?.querySelectorAll<HTMLInputElement>("input[data-reset]").forEach((i) => (i.value = ""));
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      className="space-y-4"
      // Trimitere manuală: React resetează automat formularele cu action={}, iar la o eroare utilizatorul ar pierde datele.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label className="label" htmlFor="kind">Operațiune</label>
          <select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
            {KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="location_id">{kind === "transfer" ? "Din locația" : "Locația"}</label>
          <select id="location_id" name="location_id" defaultValue={defaultLocationId} className="input">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        {kind === "transfer" && (
          <div className="field sm:col-span-2">
            <label className="label" htmlFor="to_location_id">Către locația</label>
            <select id="to_location_id" name="to_location_id" className="input" required>
              <option value="">Alegeți…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}
        <div className="field sm:col-span-2">
          <label className="label" htmlFor="product_id">Produs</label>
          <select id="product_id" name="product_id" required className="input" value={productId} onChange={(e) => setProductId(Number(e.target.value) || "")}>
            <option value="">Alegeți produsul…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="qty">Cantitate {unit && <span className="text-muted">({unit})</span>}</label>
          <input id="qty" name="qty" inputMode="decimal" required className="input" data-reset placeholder="0" />
        </div>
        <div className="field">
          <label className="label" htmlFor="document_ref">Document</label>
          <input id="document_ref" name="document_ref" className="input" data-reset placeholder="nr. aviz / bon / NIR" />
        </div>
        {showLots && (
          <>
            <div className="field">
              <label className="label" htmlFor="lot">Lot</label>
              <input id="lot" name="lot" className="input" data-reset placeholder="opțional" />
            </div>
            <div className="field">
              <label className="label" htmlFor="produced_on">Data producției</label>
              <input id="produced_on" name="produced_on" type="date" className="input" data-reset />
            </div>
            <div className="field sm:col-span-2">
              <label className="label" htmlFor="expires_on">Expiră la</label>
              <input id="expires_on" name="expires_on" type="date" className="input" data-reset />
            </div>
          </>
        )}
        <div className="field sm:col-span-2">
          <label className="label" htmlFor="note">Observații {["loss", "adjustment_in", "adjustment_out"].includes(kind) && <span className="text-bad">*</span>}</label>
          <input id="note" name="note" className="input" data-reset placeholder={kind === "loss" ? "motivul pierderii" : "opțional"} />
        </div>
      </div>
      {state.error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good" role="status">{state.ok}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Se înregistrează…" : "Înregistrează"}</button>
    </form>
  );
}
