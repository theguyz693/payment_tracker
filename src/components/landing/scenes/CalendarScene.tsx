"use client";

// Scene: a month of commitments. Pick a day to see what's due and the
// projected balance after it (the app's calendar and cash-flow forecast).

import { useState } from "react";
import { formatINR, formatSignedINR } from "@/lib/money";

type Ev = { title: string; paise: number; kind: "pay" | "receive" | "emi" | "sip" };

const R = (n: number) => n * 100;
const START_BALANCE = R(64_000);

// November 2026 (illustrative). Day -> events.
const EVENTS: Record<number, Ev[]> = {
  1: [{ title: "Rent", paise: -R(25_000), kind: "pay" }],
  3: [{ title: "Arjun pays you back", paise: R(3_000), kind: "receive" }],
  5: [
    { title: "Car loan EMI · 24 of 60", paise: -R(12_500), kind: "emi" },
    { title: "Rent from tenant", paise: R(18_000), kind: "receive" },
  ],
  7: [{ title: "Index fund SIP", paise: -R(10_000), kind: "sip" }],
  10: [{ title: "Streaming subscription", paise: -R(649), kind: "pay" }],
  12: [{ title: "Electricity (estimate)", paise: -R(2_100), kind: "pay" }],
  15: [{ title: "Credit card bill", paise: -R(8_400), kind: "pay" }],
  18: [{ title: "Emergency fund", paise: -R(15_000), kind: "sip" }],
  25: [{ title: "Mobile plan", paise: -R(399), kind: "pay" }],
  30: [{ title: "Salary", paise: R(1_20_000), kind: "receive" }],
};

const DAYS = 30;
const FIRST_WEEKDAY = 6; // 1 Nov 2026 is a Sunday; columns run Mon..Sun
const DOT = { pay: "bg-paper/60", receive: "bg-mint", emi: "bg-ember", sip: "bg-brass" };

function balanceAfter(day: number) {
  let b = START_BALANCE;
  for (let d = 1; d <= day; d++) for (const e of EVENTS[d] ?? []) b += e.paise;
  return b;
}

export function CalendarScene() {
  const [day, setDay] = useState(5);
  const events = EVENTS[day] ?? [];
  const low = Math.min(...Array.from({ length: DAYS }, (_, i) => balanceAfter(i + 1)));

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[1.25fr_1fr] lg:gap-16">
      <div data-reveal>
        <div className="mb-4 flex items-baseline justify-between">
          <span className="font-display font-semibold tracking-[-0.02em] text-3xl text-ink">November</span>
          <span className="font-mono text-xs text-ink-3">2026 · illustrative</span>
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-line bg-line">
          {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
            <div key={i} aria-hidden className="bg-studio py-2 text-center font-mono text-[10px] text-ink-3">
              {w}
            </div>
          ))}
          {Array.from({ length: FIRST_WEEKDAY }, (_, i) => (
            <div key={`pad${i}`} className="bg-studio" aria-hidden />
          ))}
          {Array.from({ length: DAYS }, (_, i) => {
            const n = i + 1;
            const evs = EVENTS[n] ?? [];
            const selected = n === day;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={selected}
                aria-label={`${n} November${evs.length ? `, ${evs.length} item${evs.length > 1 ? "s" : ""}` : ""}`}
                onClick={() => setDay(n)}
                className={`relative flex aspect-square flex-col items-start justify-between p-1.5 text-left transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-brass sm:aspect-[1.15] sm:p-2.5 ${
                  selected ? "bg-paper text-studio" : "bg-studio text-ink-2 hover:bg-[#151517]"
                }`}
              >
                <span className="font-mono text-[11px] sm:text-[13px]">{n}</span>
                <span className="flex gap-1">
                  {evs.map((e, k) => (
                    <span key={k} className={`size-1.5 rounded-full ${selected ? "bg-studio/70" : DOT[e.kind]}`} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-3">
          {(
            [
              ["pay", "Bills & rent"],
              ["emi", "EMIs"],
              ["sip", "SIPs & goals"],
              ["receive", "Money in"],
            ] as const
          ).map(([k, l]) => (
            <span key={k} className="flex items-center gap-2">
              <span className={`size-1.5 rounded-full ${DOT[k]}`} /> {l}
            </span>
          ))}
        </div>
      </div>

      <div data-reveal style={{ "--d": 1 } as React.CSSProperties} className="lg:sticky lg:top-28">
        <div className="font-mono text-[11px] tracking-[0.22em] text-ink-3 uppercase">{day} November</div>
        <ul className="mt-4 min-h-[7.5rem] divide-y divide-line border-y border-line" aria-live="polite">
          {events.length === 0 && <li className="py-4 text-[15px] text-ink-3">Nothing due. A quiet day.</li>}
          {events.map((e) => (
            <li key={e.title} className="flex items-center justify-between gap-4 py-4">
              <span className="flex items-center gap-3 text-[15px] text-ink">
                <span className={`size-2 rounded-full ${DOT[e.kind]}`} />
                {e.title}
              </span>
              <span className={`num font-mono text-[15px] ${e.paise > 0 ? "text-mint" : "text-ink"}`}>{formatSignedINR(e.paise)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-6 grid grid-cols-2 gap-6">
          <div>
            <dt className="font-mono text-[10px] tracking-[0.2em] text-ink-3 uppercase">Forecast after this day</dt>
            <dd className="num mt-2 font-mono text-2xl text-ink">{formatINR(balanceAfter(day))}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] tracking-[0.2em] text-ink-3 uppercase">Lowest point this month</dt>
            <dd className="num mt-2 font-mono text-2xl text-brass">{formatINR(low)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
