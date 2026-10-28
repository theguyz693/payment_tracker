// Period picker: preset links plus a plain GET form for a custom range
// (works without JavaScript; the URL is the state).
import Link from "next/link";
import { PERIODS, type Period, type PeriodKey } from "@/lib/period";

export function PeriodSelector({ period, basePath }: { period: Period; basePath: string }) {
  const presets = (Object.keys(PERIODS) as PeriodKey[]).filter((k) => k !== "custom");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1" aria-label="Period">
        {presets.map((k) => (
          <Link
            key={k}
            href={`${basePath}?period=${k}`}
            scroll={false}
            aria-current={period.key === k ? "true" : undefined}
            className="press rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-ink-2 hover:bg-canvas hover:text-ink aria-[current=true]:bg-ink aria-[current=true]:text-on-ink"
          >
            {PERIODS[k]}
          </Link>
        ))}
      </nav>
      <details className="group relative">
        <summary
          className={`press flex cursor-pointer list-none items-center rounded-xl border px-3 py-2 text-xs font-semibold ${
            period.key === "custom" ? "border-ink bg-ink text-on-ink" : "border-line bg-surface text-ink-2 hover:bg-canvas"
          }`}
        >
          {period.key === "custom" ? period.label : "Custom range"}
        </summary>
        <form method="get" action={basePath} className="absolute right-0 z-30 mt-2 w-72 space-y-3 rounded-xl border border-line bg-surface p-3 shadow-xl">
          <input type="hidden" name="period" value="custom" />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-medium text-ink-2">
              From
              <input type="date" name="from" required defaultValue={period.start} className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="text-xs font-medium text-ink-2">
              To
              <input type="date" name="to" required defaultValue={period.end} className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
          </div>
          <button type="submit" className="press w-full rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-on-ink hover:opacity-90">
            Apply
          </button>
        </form>
      </details>
    </div>
  );
}
