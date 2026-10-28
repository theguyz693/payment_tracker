"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatINR, formatSignedINR } from "@/lib/money";
import { hasNavigated, prefersReducedMotion } from "./hydration";

const DURATION = 650;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A rupee amount that counts to its new value when it changes (e.g. after
 * marking something paid), and counts up from zero when its page was opened
 * by client navigation. The server-rendered first paint shows the final value.
 */
export function AnimatedNumber({ paise, signed = false }: { paise: number; signed?: boolean }) {
  const [shown, setShown] = useState(paise); // matches server HTML during hydration
  const from = useRef(paise);
  const latest = useRef(paise);
  const [kick, setKick] = useState(0);

  // Mounted by navigation: start from zero before the first paint.
  useLayoutEffect(() => {
    if (hasNavigated() && !prefersReducedMotion() && paise !== 0) {
      from.current = latest.current = 0;
      setShown(0);
      setKick(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (from.current === paise) return;
    if (prefersReducedMotion()) {
      from.current = latest.current = paise;
      setShown(paise);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const origin = from.current;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      latest.current = origin + (paise - origin) * easeOut(t);
      setShown(t === 1 ? paise : Math.round(latest.current / 100) * 100);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = paise;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = Math.round(latest.current); // if interrupted, continue from where it was
    };
  }, [paise, kick]);

  const text = signed ? formatSignedINR(shown) : formatINR(shown);
  return <>{text}</>;
}
