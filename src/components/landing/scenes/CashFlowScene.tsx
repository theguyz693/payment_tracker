// Scene: a month's money flowing from where it came in to where it went.
// Static SVG (server-rendered); the ribbons draw in when revealed (CSS).

import { formatINR } from "@/lib/money";

const IN = [
  { label: "Salary", v: 1_20_000 },
  { label: "Rent collected", v: 18_000 },
];
const OUT = [
  { label: "Rent", v: 25_000, tone: "paper" },
  { label: "Car loan EMI", v: 12_500, tone: "paper" },
  { label: "Bills & subscriptions", v: 9_400, tone: "paper" },
  { label: "SIP", v: 10_000, tone: "brass" },
  { label: "Savings goals", v: 15_000, tone: "brass" },
  { label: "Everyday spending", v: 41_000, tone: "dim" },
  { label: "Left over", v: 25_100, tone: "mint" },
] as const;

const TOTAL = IN.reduce((a, x) => a + x.v, 0);
const GAP = 3.2;
const S = (100 - GAP * (OUT.length - 1)) / TOTAL; // % of height per rupee
const CENTER_TOP = (100 - TOTAL * S) / 2;
const FILL = { paper: "rgb(236 230 218 / 0.16)", brass: "rgb(201 164 107 / 0.42)", dim: "rgb(236 230 218 / 0.08)", mint: "rgb(143 217 191 / 0.35)" };

function ribbon(x0: number, a0: number, a1: number, x1: number, b0: number, b1: number) {
  const xm = (x0 + x1) / 2;
  return `M${x0} ${a0} C${xm} ${a0} ${xm} ${b0} ${x1} ${b0} L${x1} ${b1} C${xm} ${b1} ${xm} ${a1} ${x0} ${a1} Z`;
}

function layout() {
  const inGap = (100 - TOTAL * S) / (IN.length - 1);
  let y = 0;
  let c = CENTER_TOP;
  const inputs = IN.map((x) => {
    const h = x.v * S;
    const seg = { ...x, y0: y, y1: y + h, c0: c, c1: c + h };
    y += h + inGap;
    c += h;
    return seg;
  });
  y = 0;
  c = CENTER_TOP;
  const outputs = OUT.map((x) => {
    const h = x.v * S;
    const seg = { ...x, y0: y, y1: y + h, c0: c, c1: c + h };
    y += h + GAP;
    c += h;
    return seg;
  });
  return { inputs, outputs };
}

export function CashFlowScene() {
  const { inputs, outputs } = layout();
  return (
    <div data-reveal className="flow-scene grid grid-cols-[5.5rem_1fr_6.5rem] gap-2 sm:grid-cols-[9rem_1fr_11rem] sm:gap-4">
      <div className="relative h-[26rem] sm:h-[30rem]">
        {inputs.map((x) => (
          <div key={x.label} className="absolute right-0 -translate-y-1/2 text-right" style={{ top: `${(x.y0 + x.y1) / 2}%` }}>
            <div className="text-[13px] text-ink sm:text-[15px]">{x.label}</div>
            <div className="num font-mono text-[11px] text-mint sm:text-[13px]">+{formatINR(x.v * 100)}</div>
          </div>
        ))}
      </div>

      <div className="relative h-[26rem] sm:h-[30rem]">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="flow-svg absolute inset-0 h-full w-full" aria-hidden>
          {inputs.map((x) => (
            <path key={x.label} d={ribbon(1.5, x.y0, x.y1, 48.5, x.c0, x.c1)} fill="rgb(143 217 191 / 0.22)" />
          ))}
          {outputs.map((x) => (
            <path key={x.label} d={ribbon(51.5, x.c0, x.c1, 98.5, x.y0, x.y1)} fill={FILL[x.tone]} />
          ))}
          {inputs.map((x) => (
            <rect key={x.label} x="0" y={x.y0} width="1.5" height={x.y1 - x.y0} fill="#8fd9bf" />
          ))}
          <rect x="48.5" y={CENTER_TOP} width="3" height={TOTAL * S} fill="#ece6da" />
          {outputs.map((x) => (
            <rect key={x.label} x="98.5" y={x.y0} width="1.5" height={x.y1 - x.y0} fill={x.tone === "mint" ? "#8fd9bf" : x.tone === "brass" ? "#c9a46b" : "#8b867d"} />
          ))}
        </svg>
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line-strong bg-studio/85 px-3 py-1.5 text-center backdrop-blur">
          <div className="font-mono text-[9.5px] tracking-[0.2em] text-ink-3 uppercase">October</div>
          <div className="num font-mono text-[13px] text-ink">{formatINR(TOTAL * 100)}</div>
        </div>
      </div>

      <div className="relative h-[26rem] sm:h-[30rem]">
        {outputs.map((x) => (
          <div key={x.label} className="absolute inset-x-0 -translate-y-1/2" style={{ top: `${(x.y0 + x.y1) / 2}%` }}>
            <div className="truncate text-[12px] leading-tight text-ink sm:text-[14px]">{x.label}</div>
            <div className={`num font-mono text-[11px] sm:text-[12.5px] ${x.tone === "mint" ? "text-mint" : x.tone === "brass" ? "text-brass" : "text-ink-3"}`}>
              {formatINR(x.v * 100)}
            </div>
          </div>
        ))}
      </div>

      <p className="sr-only">
        Illustrative month: {formatINR(TOTAL * 100)} came in from {IN.map((x) => x.label).join(" and ")}, and went to{" "}
        {OUT.map((x) => `${x.label} ${formatINR(x.v * 100)}`).join(", ")}.
      </p>
    </div>
  );
}
