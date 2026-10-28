"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart,
  CalendarIcon,
  Close,
  Gear,
  Home,
  Landmark,
  ListIcon,
  Menu,
  PieChart,
  Plus,
  ReceiptIcon,
  Target,
  TrendingUp,
} from "./icons";
import { UserMenu } from "./UserMenu";

type NavItem = { href: string; label: string; Icon: (p: React.SVGProps<SVGSVGElement>) => React.ReactNode };

const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Overview", Icon: Home },
  { href: "/transactions", label: "Transactions", Icon: ListIcon },
  { href: "/calendar", label: "Calendar", Icon: CalendarIcon },
];
const PLANNING: NavItem[] = [
  { href: "/goals", label: "Savings Goals", Icon: Target },
  { href: "/loans", label: "Loans & EMI", Icon: Landmark },
  { href: "/investments", label: "Investments", Icon: TrendingUp },
];
const INSIGHT: NavItem[] = [
  { href: "/analytics", label: "Analytics", Icon: PieChart },
  { href: "/summary", label: "Monthly report", Icon: BarChart },
  { href: "/receipts", label: "Receipts", Icon: ReceiptIcon },
];
const SETTINGS: NavItem = { href: "/settings", label: "Settings", Icon: Gear };

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || (pathname.startsWith(`${href}/`) && !pathname.startsWith("/transactions/new"));
}

function Brand() {
  return (
    <Link href="/dashboard" className="press flex items-center gap-2 font-bold tracking-tight">
      <span aria-hidden className="grid size-7 place-items-center rounded-md bg-ink text-[13px] font-extrabold text-on-ink">
        ₹
      </span>
      <span>Payment Tracker</span>
    </Link>
  );
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const isActive = useIsActive();
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={isActive(item.href) ? "page" : undefined}
      className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-ink-2 transition-colors duration-150 hover:bg-canvas hover:text-ink aria-[current=page]:bg-canvas aria-[current=page]:font-semibold aria-[current=page]:text-ink"
    >
      <item.Icon width={17} height={17} className="shrink-0 text-ink-3 group-aria-[current=page]:text-ink" />
      {item.label}
    </Link>
  );
}

function NavGroups({ onNavigate }: { onNavigate?: () => void }) {
  const groups: [string | null, NavItem[]][] = [
    [null, PRIMARY],
    ["Plan", PLANNING],
    ["Understand", INSIGHT],
  ];
  return (
    <div className="space-y-5">
      {groups.map(([label, items]) => (
        <div key={label ?? "main"}>
          {label && <div className="mb-1 px-2.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}</div>}
          <div className="space-y-0.5">
            {items.map((i) => (
              <NavLink key={i.href} item={i} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AddButton({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/transactions/new"
      title="Add payment (N)"
      className={`press group inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-ink text-sm font-semibold text-on-ink hover:opacity-90 ${
        compact ? "px-3 py-2" : "w-full px-3 py-2.5"
      }`}
    >
      <Plus width={16} height={16} className="transition-transform duration-200 group-hover:rotate-90" />
      Add payment
      {!compact && <kbd className="ml-auto rounded border border-on-ink/30 px-1 text-[10px] leading-4 font-semibold opacity-70">N</kbd>}
    </Link>
  );
}

/** Desktop sidebar (lg and up). */
export function Sidebar({ user }: { user: { name: string; email: string } }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-14 items-center px-4">
        <Brand />
      </div>
      <div className="px-3 pb-3">
        <AddButton />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
        <NavGroups />
      </nav>
      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-3">
        <NavLink item={SETTINGS} />
        <UserMenu user={user} placement="up" />
      </div>
    </aside>
  );
}

/** Top bar below lg: brand, add, account, and a menu that opens the full navigation. */
export function TopBar({ user }: { user: { name: string; email: string } }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md lg:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="press -ml-1.5 grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-canvas"
          >
            <Menu width={20} height={20} />
          </button>
          <Brand />
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:block">
              <AddButton compact />
            </span>
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close menu" className="fade-in absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
          <div className="nav-sheet absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl">
            <div className="flex h-14 items-center justify-between px-4">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="press grid size-9 place-items-center rounded-lg hover:bg-canvas">
                <Close width={18} height={18} />
              </button>
            </div>
            <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
              <NavGroups onNavigate={() => setOpen(false)} />
              <div className="mt-5 border-t border-line pt-3">
                <NavLink item={SETTINGS} onNavigate={() => setOpen(false)} />
              </div>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

/** Mobile tab bar (phones only). */
export function BottomNav() {
  const isActive = useIsActive();
  const items = [PRIMARY[0], PRIMARY[1], null, PRIMARY[2], PLANNING[0]];

  return (
    <nav
      aria-label="Quick"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
    >
      <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center px-1">
        {items.map((n) =>
          n === null ? (
            <div key="add" className="flex justify-center">
              <Link
                href="/transactions/new"
                aria-label="Add payment"
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
              <span className="grid h-7 w-11 place-items-center rounded-full transition-colors duration-200 group-aria-[current=page]:bg-canvas">
                <n.Icon width={19} height={19} />
              </span>
              {n.label.replace("Savings ", "")}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}
