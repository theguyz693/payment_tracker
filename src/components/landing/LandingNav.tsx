"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { InstrumentMark } from "./hero/RingsFallback";

const LINKS = [
  { href: "#product", label: "Product" },
  { href: "#features", label: "Features" },
  { href: "#security", label: "Security" },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
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
      className="fixed inset-x-0 top-0 z-50 border-b border-transparent transition-[background-color,border-color,backdrop-filter] duration-500 data-scrolled:border-line data-scrolled:bg-studio/70 data-scrolled:backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-[88rem] items-center gap-6 px-5 sm:h-[4.5rem] sm:px-8">
        <Link href="/" className="press flex min-w-0 items-center gap-2 text-ink" onClick={() => setOpen(false)} aria-label="Payment Tracker, home">
          <InstrumentMark className="size-7" />
          <span className="text-[15px] leading-none font-semibold tracking-[-0.01em] whitespace-nowrap sm:text-base">Payment Tracker</span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-full px-3.5 py-2 text-sm text-ink-2 transition-colors duration-200 hover:text-ink focus-visible:outline-2 focus-visible:outline-brass">
              {l.label}
            </a>
          ))}
          <span className="mx-2 h-4 w-px bg-line-strong" aria-hidden />
          <Link href="/login" className="rounded-full px-3.5 py-2 text-sm text-ink-2 transition-colors duration-200 hover:text-ink focus-visible:outline-2 focus-visible:outline-brass">
            Log in
          </Link>
          <Link
            href="/signup"
            className="press ml-1 rounded-full bg-paper px-4.5 py-2 text-sm font-semibold text-studio transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass"
          >
            Get started
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-1 md:hidden">
          <Link href="/signup" className="press rounded-full bg-paper px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap text-studio">
            Get started
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
            className="press grid size-11 place-items-center rounded-full text-ink hover:bg-white/5"
          >
            <span className="relative block h-3 w-[18px]" aria-hidden>
              <span className={`absolute left-0 h-[1.5px] w-full rounded bg-current transition-transform duration-300 ${open ? "top-1/2 rotate-45" : "top-0"}`} />
              <span className={`absolute left-0 h-[1.5px] w-full rounded bg-current transition-transform duration-300 ${open ? "top-1/2 -rotate-45" : "bottom-0"}`} />
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
          <div className="flex flex-col px-5 pt-1 pb-6">
            {[...LINKS, { href: "/login", label: "Log in" }].map((l) => (
              <a
                key={l.href}
                href={l.href}
                tabIndex={open ? 0 : -1}
                onClick={() => setOpen(false)}
                className="border-b border-line py-4 text-2xl font-semibold tracking-[-0.02em] text-ink"
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
