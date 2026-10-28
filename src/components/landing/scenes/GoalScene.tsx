"use client";

// Scene: a savings goal as a glass vessel. Add or withdraw (sample money) and
// watch it fill; every movement lands in the goal's ledger, as in the app.

import { useState } from "react";
import { formatINR } from "@/lib/money";

const TARGET = 2_00_000_00;
const MONTHLY = 10_000_00;

type Entry = { id: number; label: string; paise: number };

const START: Entry[] = [
  { id: 1, label: "Opening balance", paise: 80_000_00 },
  { id: 2, label: "September", paise: 10_000_00 },
  { id: 3, label: "October", paise: 10_000_00 },
];

export function GoalScene() {
  const [ledger, setLedger] = useState<Entry[]>(START);
  const saved = ledger.reduce((a, e) => a + e.paise, 0);
  const pct = Math.min(saved / TARGET, 1);
  const monthsLeft = Math.max(Math.ceil((TARGET - saved) / MONTHLY), 0);

  function move(paise: number, label: string) {
    setLedger((l) => {
      const total = l.reduce((a, e) => a + e.paise, 0);
      if (total + paise < 0 || (paise > 0 && total >= TARGET)) return l;
      return [...l, { id: l[l.length - 1].id + 1, label, paise }];
    });
  }

  return (
    <div className="grid items-center gap-12 md:grid-cols-[minmax(0,20rem)_1fr] md:gap-20">
      <div data-reveal className="relative mx-auto w-48 sm:w-56">
        {/* The vessel */}
        <div className="vessel relative aspect-[0.52] overflow-hidden rounded-[999px_999px_42px_42px] border border-white/15 bg-white/[0.025] shadow-[inset_0_0_40px_rgb(255_255_255/0.04),0_40px_80px_-30px_rgb(0_0_0/0.9)]">
          <div
            className="vessel-fill absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#8a6a3c] via-brass to-[#e2c48f]"
            style={{ height: `${pct * 100}%` }}
          >
            <div className="vessel-surface absolute inset-x-0 top-0 h-3 -translate-y-1/2 rounded-[50%] bg-[#ecd3a3]/80" />
          </div>
          {/* Graduations */}
          {[0.25, 0.5, 0.75].map((g) => (
            <div key={g} className="absolute right-0 flex items-center gap-2" style={{ bottom: `${g * 100}%` }} aria-hidden>
              <span className="font-mono text-[9px] text-ink-3">{g * 100}%</span>
              <span className="h-px w-4 bg-white/25" />
            </div>
          ))}
          <div className="pointer-events-none absolute inset-y-6 left-4 w-3 rounded-full bg-gradient-to-b from-white/20 to-transparent" aria-hidden />
        </div>
        <div className="mx-auto mt-4 h-4 w-40 rounded-[50%] bg-black/60 blur-md" aria-hidden />
      </div>

      <div>
        <div data-reveal className="font-display text-[clamp(2.6rem,6vw,4.5rem)] leading-none text-ink">
          <span className="num">{formatINR(saved)}</span>
        </div>
        <p data-reveal className="mt-3 font-mono text-sm text-ink-3" aria-live="polite">
          of {formatINR(TARGET)} · {Math.round(pct * 100)}% ·{" "}
          {monthsLeft === 0 ? <span className="text-mint">goal reached</span> : `${monthsLeft} months to go at ${formatINR(MONTHLY)}/month`}
        </p>

        <div data-reveal className="mt-8 flex flex-wrap gap-2">
          <button type="button" onClick={() => move(10_000_00, "Contribution")} disabled={saved >= TARGET} className="press rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-studio hover:bg-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass">
            Add ₹10,000
          </button>
          <button type="button" onClick={() => move(25_000_00, "Bonus")} disabled={saved >= TARGET} className="press rounded-full border border-line-strong px-5 py-2.5 text-sm font-semibold text-ink hover:bg-white/[0.04] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-brass">
            Add ₹25,000
          </button>
          <button type="button" onClick={() => move(-15_000_00, "Withdrawal")} disabled={saved < 15_000_00} className="press rounded-full border border-line-strong px-5 py-2.5 text-sm font-semibold text-ink-2 hover:bg-white/[0.04] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-brass">
            Withdraw ₹15,000
          </button>
          <button type="button" onClick={() => setLedger(START)} className="press rounded-full px-4 py-2.5 text-sm font-medium text-ink-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-brass">
            Reset
          </button>
        </div>

        <ul className="mt-8 divide-y divide-line border-y border-line font-mono text-[13px]" aria-label="Goal ledger (sample)">
          {ledger
            .slice(-5)
            .reverse()
            .map((e) => (
              <li key={e.id} className="ledger-row flex justify-between py-2.5">
                <span className="text-ink-2">{e.label}</span>
                <span className={e.paise < 0 ? "text-ember" : "text-ink"}>
                  {e.paise < 0 ? "−" : "+"}
                  {formatINR(Math.abs(e.paise))}
                </span>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
