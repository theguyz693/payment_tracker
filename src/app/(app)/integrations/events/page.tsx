import Link from "next/link";
import { RunWorker } from "@/components/integrations/Controls";
import { EventTable } from "@/components/integrations/display";
import { inputClsServer } from "@/components/integrations/inputs";
import { btnSecondary } from "@/components/ui";
import { EVENT_STATUSES, EVENT_TYPE_LABEL, EVENT_TYPES, PROVIDER_IDS, PROVIDERS, STATUS_LABEL } from "@/lib/integrations/types";
import { EVENTS_PAGE_SIZE, listEvents, parseEventFilters } from "@/server/integrations/queries";
import { getTimeZone, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Event console · Integrations" };

export default async function EventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const filters = parseEventFilters(await searchParams);
  const [tz, { rows, total }] = await Promise.all([getTimeZone(), listEvents(user.id, filters)]);
  const pages = Math.max(1, Math.ceil(total / EVENTS_PAGE_SIZE));
  const qs = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, page })) if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-4">
      {/* Plain GET form: filters live in the URL and work without JavaScript. */}
      <form className="grid gap-2 rounded-2xl border border-line bg-surface p-3 sm:grid-cols-3 lg:grid-cols-6" role="search" aria-label="Filter events">
        <label className="sr-only" htmlFor="q">
          Event ID
        </label>
        <input id="q" name="q" defaultValue={filters.q} placeholder="Search event ID…" className={`${inputClsServer} font-mono text-sm sm:col-span-3 lg:col-span-2`} />
        <select name="provider" defaultValue={filters.provider ?? ""} aria-label="Provider" className={inputClsServer}>
          <option value="">All providers</option>
          {PROVIDER_IDS.map((p) => (
            <option key={p} value={p}>
              {PROVIDERS[p].name}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={filters.type ?? ""} aria-label="Event type" className={inputClsServer}>
          <option value="">All event types</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EVENT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={filters.status ?? ""} aria-label="Status" className={inputClsServer}>
          <option value="">All statuses</option>
          {EVENT_STATUSES.filter((s) => s !== "DUPLICATE").map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input type="date" name="from" defaultValue={filters.from} aria-label="From date" className={`${inputClsServer} min-w-0`} />
          <input type="date" name="to" defaultValue={filters.to} aria-label="To date" className={`${inputClsServer} min-w-0`} />
        </div>
        <div className="flex gap-2 sm:col-span-3 lg:col-span-6">
          <button type="submit" className="press rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-on-ink">
            Apply
          </button>
          <Link href="/integrations/events" className={btnSecondary}>
            Clear
          </Link>
          <span className="ml-auto self-center text-xs text-ink-3">
            {total} event{total === 1 ? "" : "s"}
          </span>
          <RunWorker />
        </div>
      </form>

      <EventTable rows={rows} tz={tz} empty="No events match these filters." />

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          {filters.page > 1 ? (
            <Link href={`/integrations/events${qs(filters.page - 1)}`} className={btnSecondary}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-3">
            Page {filters.page} of {pages}
          </span>
          {filters.page < pages ? (
            <Link href={`/integrations/events${qs(filters.page + 1)}`} className={btnSecondary}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
