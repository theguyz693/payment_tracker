// Scene: two years of SIP contributions against portfolio value. Static SVG;
// the lines draw in when revealed (CSS). Values are a deterministic sample.

import { formatINR } from "@/lib/money";

const MONTHS = 24;
const SIP = 10_000;

function series() {
  const contrib: number[] = [];
  const value: number[] = [];
  let v = 0;
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let m = 0; m < MONTHS; m++) {
    v = (v + SIP) * (1 + 0.009 + rand() * 0.045);
    contrib.push(SIP * (m + 1));
    value.push(Math.round(v));
  }
  return { contrib, value };
}

const W = 1000;
const H = 360;

export function InvestScene() {
  const { contrib, value } = series();
  const max = Math.max(...value, ...contrib) * 1.08;
  const x = (i: number) => (i / (MONTHS - 1)) * W;
  const y = (n: number) => H - (n / max) * H;
  const line = (arr: number[]) => arr.map((n, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join(" ");
  // Contributions as a step line (money goes in once a month).
  const steps = `M0 ${y(contrib[0]).toFixed(1)}` + contrib.slice(1).map((n, i) => ` L${x(i + 1).toFixed(1)} ${y(contrib[i]).toFixed(1)} L${x(i + 1).toFixed(1)} ${y(n).toFixed(1)}`).join("");
  const last = value[MONTHS - 1];
  const invested = contrib[MONTHS - 1];
  const gain = last - invested;

  return (
    <div data-reveal className="invest-scene relative">
      <div className="grid gap-8 md:grid-cols-3">
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-ink-3 uppercase">Put in</div>
          <div className="num mt-2 font-display text-4xl font-semibold tracking-[-0.04em] sm:text-5xl text-ink">{formatINR(invested * 100)}</div>
        </div>
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-ink-3 uppercase">Worth now</div>
          <div className="num mt-2 font-display text-4xl font-semibold tracking-[-0.04em] sm:text-5xl text-mint">{formatINR(last * 100)}</div>
        </div>
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-ink-3 uppercase">Difference</div>
          <div className="num mt-2 font-display text-4xl font-semibold tracking-[-0.04em] sm:text-5xl text-brass">+{formatINR(gain * 100)}</div>
        </div>
      </div>

      <div className="relative mt-10">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" aria-hidden>
          {[0.25, 0.5, 0.75, 1].map((g) => (
            <line key={g} x1="0" x2={W} y1={H - g * H} y2={H - g * H} stroke="rgb(236 230 218 / 0.06)" />
          ))}
          <path d={`${steps} L${W} ${H} L0 ${H} Z`} fill="rgb(236 230 218 / 0.05)" />
          <path className="draw" pathLength={1} d={steps} fill="none" stroke="rgb(236 230 218 / 0.45)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <path className="draw draw-late" pathLength={1} d={line(value)} fill="none" stroke="#8fd9bf" strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          <circle className="draw-dot" cx={x(MONTHS - 1)} cy={y(last)} r="5" fill="#8fd9bf" />
          <circle className="draw-dot" cx={x(MONTHS - 1)} cy={y(last)} r="12" fill="none" stroke="#8fd9bf" strokeOpacity="0.35" />
          {/* One-year mark: annualised returns (XIRR) are shown only after this. */}
          <line x1={x(11)} x2={x(11)} y1="0" y2={H} stroke="#c9a46b" strokeOpacity="0.5" strokeDasharray="3 5" />
        </svg>
        <div className="pointer-events-none absolute top-0 font-mono text-[10px] tracking-[0.15em] text-brass uppercase" style={{ left: `calc(${(11 / (MONTHS - 1)) * 100}% + 8px)` }}>
          1 year · XIRR from here
        </div>
        <div className="mt-3 flex justify-between font-mono text-[11px] text-ink-3">
          <span>Month 1</span>
          <span>Month 12</span>
          <span>Month 24</span>
        </div>
      </div>
      <p className="sr-only">
        Illustrative SIP of {formatINR(SIP * 100)} a month for {MONTHS} months: {formatINR(invested * 100)} invested, worth {formatINR(last * 100)}.
      </p>
    </div>
  );
}
