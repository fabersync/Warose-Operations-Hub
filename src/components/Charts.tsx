"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const ron = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("ro-RO", { notation: "compact", maximumFractionDigits: 1 });
const dayLabel = (iso: string) => new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
const weekday = (iso: string) => new Intl.DateTimeFormat("ro-RO", { weekday: "long", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));

function TooltipBox({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-ink">{dayLabel(label)} <span className="font-normal text-muted">· {weekday(label)}</span></div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-ink-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium tabular-nums text-ink">{ron.format(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function SalesTrend({ data, height = 260 }: { data: { day: string; net: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="crust" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8a5a2e" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#8a5a2e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#ece9e3" vertical={false} />
        <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: "#7c766d", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
        <YAxis tickFormatter={(v) => compact.format(v)} tick={{ fill: "#7c766d", fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
        <Tooltip content={<TooltipBox />} cursor={{ stroke: "#d9d4cb" }} />
        <Area type="monotone" dataKey="net" name="Vânzări nete" stroke="#8a5a2e" strokeWidth={2} fill="url(#crust)" dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Vânzări pe ore: unde e vârful zilei. */
export function HourBars({ data, height = 220 }: { data: { hour: number; net: number; receipts: number }[]; height?: number }) {
  const max = Math.max(...data.map((d) => d.net), 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="hourbar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#b07a45" /><stop offset="100%" stopColor="#8a5a2e" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#ece9e3" vertical={false} />
        <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} tick={{ fill: "#7c766d", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={8} />
        <YAxis tickFormatter={(v) => compact.format(v)} tick={{ fill: "#7c766d", fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
        <Tooltip cursor={{ fill: "#f6f5f2" }} content={({ active, payload }: any) => active && payload?.length ? (
          <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
            <div className="mb-1 font-medium text-ink">{payload[0].payload.hour}:00 – {payload[0].payload.hour + 1}:00</div>
            <div className="text-ink-2">Vânzări nete: <b className="tabular-nums text-ink">{ron.format(payload[0].payload.net)}</b></div>
            <div className="text-ink-2">Bonuri: <b className="tabular-nums text-ink">{payload[0].payload.receipts}</b></div>
          </div>) : null} />
        <Bar dataKey="net" name="Vânzări nete" radius={[4, 4, 0, 0]} maxBarSize={26}>
          {data.map((d) => <Cell key={d.hour} fill={d.net === max && max > 0 ? "url(#hourbar)" : "#d9cbb8"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const PALETTE = ["#8a5a2e", "#1d1b18", "#c08a52", "#6b7a5a", "#a3a09a", "#d9b48a", "#4f5d73", "#b9564a"];

/** Structura (categorii, metode de plată): inel cu legendă. */
export function Donut({ data, height = 200 }: { data: { name: string; value: number }[]; height?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={1.5} stroke="none" isAnimationActive>
              {data.map((d, i) => <Cell key={d.name} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip content={({ active, payload }: any) => active && payload?.length ? (
              <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"><b className="text-ink">{payload[0].name}</b>: {ron.format(payload[0].value)} ({Math.round((payload[0].value / total) * 1000) / 10}%)</div>) : null} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div><div className="text-[11px] uppercase tracking-wider text-muted">Total</div><div className="text-sm font-semibold tabular-nums text-ink">{compact.format(total)}</div></div>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-1.5 text-xs">
        {data.slice(0, 8).map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="min-w-0 flex-1 truncate text-ink-2">{d.name}</span>
            <span className="tabular-nums text-muted">{Math.round((d.value / total) * 1000) / 10}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mini-grafic pentru cardurile KPI. */
export function Sparkline({ data, height = 40 }: { data: number[]; height?: number }) {
  const points = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e9c79f" stopOpacity={0.5} /><stop offset="100%" stopColor="#e9c79f" stopOpacity={0} /></linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke="#e9c79f" strokeWidth={1.75} fill="url(#spark)" dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DailyBars({ data, height = 220 }: { data: { day: string; net: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#ece9e3" vertical={false} />
        <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: "#7c766d", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={20} />
        <YAxis tickFormatter={(v) => compact.format(v)} tick={{ fill: "#7c766d", fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: "#f6f5f2" }} />
        <Bar dataKey="net" name="Vânzări nete" fill="#1d1b18" radius={[3, 3, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}
