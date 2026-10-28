"use client";

// A working miniature of the dashboard for the landing page. All figures are
// illustrative samples (labelled as such); nothing here reads user data.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useRef, useState } from "react";
import { AnimatedNumber } from "../AnimatedNumber";
import { formatINR } from "@/lib/money";
import { eyebrow } from "./styles";

type Period = "month" | "quarter";
type Tab = "overview" | "cashflow" | "investments" | "goals";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "cashflow", label: "Cash flow" },
  { key: "investments", label: "Investments" },
  { key: "goals", label: "Goals" },
];

const R = (rupees: number) => rupees * 100;

const OVERVIEW: Record<Period, { pay: number; collect: number; overdue: number; rows: Row[] }> = {
  month: {
    pay: R(48_350),
    collect: R(21_000),
    overdue: 1,
    rows: [
      { title: "Electricity bill", meta: "Bills · 2 days overdue", amount: R(2_100), dir: "pay", overdue: true },
      { title: "Rent", meta: "Housing · due 1 Nov · monthly", amount: R(25_000), dir: "pay" },
      { title: "Arjun (dinner split)", meta: "Owed to you · expected 3 Nov", amount: R(3_000), dir: "receive" },
      { title: "Car loan EMI", meta: "Loans · due 5 Nov · 23 of 60", amount: R(12_500), dir: "pay" },
      { title: "Rent from tenant", meta: "Income · due 5 Nov · monthly", amount: R(18_000), dir: "receive" },
    ],
  },
  quarter: {
    pay: R(1_41_900),
    collect: R(63_000),
    overdue: 1,
    rows: [
      { title: "Electricity bill", meta: "Bills · 2 days overdue", amount: R(2_100), dir: "pay", overdue: true },
      { title: "Rent × 3", meta: "Housing · monthly", amount: R(75_000), dir: "pay" },
      { title: "Car loan EMI × 3", meta: "Loans · monthly", amount: R(37_500), dir: "pay" },
      { title: "Rent from tenant × 3", meta: "Income · monthly", amount: R(54_000), dir: "receive" },
      { title: "Car insurance", meta: "Insurance · due 18 Dec · yearly", amount: R(14_200), dir: "pay" },
    ],
  },
};

type Row = { title: string; meta: string; amount: number; dir: "pay" | "receive"; overdue?: boolean };

const FLOW: Record<Period, { label: string; in: number; out: number }[]> = {
  month: [
    { label: "Wk 1", in: R(1_20_000), out: R(52_400) },
    { label: "Wk 2", in: R(3_000), out: R(9_800) },
    { label: "Wk 3", in: R(18_000), out: R(21_300) },
    { label: "Wk 4", in: R(0), out: R(14_650) },
  ],
  quarter: [
    { label: "Aug", in: R(1_41_000), out: R(1_02_300) },
    { label: "Sep", in: R(1_38_000), out: R(1_09_900) },
    { label: "Oct", in: R(1_41_000), out: R(98_150) },
  ],
};

const HOLDINGS = [
  { name: "Nifty 50 index fund", meta: "Mutual fund · SIP ₹10,000/month", invested: R(2_40_000), value: R(2_79_400), source: "AMFI daily NAV" },
  { name: "Gold, 10 g", meta: "Gold", invested: R(80_000), value: R(91_200), source: "Price you entered" },
  { name: "Nifty BeES", meta: "ETF · 150 units", invested: R(40_000), value: R(42_250), source: "Delayed quote" },
];

const GOALS = [
  { name: "Emergency fund", saved: R(1_36_000), target: R(2_00_000), note: "On track for Mar 2027" },
  { name: "New laptop", saved: R(1_02_000), target: R(1_20_000), note: "₹18,000 to go" },
  { name: "Goa, December", saved: R(24_000), target: R(60_000), note: "Needs ₹18,000/month to make it" },
];

