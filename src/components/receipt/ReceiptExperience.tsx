"use client";

// Drives the user's ReceiptPrinter animation (processing → printing →
// complete) for one receipt, plus print / download / replay.
// The animation is purely local state: navigating away at any point is fine.

import { useCallback, useEffect, useRef, useState } from "react";
import { receiptText, type ReceiptData } from "@/lib/receipt";
import { Download, Printer, Refresh } from "../icons";
import { btnSecondary } from "../ui";
import { ReceiptPrinter, type ReceiptPrinterStage } from "./ReceiptPrinter";

const PROCESSING_MS = 900;
const PRINTING_MS = 1900; // the paper feed itself takes 1.75s

export function ReceiptExperience({ receipt, autoStart = true }: { receipt: ReceiptData; autoStart?: boolean }) {
  const [stage, setStage] = useState<ReceiptPrinterStage>(autoStart ? "processing" : "complete");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const run = useCallback(() => {
    timers.current.forEach(clearTimeout);
    setStage("processing");
    timers.current = [setTimeout(() => setStage("printing"), PROCESSING_MS), setTimeout(() => setStage("complete"), PROCESSING_MS + PRINTING_MS)];
  }, []);

  useEffect(() => {
    if (autoStart) run();
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, [autoStart, run, receipt.number]);

  function download() {
    const blob = new Blob([receiptText(receipt)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${receipt.number}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const mock = receipt.kind === "mock";
  const status =
    stage === "processing" ? (mock ? "Warming up the printer" : "Looking up the payment") : stage === "printing" ? "Printing your receipt" : mock ? "Sample printed" : "Receipt ready";

  return (
    <div className="flex flex-col items-center gap-5">
      <ReceiptPrinter.Root stage={stage} feedMotion="stepped" aria-label={mock ? "Sample bill printer" : "Receipt printer"}>
        <ReceiptPrinter.Machine>
          <ReceiptPrinter.Header>
            <ReceiptPrinter.Status>{status}</ReceiptPrinter.Status>
            <span className="text-[10px] font-semibold tracking-[0.2em] text-grayscale-8 uppercase dark:text-grayscale-11">₹ Tracker</span>
          </ReceiptPrinter.Header>
          <ReceiptPrinter.Screen>
            <div className="flex items-end justify-between gap-3 font-mono">
              <div className="min-w-0">
                <div className="truncate text-[11px] tracking-wider uppercase opacity-60">{receipt.title}</div>
                <div className="num text-2xl font-bold">{receipt.amount}</div>
              </div>
              <div className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${mock ? "bg-gold/25 text-gold" : "bg-green-9/20 text-green-9"}`}>
                {stage === "complete" ? receipt.status : "…"}
              </div>
            </div>
          </ReceiptPrinter.Screen>
        </ReceiptPrinter.Machine>
        {/* Height follows the paper so long bills aren't clipped (the feed animation uses transforms only). */}
        <ReceiptPrinter.Output style={{ height: "auto", minHeight: "20rem" }}>
          <ReceiptPrinter.Paper>
            <PaperContent receipt={receipt} />
          </ReceiptPrinter.Paper>
        </ReceiptPrinter.Output>
      </ReceiptPrinter.Root>

      <div className="no-print flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => window.print()} disabled={stage !== "complete"} className={btnSecondary}>
          <Printer width={15} height={15} /> Print / Save as PDF
        </button>
        <button type="button" onClick={download} disabled={stage !== "complete"} className={btnSecondary}>
          <Download width={15} height={15} /> Download (.txt)
        </button>
        <button type="button" onClick={run} disabled={stage !== "complete"} className={btnSecondary}>
          <Refresh width={15} height={15} /> Print again
        </button>
      </div>

      {/* Static copy used when printing (the animated paper may be mid-feed). */}
      <div className="print-area hidden bg-white p-4 font-mono text-black print:block">
        <PaperContent receipt={receipt} />
      </div>
    </div>
  );
}

function PaperContent({ receipt: r }: { receipt: ReceiptData }) {
  const mock = r.kind === "mock";
  return (
    <div className="relative text-[12px] leading-relaxed">
      {mock && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
          <span className="-rotate-[28deg] text-5xl font-black tracking-widest opacity-[0.08]">SAMPLE</span>
        </div>
      )}
      <div className="text-center">
        <div className="text-sm font-bold tracking-[0.18em]">{r.heading}</div>
        <div className="mt-0.5 opacity-70">{r.number}</div>
      </div>
      <Rule />
      <div className="font-bold break-words">{r.title}</div>
      <dl className="mt-1 space-y-0.5">
        {r.lines.map((l) => (
          <div key={l.label} className="flex justify-between gap-3">
            <dt className="opacity-70">{l.label}</dt>
            <dd className="text-right break-words">{l.value}</dd>
          </div>
        ))}
      </dl>
      {r.items.length > 0 && (
        <>
          <Rule />
          <ul className="space-y-0.5">
            {r.items.map((i, k) => (
              <li key={k} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">
                  {i.qty} × {i.name}
                </span>
                <span>{i.amount}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Rule />
      <div className="flex items-baseline justify-between">
        <span className="font-bold">TOTAL</span>
        <span className="text-lg font-bold">{r.amount}</span>
      </div>
      <div className="mt-2 flex justify-center">
        <span className={`rounded border-2 px-2 py-0.5 text-xs font-black tracking-[0.25em] ${mock ? "border-dashed" : ""}`}>{r.status}</span>
      </div>
      <Rule />
      <div className="space-y-0.5 text-center text-[10px] opacity-70">
        {r.footer.map((f) => (
          <p key={f}>{f}</p>
        ))}
      </div>
      {/* Decorative barcode from the receipt number. */}
      <div aria-hidden className="mx-auto mt-3 flex h-8 w-44 items-stretch justify-center gap-px">
        {r.number.split("").map((c, i) => (
          <span key={i} className="bg-current" style={{ width: `${(c.charCodeAt(0) % 3) + 1}px`, opacity: 0.85 }} />
        ))}
      </div>
    </div>
  );
}

function Rule() {
  return <div aria-hidden className="my-2 border-t border-dashed border-current opacity-40" />;
}
