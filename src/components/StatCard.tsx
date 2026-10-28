import { AnimatedNumber } from "./AnimatedNumber";

type Tone = "neutral" | "pay" | "receive" | "overdue";

const toneCls: Record<Tone, string> = {
  neutral: "border-line bg-surface",
  pay: "border-line bg-surface",
  receive: "border-line bg-surface",
  overdue: "border-overdue/40 bg-overdue-soft",
};
const valueCls: Record<Tone, string> = {
  neutral: "text-ink",
  pay: "text-pay-strong",
  receive: "text-receive-strong",
  overdue: "text-overdue",
};

export function StatCard({
  label,
  paise,
  signed = false,
  sub,
  tone = "neutral",
  index = 0,
}: {
  label: string;
  paise: number;
  signed?: boolean;
  sub?: React.ReactNode;
  tone?: Tone;
  /** Position, for the staggered entrance. */
  index?: number;
}) {
  return (
    <div
      className={`rise rounded-xl border px-4 py-3 transition-colors duration-300 ${toneCls[tone]}`}
      style={{ "--i": index } as React.CSSProperties}
    >
      <div className="text-xs font-medium text-ink-2">{label}</div>
      <div className={`num mt-1 text-xl font-bold transition-colors duration-300 ${valueCls[tone]}`}>
        <AnimatedNumber paise={paise} signed={signed} />
      </div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
