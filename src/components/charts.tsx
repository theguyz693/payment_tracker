"use client";

// Chart wrappers on Recharts, themed with the app's CSS tokens so they follow
// light/dark mode. Money arrives as paise and is shown as rupees.

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatINR } from "@/lib/money";

const C = {
  in: "var(--color-receive)",
  out: "var(--color-pay)",
  invest: "var(--color-invest)",
  save: "var(--color-save)",
  gain: "var(--color-gain)",
  loss: "var(--color-loss)",
  gold: "var(--color-gold)",
  grid: "var(--color-line)",
  axis: "var(--color-ink-3)",
  ink: "var(--color-ink)",
  pending: "var(--color-pending)",
};

/** Categorical palette for donuts (distinct in both themes). */
export const PALETTE = ["#3a4bd1", "#0a7d62", "#a26a08", "#6d4bd8", "#0b6fa4", "#c2410c", "#be185d", "#4d7c0f", "#64748b"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(m: string): string {
  const [y, mm] = m.split("-").map(Number);
  return `${MONTHS[mm - 1]} '${String(y).slice(2)}`;
}

/** ₹1.2L / ₹3.4Cr / ₹12K compact axis labels (Indian units). */
function compact(paise: number): string {
  const r = Math.abs(paise) / 100;
  const sign = paise < 0 ? "−" : "";
  if (r >= 1e7) return `${sign}₹${(r / 1e7).toFixed(1).replace(/\.0$/, "")}Cr`;
  if (r >= 1e5) return `${sign}₹${(r / 1e5).toFixed(1).replace(/\.0$/, "")}L`;
  if (r >= 1e3) return `${sign}₹${(r / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `${sign}₹${Math.round(r)}`;
}

const axisProps = { stroke: C.axis, fontSize: 11, tickLine: false, axisLine: false } as const;

function TooltipBox({ active, payload, label, labelFormatter }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; dataKey?: string }[]; label?: string; labelFormatter?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <div className="mb-1 font-semibold text-ink">{labelFormatter ? labelFormatter(String(label)) : label}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink-2">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="num font-semibold text-ink">{typeof p.value === "number" ? formatINR(p.value) : "—"}</span>
        </div>
      ))}
    </div>
  );
}

function Frame({ height = 260, children, label }: { height?: number; children: React.ReactElement; label: string }) {
  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/** Monthly incoming vs outgoing bars with a net line. */
export function CashFlowChart({
  data,
  height,
}: {
  data: { month: string; incomingPaise: number; outgoingPaise: number; investedPaise: number; netPaise: number }[];
  height?: number;
}) {
  const showInvest = data.some((d) => d.investedPaise !== 0);
  return (
    <Frame height={height} label="Income versus expenses by month">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps} />
        <YAxis tickFormatter={compact} width={56} {...axisProps} />
        <Tooltip content={<TooltipBox labelFormatter={monthLabel} />} cursor={{ fill: "var(--color-canvas)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine y={0} stroke={C.grid} />
        <Bar dataKey="incomingPaise" name="Money in" fill={C.in} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="outgoingPaise" name="Spending" fill={C.out} radius={[4, 4, 0, 0]} maxBarSize={28} />
        {showInvest && <Bar dataKey="investedPaise" name="Invested (net)" fill={C.invest} radius={[4, 4, 0, 0]} maxBarSize={28} />}
        <Line dataKey="netPaise" name="Net cash flow" stroke={C.ink} strokeWidth={2} dot={{ r: 2.5 }} type="monotone" />
      </ComposedChart>
    </Frame>
  );
}

/** Net cash flow per month, green above zero and red below. */
export function NetFlowChart({ data, height = 200 }: { data: { month: string; netPaise: number }[]; height?: number }) {
  return (
    <Frame height={height} label="Monthly net cash flow">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps} />
        <YAxis tickFormatter={compact} width={56} {...axisProps} />
        <Tooltip content={<TooltipBox labelFormatter={monthLabel} />} cursor={{ fill: "var(--color-canvas)" }} />
        <ReferenceLine y={0} stroke={C.axis} />
        <Bar dataKey="netPaise" name="Net" radius={[4, 4, 4, 4]} maxBarSize={32}>
          {data.map((d) => (
            <Cell key={d.month} fill={d.netPaise >= 0 ? C.gain : C.loss} />
          ))}
        </Bar>
      </BarChart>
    </Frame>
  );
}

/** Simple monthly bars (e.g. recurring commitments next 12 months). */
export function MonthlyBars({
  data,
  name,
  tone = "out",
  height = 200,
}: {
  data: { month: string; totalPaise: number }[];
  name: string;
  tone?: keyof typeof C;
  height?: number;
}) {
  return (
    <Frame height={height} label={name}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps} />
        <YAxis tickFormatter={compact} width={56} {...axisProps} />
        <Tooltip content={<TooltipBox labelFormatter={monthLabel} />} cursor={{ fill: "var(--color-canvas)" }} />
        <Bar dataKey="totalPaise" name={name} fill={C[tone]} radius={[4, 4, 0, 0]} maxBarSize={32} />
      </BarChart>
    </Frame>
  );
}

/** Donut with a legend list beside it. */
export function Donut({
  data,
  height = 200,
  label,
  centerLabel,
  centerValue,
}: {
  data: { name: string; valuePaise: number; color?: string }[];
  height?: number;
  label: string;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((a, d) => a + d.valuePaise, 0);
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,200px)_1fr]">
      <div className="relative" role="img" aria-label={label} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="valuePaise" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={1.5} stroke="none" isAnimationActive>
              {data.map((d, i) => (
                <Cell key={d.name} fill={d.color ?? PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<TooltipBox />} />
          </PieChart>
        </ResponsiveContainer>
        {centerValue && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="text-[11px] text-ink-3">{centerLabel}</div>
              <div className="num text-sm font-bold">{centerValue}</div>
            </div>
          </div>
        )}
      </div>
      <ul className="space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color ?? PALETTE[i % PALETTE.length] }} />
              <span className="truncate text-ink-2">{d.name}</span>
            </span>
            <span className="num shrink-0 font-semibold">
              {formatINR(d.valuePaise)}
              <span className="ml-1.5 text-xs font-normal text-ink-3">{total ? Math.round((d.valuePaise / total) * 100) : 0}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Projected balance over time (forecast). Two lines: expected and cautious. */
export function BalanceForecastChart({
  data,
  height = 240,
}: {
  data: { date: string; balancePaise: number | null; cautiousBalancePaise: number | null }[];
  height?: number;
}) {
  const fmt = (d: string) => {
    const [, m, day] = d.split("-").map(Number);
    return `${day} ${MONTHS[m - 1]}`;
  };
  return (
    <Frame height={height} label="Projected cash balance">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmt} minTickGap={32} {...axisProps} />
        <YAxis tickFormatter={compact} width={56} {...axisProps} />
        <Tooltip content={<TooltipBox labelFormatter={fmt} />} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine y={0} stroke={C.loss} strokeDasharray="4 4" />
        <Line dataKey="balancePaise" name="With expected money in" stroke={C.in} strokeWidth={2} dot={false} type="stepAfter" />
        <Line dataKey="cautiousBalancePaise" name="If nothing owed to you arrives" stroke={C.pending} strokeWidth={2} strokeDasharray="5 4" dot={false} type="stepAfter" />
      </LineChart>
    </Frame>
  );
}

/** Generic single-series trend line (price history, balance trend). */
export function TrendLine({
  data,
  name,
  tone = "invest",
  height = 220,
  valueIsPrice4 = false,
}: {
  data: { date: string; value: number }[];
  name: string;
  tone?: keyof typeof C;
  height?: number;
  /** Values are 1/10,000 ₹ prices rather than paise. */
  valueIsPrice4?: boolean;
}) {
  const rows = valueIsPrice4 ? data.map((d) => ({ ...d, value: Math.round(d.value / 100) })) : data;
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return `${day} ${MONTHS[m - 1]} '${String(y).slice(2)}`;
  };
  return (
    <Frame height={height} label={name}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`fill-${tone}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C[tone]} stopOpacity={0.25} />
            <stop offset="100%" stopColor={C[tone]} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmt} minTickGap={40} {...axisProps} />
        <YAxis tickFormatter={compact} width={56} domain={["auto", "auto"]} {...axisProps} />
        <Tooltip content={<TooltipBox labelFormatter={fmt} />} />
        <Area dataKey="value" name={name} stroke={C[tone]} strokeWidth={2} fill={`url(#fill-${tone})`} type="monotone" />
      </AreaChart>
    </Frame>
  );
}

/** Stacked monthly contributions vs withdrawals (investments). */
export function ContributionsChart({ data, height = 220 }: { data: { month: string; investedPaise: number; withdrawnPaise: number }[]; height?: number }) {
  return (
    <Frame height={height} label="Investment contributions by month">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps} />
        <YAxis tickFormatter={compact} width={56} {...axisProps} />
        <Tooltip content={<TooltipBox labelFormatter={monthLabel} />} cursor={{ fill: "var(--color-canvas)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="investedPaise" name="Invested" fill={C.invest} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="withdrawnPaise" name="Withdrawn" fill={C.gold} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </Frame>
  );
}

/** Loan balance over time from an amortisation schedule. */
export function LoanBalanceChart({ data, height = 220 }: { data: { date: string; balance: number }[]; height?: number }) {
  return (
    <Frame height={height} label="Loan balance over time">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="date" tickFormatter={(d: string) => monthLabel(d.slice(0, 7))} minTickGap={40} {...axisProps} />
        <YAxis tickFormatter={compact} width={56} {...axisProps} />
        <Tooltip content={<TooltipBox labelFormatter={(d) => monthLabel(d.slice(0, 7))} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Area dataKey="balance" name="Outstanding principal" stroke={C.out} fill={C.out} fillOpacity={0.12} type="monotone" />
      </ComposedChart>
    </Frame>
  );
}
