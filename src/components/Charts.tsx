"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