export function ProductPreview() {
  const [tab, setTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<Period>("month");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const reduce = useReducedMotion();
  const periodMatters = tab === "overview" || tab === "cashflow";

  function onTabKey(e: React.KeyboardEvent, i: number) {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + TABS.length) % TABS.length;
    setTab(TABS[next].key);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[15rem_1fr] lg:gap-14">
      <div className="flex min-w-0 flex-col gap-6">
        <div role="tablist" aria-label="Preview sections" aria-orientation="vertical" className="flex gap-1 overflow-x-auto lg:flex-col">
          {TABS.map((t, i) => (
            <button
              key={t.key}
              ref={(el) => void (tabRefs.current[i] = el)}
              role="tab"
              id={`${id}-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`${id}-panel`}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => setTab(t.key)}
              onKeyDown={(e) => onTabKey(e, i)}
              className="press group flex shrink-0 items-center gap-3 rounded-full px-4 py-2.5 text-left text-[15px] font-medium text-ink-3 transition-colors hover:text-ink aria-selected:bg-white/[0.06] aria-selected:text-ink focus-visible:outline-2 focus-visible:outline-brass lg:rounded-xl"
            >
              <span className="hidden font-mono text-[10px] text-ink-3 lg:inline">0{i + 1}</span>
              {t.label}
            </button>
          ))}
        </div>
        <p className="hidden text-sm leading-relaxed text-ink-3 lg:block">
          Use the tabs and the period switch. Figures are samples, not a real account.
        </p>
      </div>

      <div className="preview-device relative min-w-0 overflow-hidden rounded-[28px] border border-line-strong bg-[#111113] shadow-[0_40px_120px_-40px_rgb(0_0_0/0.9)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <span className="flex gap-1.5" aria-hidden>
              <span className="size-2.5 rounded-full bg-white/10" />
              <span className="size-2.5 rounded-full bg-white/10" />
              <span className="size-2.5 rounded-full bg-white/10" />
            </span>
            <span className={`${eyebrow} rounded-full border border-brass/40 px-2.5 py-1 text-[9.5px] text-brass`}>Illustrative data</span>
          </div>
          <div role="radiogroup" aria-label="Period" className="flex rounded-full border border-line p-0.5 text-[13px]" aria-disabled={!periodMatters}>
            {(["month", "quarter"] as const).map((p) => (
              <button
                key={p}
                role="radio"
                aria-checked={period === p}
                disabled={!periodMatters}
                onClick={() => setPeriod(p)}
                className="press rounded-full px-3 py-1 font-medium text-ink-3 transition-colors aria-checked:bg-paper aria-checked:text-studio disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-brass"
              >
                {p === "month" ? "This month" : "3 months"}
              </button>
            ))}
          </div>
        </div>

        <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} className="min-h-[29rem] p-5 sm:p-7">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={reduce ? false : { opacity: 0, y: 10, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={reduce ? undefined : { opacity: 0, y: -6, filter: "blur(4px)" }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              {tab === "overview" && <Overview period={period} />}
              {tab === "cashflow" && <CashFlow period={period} />}
              {tab === "investments" && <Investments />}
              {tab === "goals" && <Goals />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Readout({ label, paise, tone = "ink" }: { label: string; paise: number; tone?: "ink" | "mint" | "brass" }) {
  const color = tone === "mint" ? "text-mint" : tone === "brass" ? "text-brass" : "text-ink";
  return (
    <div>
      <div className={`${eyebrow} text-[10px] text-ink-3`}>{label}</div>
      <div className={`num mt-2 font-mono text-2xl font-medium tracking-tight sm:text-[1.9rem] ${color}`}>
        <AnimatedNumber paise={paise} />
      </div>
    </div>
  );
}

function Overview({ period }: { period: Period }) {
  const o = OVERVIEW[period];
  return (
    <div>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
        <Readout label="To pay" paise={o.pay} />
        <Readout label="To collect" paise={o.collect} tone="mint" />
        <div className="col-span-2 sm:col-span-1">
          <div className={`${eyebrow} text-[10px] text-ink-3`}>Overdue</div>
          <div className="mt-2 flex items-center gap-2 font-mono text-2xl text-ember sm:text-[1.9rem]">
            {o.overdue}
            <span className="text-sm text-ink-3">item</span>
          </div>
        </div>
      </div>
      <ul className="mt-8 divide-y divide-line border-y border-line">
        {o.rows.map((r) => (
          <li key={r.title} className="group flex items-center gap-4 py-3.5 transition-colors hover:bg-white/[0.02]">
            <span
              aria-hidden
              className={`h-8 w-[3px] shrink-0 rounded-full ${r.overdue ? "bg-ember" : r.dir === "receive" ? "bg-mint" : "bg-paper/50"}`}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium text-ink">{r.title}</div>
              <div className="truncate text-[12.5px] text-ink-3">{r.meta}</div>
            </div>
            <div className={`num font-mono text-[15px] ${r.dir === "receive" ? "text-mint" : "text-ink"}`}>
              {r.dir === "receive" ? "+" : ""}
              {formatINR(r.amount)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CashFlow({ period }: { period: Period }) {
  const rows = FLOW[period];
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...rows.flatMap((r) => [r.in, r.out]));
  const totalIn = rows.reduce((a, r) => a + r.in, 0);
  const totalOut = rows.reduce((a, r) => a + r.out, 0);
  const focus = hover === null ? null : rows[hover];
  return (
    <div>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
        <Readout label="Came in" paise={focus ? focus.in : totalIn} tone="mint" />
        <Readout label="Went out" paise={focus ? focus.out : totalOut} />
        <div className="col-span-2 sm:col-span-1">
          <Readout label={focus ? `Net, ${focus.label}` : "Net"} paise={focus ? focus.in - focus.out : totalIn - totalOut} tone="brass" />
        </div>
      </div>
      <div className="mt-10 flex h-56 items-end gap-3 border-b border-line sm:gap-6" onMouseLeave={() => setHover(null)}>
        {rows.map((r, i) => (
          <button
            key={r.label}
            type="button"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`${r.label}: ${formatINR(r.in)} in, ${formatINR(r.out)} out`}
            className={`group flex h-full flex-1 items-end justify-center gap-1.5 rounded-t-lg pb-0 transition-opacity focus-visible:outline-2 focus-visible:outline-brass ${
              hover !== null && hover !== i ? "opacity-40" : ""
            }`}
          >
            <span className="bar-grow w-full max-w-7 rounded-t-[3px] bg-mint/80" style={{ height: `${(r.in / max) * 100}%`, "--i": i } as React.CSSProperties} />
            <span className="bar-grow w-full max-w-7 rounded-t-[3px] bg-paper/35" style={{ height: `${(r.out / max) * 100}%`, "--i": i } as React.CSSProperties} />
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-3 sm:gap-6">
        {rows.map((r) => (
          <div key={r.label} className="flex-1 text-center font-mono text-[11px] text-ink-3">
            {r.label}
          </div>
        ))}
      </div>
      <div className="mt-5 flex gap-5 text-xs text-ink-3">
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-mint/80" /> In
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-paper/35" /> Out
        </span>
        <span className="ml-auto hidden sm:inline">Hover or focus a column for details</span>
      </div>
    </div>
  );
}

function Investments() {
  const invested = HOLDINGS.reduce((a, h) => a + h.invested, 0);
  const value = HOLDINGS.reduce((a, h) => a + h.value, 0);
  const pct = ((value - invested) / invested) * 100;
  return (
    <div>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
        <Readout label="Invested" paise={invested} />
        <Readout label="Current value" paise={value} tone="mint" />
        <div className="col-span-2 sm:col-span-1">
          <div className={`${eyebrow} text-[10px] text-ink-3`}>Gain</div>
          <div className="mt-2 font-mono text-2xl text-mint sm:text-[1.9rem]">+{pct.toFixed(1)}%</div>
        </div>
      </div>
      <ul className="mt-8 divide-y divide-line border-y border-line">
        {HOLDINGS.map((h) => {
          const g = ((h.value - h.invested) / h.invested) * 100;
          return (
            <li key={h.name} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-3.5">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium text-ink">{h.name}</div>
                <div className="truncate text-[12.5px] text-ink-3">{h.meta}</div>
              </div>
              <div className="text-right">
                <div className="num font-mono text-[15px] text-ink">{formatINR(h.value)}</div>
                <div className="font-mono text-[12px] text-mint">+{g.toFixed(1)}%</div>
              </div>
              <div className="col-span-2 font-mono text-[10.5px] tracking-wide text-ink-3">Price: {h.source}</div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs leading-relaxed text-ink-3">
        Every price shows where it came from and when. If no price is available, the app asks you for one instead of guessing.
      </p>
    </div>
  );
}

function Goals() {
  return (
    <ul className="space-y-7 pt-1">
      {GOALS.map((g, i) => {
        const pct = Math.round((g.saved / g.target) * 100);
        return (
          <li key={g.name}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-display font-semibold tracking-[-0.02em] text-2xl text-ink">{g.name}</span>
              <span className="font-mono text-sm text-ink-2">{pct}%</span>
            </div>
            <div className="mt-3 h-[6px] overflow-hidden rounded-full bg-white/[0.06]">
              <div className="bar-fill h-full rounded-full bg-gradient-to-r from-brass/70 to-brass" style={{ width: `${pct}%`, "--i": i } as React.CSSProperties} />
            </div>
            <div className="mt-2 flex justify-between gap-4 font-mono text-[12px] text-ink-3">
              <span>
                {formatINR(g.saved)} of {formatINR(g.target)}
              </span>
              <span className="text-right">{g.note}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
