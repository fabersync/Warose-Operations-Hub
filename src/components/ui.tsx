import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { fmtPct } from "@/lib/format";

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, subtitle, action, children, className = "", pad = true }: { title?: string; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card min-w-0 ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {/* fără padding = conținut tabelar: derulează orizontal în card, nu lățește pagina */}
      <div className={pad ? "card-pad" : "overflow-x-auto"}>{children}</div>
    </section>
  );
}

export function Delta({ value, invert = false, suffix }: { value: number | null; invert?: boolean; suffix?: string }) {
  if (value == null) return <span className="text-xs text-faint">fără comparație</span>;
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 0.5;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = flat ? "text-muted bg-canvas" : good ? "text-good bg-good-soft" : "text-bad bg-bad-soft";
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium ${tone}`}>
      <Icon className="size-3.5" strokeWidth={2.25} />
      {fmtPct(value)}
      {suffix && <span className="ml-1 font-normal text-muted">{suffix}</span>}
    </span>
  );
}

export function Kpi({ label, value, delta, hint, deltaSuffix }: { label: string; value: React.ReactNode; delta?: number | null; hint?: React.ReactNode; deltaSuffix?: string }) {
  return (
    <div className="card card-pad">
      <div className="eyebrow">{label}</div>
      <div className="mt-2.5 text-[28px] font-semibold leading-none tracking-tight text-ink tabular-nums">{value}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        {delta !== undefined && <Delta value={delta} suffix={deltaSuffix} />}
        {hint}
      </div>
    </div>
  );
}

const TONES = {
  neutral: "bg-canvas text-ink-2 ring-line",
  good: "bg-good-soft text-good ring-good/20",
  bad: "bg-bad-soft text-bad ring-bad/20",
  warn: "bg-warn-soft text-warn ring-warn/20",
  info: "bg-info-soft text-info ring-info/20",
  accent: "bg-crust-soft text-crust ring-crust/20",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-4 grid size-11 place-items-center rounded-xl bg-canvas text-muted ring-1 ring-line">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1.5 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad" | "good"; title?: string; children: React.ReactNode }) {
  const t = { info: "border-info/20 bg-info-soft", warn: "border-warn/25 bg-warn-soft", bad: "border-bad/25 bg-bad-soft", good: "border-good/20 bg-good-soft" }[tone];
  const tt = { info: "text-info", warn: "text-warn", bad: "text-bad", good: "text-good" }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${t}`} role={tone === "bad" ? "alert" : undefined}>
      {title && <div className={`font-semibold ${tt}`}>{title}</div>}
      <div className={title ? "mt-0.5 text-ink-2" : "text-ink-2"}>{children}</div>
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-sm font-medium text-crust hover:text-crust-strong">{children}</Link>;
}
