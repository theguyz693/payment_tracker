"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { markNavigated } from "./hydration";

/**
 * Runs once in the browser:
 * - stores the browser's timezone in a cookie so the server knows what "today" is for you
 * - notes the first client-side navigation (enables count-up animations after it)
 */
export function ClientBoot() {
  const router = useRouter();
  const pathname = usePathname();
  const firstPath = useRef(pathname);

  useEffect(() => {
    if (pathname !== firstPath.current) markNavigated();
  }, [pathname]);

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const current = document.cookie.match(/(?:^|; )tz=([^;]*)/)?.[1];
      if (tz && decodeURIComponent(current ?? "") !== tz) {
        const secure = location.protocol === "https:" ? "; secure" : "";
        document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax${secure}`;
        router.refresh();
      }
    } catch {
      /* the server falls back to a default timezone */
    }
  }, [router]);

  return null;
}
