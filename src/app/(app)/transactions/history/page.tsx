import Link from "next/link";
import { Card, EmptyBlock, Note, Pill, Tabs, btnSecondary } from "@/components/ui";
import { ChevronLeft, ChevronRight, Download, ListIcon, ReceiptIcon } from "@/components/icons";
import { formatDate } from "@/lib/dates";
import { filterLedger, LEDGER_TYPES, paginate, parseLedgerFilters, type LedgerEntry, type LedgerType } from "@/lib/ledger";
import { formatINR } from "@/lib/money";
import { buildLedger, loadFinancialPicture } from "@/server/loaders";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "History" };

const control =
  "rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-ink-3 focus:border-pay focus:outline-none focus:ring-2 focus:ring-pay/20";

const typeTone: Record<LedgerType, "in" | "out" | "save" | "invest" | "gain"> = {
  PAYMENT: "out",
  RECEIPT: "in",
  GOAL_IN: "save",
  GOAL_OUT: "save",
  INVEST: "invest",
  DIVEST: "invest",
  DIVIDEND: "gain",
};

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const today = await getToday();
  const params = await searchParams;
  const f = parseLedgerFilters(params);
  const fp = await loadFinancialPicture(user.id, today);
  const all = buildLedger(fp);
  const filtered = filterLedger(all, f);
  const page = paginate(filtered, f.page);
  const inTotal = filtered.filter((e) => e.flow === "in").reduce((a, e) => a + e.amountPaise, 0);
  const outTotal = filtered.filter((e) => e.flow === "out").reduce((a, e) => a + e.amountPaise, 0);

  // Query string without the page (for pagination and export links).
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (k !== "page" && typeof v === "string" && v) qs.set(k, v);
  const pageHref = (p: number) => `/transactions/history?${new URLSearchParams([...qs.entries(), ["page", String(p)]]).toString()}`;
  const groups = [...new Map(all.map((e) => [e.group, e.category])).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="space-y-5">
      <Tabs
        active="history"
        tabs={[
          { key: "items", label: "All items", href: "/transactions" },
          { key: "recurring", label: "Recurring", href: "/transactions?view=recurring" },
          { key: "history", label: "History", href: "/transactions/history" },
        ]}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">History</h1>
          <p className="mt-1 text-sm text-ink-2">
            Everything that actually happened: payments, money received, goal transfers and investment transactions. Scheduled items aren&apos;t listed here.
          </p>
        </div>
        <a href={`/api/export/ledger?${qs.toString()}`} className={btnSecondary} download>
          <Download width={15} height={15} /> Export CSV
        </a>
      </div>

      <form method="get" className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.2fr_1fr_1fr_1fr_1fr_auto]">
        <input name="q" defaultValue={f.q} placeholder="Search title, counterparty, note, symbol" className={control} aria-label="Search" />
        <select name="type" defaultValue={f.type ?? ""} className={control} aria-label="Type">
          <option value="">All types</option>
          {(Object.keys(LEDGER_TYPES) as LedgerType[]).map((t) => (
            <option key={t} value={t}>
              {LEDGER_TYPES[t]}
            </option>
          ))}
        </select>
        <select name="group" defaultValue={f.group ?? ""} className={control} aria-label="Category or asset">
          <option value="">Any category</option>
          {groups.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={f.from} className={control} aria-label="From date" />
        <input type="date" name="to" defaultValue={f.to} className={control} aria-label="To date" />
        <select name="sort" defaultValue={f.sort} className={control} aria-label="Sort">
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="amount_desc">Largest first</option>
          <option value="amount_asc">Smallest first</option>
        </select>
        <div className="flex gap-2">
          <input name="min" defaultValue={f.min !== undefined ? String(f.min / 100) : ""} placeholder="Min ₹" inputMode="decimal" className={`${control} w-24`} aria-label="Minimum amount" />
          <input name="max" defaultValue={f.max !== undefined ? String(f.max / 100) : ""} placeholder="Max ₹" inputMode="decimal" className={`${control} w-24`} aria-label="Maximum amount" />
          <button type="submit" className="press rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-on-ink hover:opacity-90">
            Apply
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
        <span>
          {page.total} entr{page.total === 1 ? "y" : "ies"}
        </span>
        {inTotal > 0 && <span className="num text-receive-strong">In {formatINR(inTotal)}</span>}
        {outTotal > 0 && <span className="num text-pay-strong">Out {formatINR(outTotal)}</span>}
        {(qs.toString() || f.page > 1) && (
          <Link href="/transactions/history" className="font-medium underline">
            Clear filters
          </Link>
        )}
      </div>

      {page.items.length === 0 ? (
        <EmptyBlock icon={<ListIcon width={20} height={20} />} title={all.length ? "Nothing matches these filters" : "No history yet"} hint={all.length ? "Try a wider date range or clear the filters." : "Mark payments as paid or received and they'll appear here."} />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {page.items.map((e) => (
              <Row key={`${e.type}-${e.id}`} e={e} today={today} />
            ))}
          </ul>
        </Card>
      )}

      {page.pages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          {page.page > 1 ? (
            <Link href={pageHref(page.page - 1)} className={btnSecondary}>
              <ChevronLeft width={14} height={14} /> Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-ink-3">
            Page {page.page} of {page.pages}
          </span>
          {page.page < page.pages ? (
            <Link href={pageHref(page.page + 1)} className={btnSecondary}>
              Older <ChevronRight width={14} height={14} />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <Note>Goal transfers move your own money between pots, so they&apos;re shown but don&apos;t count as income or spending.</Note>
    </div>
  );
}

function Row({ e, today }: { e: LedgerEntry; today: string }) {
  const sign = e.flow === "in" ? "+" : e.flow === "out" ? "−" : "";
  return (
    <li className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="w-24 shrink-0 text-xs text-ink-3">{formatDate(e.date, today)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {e.href ? (
            <Link href={e.href} className="truncate font-medium hover:underline">
              {e.title}
            </Link>
          ) : (
            <span className="truncate font-medium">{e.title}</span>
          )}
          <Pill tone={typeTone[e.type]}>{LEDGER_TYPES[e.type]}</Pill>
        </div>
        <div className="mt-0.5 truncate text-xs text-ink-3">
          {e.category}
          {e.symbol && ` · ${e.symbol}`}
          {e.counterparty && ` · ${e.counterparty}`}
          {e.notes && ` · ${e.notes}`}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span className={`num font-semibold ${e.flow === "in" ? "text-receive-strong" : e.flow === "internal" ? "text-save" : ""}`}>
          {sign}
          {formatINR(e.amountPaise)}
        </span>
        {e.receiptable && !e.id.includes("-") && (
          <Link href={`/receipts/${e.id}`} className="press inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ink-2 hover:bg-canvas hover:text-ink">
            <ReceiptIcon width={13} height={13} /> Receipt
          </Link>
        )}
      </div>
    </li>
  );
}
