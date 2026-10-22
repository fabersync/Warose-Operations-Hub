import { CheckCircle2, CircleDashed, HelpCircle } from "lucide-react";
import { Card, PageHeader } from "./ui";

/** Pagină pentru modulele încă neimplementate: arată clar ce va face și ce date trebuie validate, fără date false. */
export function Roadmap({ title, stage, description, features, needs, ready = [] }: {
  title: string; stage: string; description: string; features: string[]; needs: string[]; ready?: string[];
}) {
  return (
    <>
      <PageHeader eyebrow={`${stage} · în dezvoltare`} title={title} description={description} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Ce va face modulul">
          <ul className="space-y-2.5 text-sm">
            {features.map((f) => <li key={f} className="flex gap-2.5 text-ink-2"><CircleDashed className="mt-0.5 size-4 shrink-0 text-faint" />{f}</li>)}
          </ul>
        </Card>
        <div className="space-y-4">
          {ready.length > 0 && (
            <Card title="Deja pregătit în fundație">
              <ul className="space-y-2.5 text-sm">
                {ready.map((f) => <li key={f} className="flex gap-2.5 text-ink-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" />{f}</li>)}
              </ul>
            </Card>
          )}
          <Card title="Ce trebuie validat înainte de implementare">
            <ul className="space-y-2.5 text-sm">
              {needs.map((f) => <li key={f} className="flex gap-2.5 text-ink-2"><HelpCircle className="mt-0.5 size-4 shrink-0 text-warn" />{f}</li>)}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
