"use client";

// The receipt printer on the landing page: the same component and receipt
// format as the app, with a sample record. Prints once when scrolled into
// view; "Print again" replays it.

import { useEffect, useRef, useState } from "react";
import { settlementReceipt, type ReceiptData } from "@/lib/receipt";
import { prefersReducedMotion } from "../hydration";
import { ReceiptExperience } from "../receipt/ReceiptExperience";

const SAMPLE: ReceiptData = {
  ...settlementReceipt({
    id: "000000000000000000a1b2c3",
    title: "Rent, November",
    direction: "PAY",
    categoryName: "Housing",
    counterparty: "R. Menon (landlord)",
    amountPaise: 25_000_00,
    dueDate: "2026-11-01",
    settledOn: "2026-10-31",
  }),
  kind: "mock",
  number: "SAMPLE-20261031",
  footer: ["Sample from the Payment Tracker website.", "Not a real payment. Not a bank or tax receipt."],
};

export function ReceiptShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="receipt-stage relative mx-auto w-full max-w-[22rem] min-h-[34rem]">
      {inView && <ReceiptExperience receipt={SAMPLE} autoStart={!prefersReducedMotion()} />}
    </div>
  );
}
