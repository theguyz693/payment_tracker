"use client";

import { useEffect } from "react";

/**
 * Marks [data-reveal] and [data-reveal-group] elements with data-in once they
 * scroll into view (CSS in globals.css does the actual transition). One
 * observer for the whole page; each element is revealed once.
 */
export function RevealObserver() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".landing [data-reveal], .landing [data-reveal-group]");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.setAttribute("data-in", ""));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.setAttribute("data-in", "");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return null;
}
