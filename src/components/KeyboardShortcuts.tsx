"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export const FOCUS_SEARCH_KEY = "focus-search";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * N  -> add a new payment
 * /  -> search transactions
 * Ignored while typing in a field or when a modifier key is held.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      if (document.querySelector("dialog[open]")) return;

      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        if (pathname !== "/transactions/new") router.push("/transactions/new");
      } else if (e.key === "/") {
        e.preventDefault();
        const search = document.getElementById("search") as HTMLInputElement | null;
        if (search) {
          search.focus();
          search.select();
        } else {
          try {
            sessionStorage.setItem(FOCUS_SEARCH_KEY, "1");
          } catch {}
          router.push("/transactions");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);

  return null;
}
