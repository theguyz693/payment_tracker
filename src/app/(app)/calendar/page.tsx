import Link from "next/link";
import { BalanceForecastChart } from "@/components/charts";
import { Card, CardTitle, EmptyBlock, Metric, Note, PageHeader, Pill, Table, Tabs, btnSecondary } from "@/components/ui";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { addDays, daysInMonth, formatDate, formatMonth, isValidMonth, monthBounds, monthKey, shiftMonth } from "@/lib/dates";
import { buildEvents, buildForecast, EVENT_LABEL, type CalendarEvent, type EventKind } from "@/lib/forecast";
import { formatINR, formatSignedINR } from "@/lib/money";
import { loadFinancialPicture } from "@/server/loaders";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar" };

const kindStyle: Record<EventKind, string> = {
  BILL: "bg-pay-soft text-pay-strong",
  EMI: "bg-pay-soft text-pay-strong",
  RECEIVABLE: "bg-receive-soft text-receive-strong",
  SIP: "bg-invest-soft text-invest",
  GOAL_CONTRIBUTION: "bg-save-soft text-save",
  GOAL_DEADLINE: "bg-gold-soft text-gold",
};
const kindDot: Record<EventKind, string> = {
  BILL: "bg-pay",
  EMI: "bg-pay",
  RECEIVABLE: "bg-receive",
  SIP: "bg-invest",
  GOAL_CONTRIBUTION: "bg-save",
  GOAL_DEADLINE: "bg-gold",
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HORIZONS = [30, 90, 365] as const;

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, k: string) => (Array.isArray(p[k]) ? p[k]![0] : (p[k] as string | undefined));

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const today = await getToday();
  const params = await searchParams;
  const view = one(params, "view") === "agenda" ? "agenda" : "month";
  const monthParam = one(params, "month");
  const month = isValidMonth(monthParam) ? monthParam : monthKey(today);
  const horizonRaw = Number(one(params, "horizon"));
  const horizon = (HORIZONS as readonly number[]).includes(horizonRaw) ? horizonRaw : 90;

  const fp = await loadFinancialPicture(user.id, today);
  const sources = { transactions: fp.transactions, sips: fp.sipSources, goals: fp.goalSources, today };
  const { start, end } = monthBounds(month);
  const monthEvents = buildEvents({ ...sources, from: start, to: end });
  const agenda = buildEvents({ ...sources, from: addDays(today, -60), to: addDays(today, 59) }).filter((e) => e.date >= today || e.overdue);
  const forecast = buildForecast({ ...sources, horizonDays: horizon, startingBalancePaise: fp.cash?.paise ?? null });

  const q = (over: Record<string, string | number>) => {
    const s = new URLSearchParams({ view, month, horizon: String(horizon), ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) });
    return `/calendar?${s.toString()}`;
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Calendar"
        description="Bills, EMIs, expected money, SIPs and savings plans in one place. Everything here is scheduled or expected, not yet happened."
        actions={
          <Tabs
            active={view}
            tabs={[
              { key: "month", label: "Month", href: q({ view: "month" }) },
              { key: "agenda", label: "Agenda", href: q({ view: "agenda" }) },
            ]}
          />
        }
      />

      <Legend />

      {view === "month" ? (
        <Card padded={false}>
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <Link href={q({ month: shiftMonth(month, -1) })} className={btnSecondary} aria-label="Previous month" scroll={false}>
              <ChevronLeft width={15} height={15} />
            </Link>
            <div className="text-center">
              <h2 className="font-bold">{formatMonth(month)}</h2>
              {month !== monthKey(today) && (
                <Link href={q({ month: monthKey(today) })} className="text-xs font-semibold text-ink-3 hover:text-ink" scroll={false}>
                  Back to today
                </Link>
              )}
            </div>
            <Link href={q({ month: shiftMonth(month, 1) })} className={btnSecondary} aria-label="Next month" scroll={false}>
              <ChevronRight width={15} height={15} />
            </Link>
          </div>
          <MonthGrid month={month} events={monthEvents} today={today} />
          <MonthTotals events={monthEvents} />
        </Card>
      ) : (
        <Card>
          <CardTitle hint="Overdue items first, then the next 60 days.">Agenda</CardTitle>
          <Agenda events={agenda} today={today} />
        </Card>
      )}

      <section aria-labelledby="forecast" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="forecast" className="text-lg font-bold tracking-tight">
              Cash-flow forecast
            </h2>
            <p className="text-sm text-ink-2">From recorded and scheduled items only. Expected money is never guaranteed.</p>
          </div>
          <nav className="flex gap-1 rounded-xl border border-line bg-surface p-1" aria-label="Forecast horizon">
            {HORIZONS.map((h) => (
              <Link
                key={h}
                href={q({ horizon: h })}
                scroll={false}
                aria-current={h === horizon ? "true" : undefined}
                className="press rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ink-2 hover:bg-canvas aria-[current=true]:bg-ink aria-[current=true]:text-on-ink"
              >
                {h} days
              </Link>
            ))}
          </nav>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric index={0} label="Expected in" value={formatINR(forecast.totalInPaise)} tone="in" sub="Not guaranteed" info="Money owed to you that falls due in this window. Overdue receivables are left out of the forecast entirely." />
          <Metric index={1} label="Going out" value={formatINR(forecast.totalOutPaise)} tone="out" sub="Bills, EMIs, SIPs + overdue" info="Scheduled payments, EMIs and SIP instalments in this window. Overdue payments are assumed paid today." />
          <Metric index={2} label="Planned savings" value={formatINR(forecast.totalSavePaise)} tone="save" sub="Set aside, not spent" />
          <Metric
            index={3}
            label={fp.cash ? `Projected cash in ${horizon} days` : "Net expected"}
            value={fp.cash ? formatINR(forecast.days[forecast.days.length - 1]?.balancePaise ?? 0) : formatSignedINR(forecast.totalInPaise - forecast.totalOutPaise)}
            tone={(fp.cash ? (forecast.days[forecast.days.length - 1]?.balancePaise ?? 0) : forecast.totalInPaise - forecast.totalOutPaise) >= 0 ? "gain" : "loss"}
            sub={fp.cash ? `From ${formatINR(fp.cash.paise)} today (estimated)` : "Add a cash balance for a projection"}
          />
        </div>

        {forecast.overdueReceivePaise > 0 && <Note tone="warn">{formatINR(forecast.overdueReceivePaise)} owed to you is already overdue and isn&apos;t included. It may arrive late or not at all.</Note>}

        <Card>
          <CardTitle hint="Two lines: one counting expected money in, one assuming none of it arrives.">Projected balance</CardTitle>
          {fp.cash ? (
            <BalanceForecastChart data={forecast.days.map((d) => ({ date: d.date, balancePaise: d.balancePaise, cautiousBalancePaise: d.cautiousBalancePaise }))} />
          ) : (
            <EmptyBlock
              title="Add your cash balance to project it"
              hint="The forecast above still works. A projected balance needs a starting point, so it isn't guessed."
              action={
                <Link href="/settings" className={btnSecondary}>
                  Set cash balance
                </Link>
              }
            />
          )}
        </Card>

        <Card>
          <CardTitle hint="A month is flagged when more is going out than expected in, or when the projected balance would go negative.">Month by month</CardTitle>
          <Table>
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Expected in</th>
                <th className="text-right">Going out</th>
                <th className="text-right">Savings</th>
                <th className="text-right">Net</th>
                {fp.cash && <th className="text-right">Cash at end</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {forecast.months.map((m) => (
                <tr key={m.month}>
                  <td className="whitespace-nowrap font-medium">{formatMonth(m.month)}</td>
                  <td className="num text-right text-receive-strong">{formatINR(m.inPaise)}</td>
                  <td className="num text-right">{formatINR(m.outPaise)}</td>
                  <td className="num text-right text-save">{m.savePaise ? formatINR(m.savePaise) : "—"}</td>
                  <td className={`num text-right font-semibold ${m.netPaise >= 0 ? "text-gain" : "text-loss"}`}>{formatSignedINR(m.netPaise)}</td>
                  {fp.cash && <td className="num text-right">{m.endBalancePaise !== null ? formatINR(m.endBalancePaise) : "—"}</td>}
                  <td className="text-right">{m.tight ? <Pill tone="pending">Tight · {m.reason}</Pill> : <Pill tone="gain">OK</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-ink-3">First and last months are partial (forecast starts today).</p>
        </Card>
      </section>
    </div>
  );
}

function Legend() {
  const items: EventKind[] = ["BILL", "EMI", "RECEIVABLE", "SIP", "GOAL_CONTRIBUTION", "GOAL_DEADLINE"];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${kindDot[k]}`} /> {EVENT_LABEL[k]}
        </span>
      ))}
    </div>
  );
}

function MonthGrid({ month, events, today }: { month: string; events: CalendarEvent[]; today: string }) {
  const [y, m] = month.split("-").map(Number);
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const n = daysInMonth(y, m - 1);
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line text-center text-[11px] font-semibold text-ink-3">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          const list = date ? (byDate.get(date) ?? []) : [];
          const isToday = date === today;
          return (
            <div key={i} className={`min-h-16 border-b border-line p-1 sm:min-h-28 sm:p-1.5 ${i % 7 ? "border-l" : ""} ${date ? "" : "bg-canvas/50"} ${date && date < today ? "opacity-70" : ""}`}>
              {date && (
                <>
                  <div className={`mb-1 grid size-6 place-items-center rounded-full text-xs font-semibold ${isToday ? "bg-ink text-on-ink" : "text-ink-2"}`}>{Number(date.slice(8))}</div>
                  {/* Phones: dots. Larger screens: labelled chips. */}
                  <div className="flex flex-wrap gap-0.5 sm:hidden">
                    {list.slice(0, 6).map((e) => (
                      <span key={e.id} className={`size-1.5 rounded-full ${kindDot[e.kind]}`} title={`${e.title} ${formatINR(e.amountPaise)}`} />
                    ))}
                  </div>
                  <ul className="hidden space-y-0.5 sm:block">
                    {list.slice(0, 3).map((e) => (
                      <li key={e.id}>
                        <Link
                          href={e.href}
                          title={`${EVENT_LABEL[e.kind]}: ${e.title} · ${formatINR(e.amountPaise)}${e.overdue ? " (overdue)" : ""}`}
                          className={`block truncate rounded px-1 py-0.5 text-[11px] leading-tight font-medium hover:brightness-95 ${kindStyle[e.kind]} ${e.overdue ? "ring-1 ring-overdue" : ""}`}
                        >
                          {e.title}
                          <span className="num ml-1 opacity-75">{formatINR(e.amountPaise)}</span>
                        </Link>
                      </li>
                    ))}
                    {list.length > 3 && <li className="px-1 text-[11px] text-ink-3">+{list.length - 3} more</li>}
                  </ul>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthTotals({ events }: { events: CalendarEvent[] }) {
  const sum = (f: CalendarEvent["flow"]) => events.filter((e) => e.flow === f).reduce((a, e) => a + e.amountPaise, 0);
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 px-4 py-3 text-sm">
      <span className="text-ink-2">
        Going out <strong className="num text-ink">{formatINR(sum("out"))}</strong>
      </span>
      <span className="text-ink-2">
        Expected in <strong className="num text-receive-strong">{formatINR(sum("in"))}</strong>
      </span>
      <span className="text-ink-2">
        Savings planned <strong className="num text-save">{formatINR(sum("save"))}</strong>
      </span>
    </div>
  );
}

function Agenda({ events, today }: { events: CalendarEvent[]; today: string }) {
  if (events.length === 0) return <EmptyBlock title="Nothing scheduled" hint="Recurring payments, expected money, SIPs and goal plans show up here." />;
  const groups = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const key = e.overdue ? "overdue" : e.date;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([key, list]) => (
        <div key={key}>
          <h3 className={`mb-1.5 text-xs font-semibold ${key === "overdue" ? "text-overdue" : "text-ink-3"}`}>
            {key === "overdue" ? "Overdue" : key === today ? "Today" : formatDate(key, today)}
          </h3>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {list.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <Link href={e.href} className="flex min-w-0 items-center gap-2 hover:underline">
                  <span className={`size-2 shrink-0 rounded-full ${kindDot[e.kind]}`} />
                  <span className="truncate font-medium">{e.title}</span>
                  <span className="hidden text-xs text-ink-3 sm:inline">
                    {EVENT_LABEL[e.kind]}
                    {key === "overdue" && ` · was due ${formatDate(e.date, today)}`}
                  </span>
                </Link>
                <span className={`num shrink-0 font-semibold ${e.flow === "in" ? "text-receive-strong" : e.flow === "save" ? "text-save" : e.flow === "none" ? "text-ink-3" : ""}`}>
                  {e.flow === "in" ? "+" : ""}
                  {e.kind === "GOAL_DEADLINE" ? `${formatINR(e.amountPaise)} to go` : formatINR(e.amountPaise)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
