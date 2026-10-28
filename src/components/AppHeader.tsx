"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart, Home, ListIcon, Plus } from "./icons";
import { UserMenu } from "./UserMenu";

const NAV = [
  { href: "/dashboard", label: "Dashboard", Icon: Home },
  { href: "/transactions", label: "Transactions", Icon: ListIcon },
  { href: "/summary", label: "Summary", Icon: BarChart },
];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    pathname.startsWith(href) && !pathname.startsWith("/transactions/new");
}

export function AppHeader({ user }: { user: { name: string; email: string } }) {
  const isActive = useIsActive();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/dashboard" className="press flex items-center gap-2 font-bold tracking-tight">
          <span aria-hidden className="grid size-7 place-items-center rounded-md bg-ink text-[13px] font-extrabold text-on-ink">
            ₹
          </span>
          <span>Payment Tracker</span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 sm:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? "page" : undefined}
              className="rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap text-ink-2 transition-colors duration-200 hover:bg-canvas hover:text-ink aria-[current=page]:bg-canvas aria-[current=page]:text-ink"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <Link
            href="/transactions/new"
            title="Add payment (N)"
            className="press group hidden shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-on-ink hover:opacity-90 sm:inline-flex"
          >
            <Plus width={16} height={16} className="transition-transform duration-200 group-hover:rotate-90" />
            Add Payment
            <kbd className="ml-1 hidden rounded border border-on-ink/30 px-1 text-[10px] leading-4 font-semibold opacity-70 lg:inline">
              N
            </kbd>
          </Link>
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}

/** Mobile tab bar (hidden on larger screens). */
export function BottomNav() {
  const isActive = useIsActive();
  const items = [NAV[0], NAV[1], null, NAV[2]];

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
    >
      <div className="mx-auto grid h-16 max-w-md grid-cols-4 items-center px-2">
        {items.map((n) =>
          n === null ? (
            <div key="add" className="flex justify-center">
              <Link
                href="/transactions/new"
                aria-label="Add Payment"
                className="press grid size-12 place-items-center rounded-2xl bg-ink text-on-ink shadow-lg shadow-ink/20"
              >
                <Plus width={22} height={22} />
              </Link>
            </div>
          ) : (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? "page" : undefined}
              className="group press flex flex-col items-center gap-0.5 py-1 text-[11px] font-medium text-ink-3 transition-colors duration-200 aria-[current=page]:text-ink"
            >
              <span className="grid h-7 w-12 place-items-center rounded-full transition-colors duration-200 group-aria-[current=page]:bg-canvas">
                <n.Icon width={19} height={19} />
              </span>
              {n.label}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}
