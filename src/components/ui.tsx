// Shared presentational building blocks (server-safe: no hooks).
import Link from "next/link";
import { formatINR, formatSignedINR } from "@/lib/money";
import { Info } from "./icons";

export const btnPrimary =
  "press inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-on-ink hover:opacity-90 disabled:opacity-60";
export const btnSecondary =
  "press inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-canvas disabled:opacity-60";
export const btnGhost =
  "press inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-ink-2 hover:bg-canvas hover:text-ink disabled:opacity-60";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
  padded = true,
  index,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
  index?: number;
}) {
  return (
    <div
      className={`rounded-2xl border border-line bg-surface ${padded ? "p-4 sm:p-5" : ""} ${index !== undefined ? "rise" : ""} ${className}`}
      style={index !== undefined ? ({ "--i": index } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  hint,
  action,
  info,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  info?: string;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-base font-bold tracking-tight">
          {children}
          {info && <InfoTip text={info} />}
        </h2>
        {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/** Small "i" with an explanation (native tooltip + screen-reader text). */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="inline-flex cursor-help text-ink-3" title={text}>
      <Info width={13} height={13} />
      <span className="sr-only">{text}</span>
    </span>
  );
}

type Tone = "neutral" | "in" | "out" | "overdue" | "gain" | "loss" | "invest" | "save" | "pending";

const toneText: Record<Tone, string> = {
  neutral: "text-ink",
  in: "text-receive-strong",
  out: "text-pay-strong",
  overdue: "text-overdue",
  gain: "text-gain",
  loss: "text-loss",
  invest: "text-invest",
  save: "text-save",
  pending: "text-pending",
};

/** A labelled figure. `href` makes it a drill-down link. */
export function Metric({
  label,
  value,
  sub,
  tone = "neutral",
  href,
  info,
  index = 0,
  emphasis = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  href?: string;
  info?: string;
  index?: number;
  emphasis?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1 text-xs font-medium text-ink-2">
        {label}
        {info && <InfoTip text={info} />}
      </div>
      <div className={`num mt-1 font-bold ${emphasis ? "text-2xl" : "text-xl"} ${toneText[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </>
  );
  const cls = `rise block rounded-xl border px-4 py-3 transition-[border-color,box-shadow] duration-200 ${
    tone === "overdue" ? "border-overdue/40 bg-overdue-soft" : "border-line bg-surface"
  } ${href ? "hover:border-line-strong hover:shadow-[0_4px_16px_-10px_rgb(20_28_43/0.3)]" : ""}`;
  const style = { "--i": index } as React.CSSProperties;
  return href ? (
    <Link href={href} className={cls} style={style}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

export function Money({ paise, signed = false, tone }: { paise: number; signed?: boolean; tone?: "auto" }) {
  const cls = tone === "auto" ? (paise > 0 ? "text-gain" : paise < 0 ? "text-loss" : "") : "";
  return <span className={`num ${cls}`}>{signed ? formatSignedINR(paise) : formatINR(paise)}</span>;
}

export function ProgressBar({ value, tone = "save", label }: { value: number; tone?: "save" | "gain" | "overdue" | "pending"; label?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const color = { save: "bg-save", gain: "bg-gain", overdue: "bg-overdue", pending: "bg-pending" }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`bar-grow h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const pillTone: Record<string, string> = {
  neutral: "bg-canvas text-ink-2",
  in: "bg-receive-soft text-receive-strong",
  out: "bg-pay-soft text-pay-strong",
  overdue: "bg-overdue-soft text-overdue",
  gain: "bg-gain-soft text-gain",
  loss: "bg-loss-soft text-loss",
  invest: "bg-invest-soft text-invest",
  save: "bg-save-soft text-save",
  pending: "bg-pending-soft text-pending",
  gold: "bg-gold-soft text-gold",
};

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: keyof typeof pillTone }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${pillTone[tone]}`}>
      {children}
    </span>
  );
}

/** Link-based tabs (each tab is a route or query). */
export function Tabs({ tabs, active }: { tabs: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className="press rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-2 hover:bg-canvas hover:text-ink aria-[current=page]:bg-ink aria-[current=page]:text-on-ink"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Explains that a figure is an estimate / projection, never an actual. */
export function Note({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
        tone === "warn" ? "bg-pending-soft text-pending" : "bg-canvas text-ink-2"
      }`}
    >
      <Info width={14} height={14} className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function EmptyBlock({ title, hint, action, icon }: { title: string; hint?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="fade-in rounded-xl border border-dashed border-line-strong bg-surface/60 px-5 py-8 text-center">
      {icon && <div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-canvas text-ink-3">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-ink-3">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-ink-3 [&_thead]:border-b [&_thead]:border-line [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_tbody_tr:first-child]:border-t-0">
        {children}
      </table>
    </div>
  );
}
