"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { SORTS, STATUS_FILTERS } from "@/lib/filters";
import type { Category } from "@/lib/types";
import { Search } from "./icons";
import { FOCUS_SEARCH_KEY } from "./KeyboardShortcuts";

const control =
  "rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-ink-3 focus:border-pay focus:outline-none focus:ring-2 focus:ring-pay/20";

const KEYS = ["direction", "status", "category", "from", "to", "sort", "q"] as const;
type FilterState = Record<(typeof KEYS)[number], string>;

function fromParams(params: URLSearchParams): FilterState {
  return Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? ""])) as FilterState;
}
function toQuery(state: FilterState): string {
  const next = new URLSearchParams();
  for (const k of KEYS) if (state[k] && !(k === "sort" && state[k] === "due_asc")) next.set(k, state[k]);
  return next.toString();
}

export function FiltersBar({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  // Local state is the source of truth while the user is interacting, so
  // clicks and typing respond instantly and never race each other. The URL
  // follows it (shareable, survives refresh).
  const [state, setState] = useState<FilterState>(() => fromParams(params));
  const lastPushed = useRef(toQuery(fromParams(params)));
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" pressed on another page: focus search once we arrive.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(FOCUS_SEARCH_KEY)) {
        sessionStorage.removeItem(FOCUS_SEARCH_KEY);
        searchRef.current?.focus();
      }
    } catch {}
  }, []);

  // URL changed from outside (back button, a link): adopt it.
  const paramString = params.toString();
  useEffect(() => {
    if (paramString !== lastPushed.current) {
      lastPushed.current = paramString;
      setState(fromParams(new URLSearchParams(paramString)));
    }
  }, [paramString]);

  function push(next: FilterState) {
    const query = toQuery(next);
    if (query === lastPushed.current) return;
    lastPushed.current = query;
    start(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  function update(key: keyof FilterState, value: string) {
    const next = { ...state, [key]: value };
    // Category list depends on direction; drop a category that no longer fits.
    if (key === "direction" && value) {
      const cat = categories.find((c) => c.id === next.category);
      if (cat && cat.direction !== value) next.category = "";
    }
    setState(next);
    push(next);
  }

  // Search: update locally on every keystroke, push to the URL after a pause.
  useEffect(() => {
    const t = setTimeout(() => push(state), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.q]);

  const setQ = (value: string) => setState((s) => ({ ...s, q: value }));

  // The search box is uncontrolled so text typed before the page finished
  // loading isn't wiped; pick it up once we're interactive.
  useEffect(() => {
    const el = searchRef.current;
    if (el && el.value !== state.q) setQ(el.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Keep the box in sync when filters change from outside (clear, back button).
  useEffect(() => {
    const el = searchRef.current;
    if (el && document.activeElement !== el && el.value !== state.q) el.value = state.q;
  }, [state.q]);
  const direction = state.direction;
  const visibleCats = categories.filter((c) => !direction || c.direction === direction);
  const hasFilters = KEYS.some((k) => k !== "sort" && state[k]);

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="inline-flex shrink-0 rounded-lg bg-canvas p-1" role="group" aria-label="Pay or receive">
          {[
            ["", "All"],
            ["PAY", "Pay"],
            ["RECEIVE", "Receive"],
          ].map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={direction === v}
              onClick={() => update("direction", v)}
              className="press rounded-md px-3 py-1.5 text-sm font-semibold text-ink-2 hover:text-ink aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-sm"
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative flex-1">
          <span className="sr-only">Search by title or person</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
          <input
            ref={searchRef}
            id="search"
            type="search"
            defaultValue={state.q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title or person"
            className={`${control} w-full pr-10 pl-9`}
          />
          <kbd
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-line-strong px-1.5 text-[11px] leading-5 font-semibold text-ink-3 sm:block"
          >
            /
          </kbd>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
        <Select label="Status" value={state.status} onChange={(v) => update("status", v)}>
          <option value="">Any status</option>
          {Object.entries(STATUS_FILTERS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select label="Category" value={state.category} onChange={(v) => update("category", v)}>
          <option value="">Any category</option>
          {(["PAY", "RECEIVE"] as const).map((d) => {
            const list = visibleCats.filter((c) => c.direction === d);
            if (!list.length) return null;
            return (
              <optgroup key={d} label={d === "PAY" ? "Pay" : "Receive"}>
                {list.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </Select>
        <DateInput label="Due from" value={state.from} onChange={(v) => update("from", v)} />
        <DateInput label="Due until" value={state.to} onChange={(v) => update("to", v)} />
        <Select label="Sort" value={state.sort || "due_asc"} onChange={(v) => update("sort", v === "due_asc" ? "" : v)}>
          {Object.entries(SORTS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              const cleared = fromParams(new URLSearchParams());
              if (searchRef.current) searchRef.current.value = "";
              setState(cleared);
              push(cleared);
            }}
            className="press fade-in col-span-2 self-end rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-canvas sm:col-span-1"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-ink-3">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${control} w-full`}>
        {children}
      </select>
    </label>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-ink-3">{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={`${control} w-full`} />
    </label>
  );
}
