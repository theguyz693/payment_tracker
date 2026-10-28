"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      data-scrolled={scrolled || open || undefined}
      className="group/nav fixed inset-x-0 top-0 z-50 border-b border-transparent transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 data-scrolled:border-line/70 data-scrolled:bg-canvas/75 data-scrolled:shadow-[0_8px_30px_-18px_rgb(20_28_43/0.25)] data-scrolled:backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 sm:px-8">
        <Link href="/" className="press flex items-center gap-2.5 font-bold tracking-tight" onClick={() => setOpen(false)}>
          <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-ink text-sm font-extrabold text-on-ink">
            ₹
          </span>
          <span className="text-[15px]">Payment Tracker</span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-2 transition-colors duration-200 hover:text-ink"
            >
              {l.label}
            </a>
          ))}
          <Link
            href="/login"
            className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-2 transition-colors duration-200 hover:text-ink"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="press ml-2 rounded-full bg-ink px-4.5 py-2 text-sm font-semibold text-on-ink shadow-[0_6px_16px_-6px_rgb(20_28_43/0.45)] hover:opacity-90"
          >
            Get Started
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2 md:hidden">
          <Link href="/signup" className="press rounded-full bg-ink px-4 py-2 text-sm font-semibold text-on-ink">
            Get Started
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
            className="press grid size-10 place-items-center rounded-full text-ink hover:bg-surface"
          >
            <span className="relative block h-3 w-[18px]" aria-hidden>
              <span
                className={`absolute left-0 h-[1.5px] w-full rounded bg-current transition-transform duration-300 ${open ? "top-1/2 rotate-45" : "top-0"}`}
              />
              <span
                className={`absolute left-0 h-[1.5px] w-full rounded bg-current transition-transform duration-300 ${open ? "top-1/2 -rotate-45" : "bottom-0"}`}
              />
            </span>
          </button>
        </div>
      </div>

      <div
        id="mobile-menu"
        data-open={open || undefined}
        className="grid grid-rows-[0fr] overflow-hidden transition-[grid-template-rows] duration-300 ease-out data-open:grid-rows-[1fr] md:hidden"
      >
        <nav className="min-h-0" aria-label="Mobile">
          <div className="flex flex-col gap-1 px-5 pt-1 pb-5">
            {[...LINKS, { href: "/login", label: "Log in" }].map((l) => (
              <a
                key={l.href}
                href={l.href}
                tabIndex={open ? 0 : -1}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-3 text-base font-medium text-ink-2 hover:bg-surface hover:text-ink"
              >
                {l.label}
              </a>
            ))}
          </div>
        </nav>
      </div>
    </header>
  );
}
