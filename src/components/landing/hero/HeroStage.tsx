"use client";

// Decides whether (and how richly) to run the 3D hero, loads it lazily, and
// feeds it scroll and pointer input without re-rendering React. The static
// drawing stays visible until the first 3D frame, and stays for good when
// WebGL is unavailable, fails, or the scene throws.

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import type { SceneInput } from "./InstrumentScene";
import { RingsFallback } from "./RingsFallback";

const InstrumentScene = dynamic(() => import("./InstrumentScene"), { ssr: false, loading: () => null });

class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[hero] 3D scene unavailable; showing the static version.", error);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type Support = { quality: "high" | "low"; still: boolean } | null;

function detectSupport(): Support {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return null;
    (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    return null;
  }
  const narrow = matchMedia("(max-width: 767px)").matches;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  return {
    quality: narrow || coarse || fewCores || saveData ? "low" : "high",
    still: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

export function HeroStage() {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<SceneInput>({ progress: 0, px: 0, py: 0 });
  const [support, setSupport] = useState<Support>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(true);

  // Start loading the scene once the page is idle, so the headline paints first.
  useEffect(() => {
    const go = () => setSupport(detectSupport());
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(go, { timeout: 1200 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(go, 300);
    return () => clearTimeout(id);
  }, []);

  // Scroll progress through the hero, exposed to CSS as --p and to the scene.
  useEffect(() => {
    const section = root.current?.closest("section");
    if (!section) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      const travel = Math.max(rect.height - window.innerHeight, window.innerHeight * 0.6);
      const p = Math.min(Math.max(-rect.top / travel, 0), 1);
      input.current.progress = p;
      section.style.setProperty("--p", p.toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const io = new IntersectionObserver(([e]) => setActive(e.isIntersecting), { rootMargin: "100px" });
    io.observe(section);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      io.disconnect();
    };
  }, []);

  // Gentle pointer parallax, desktop pointers only.
  useEffect(() => {
    if (!support || support.still || !matchMedia("(pointer: fine)").matches) return;
    const onMove = (e: PointerEvent) => {
      input.current.px = (e.clientX / window.innerWidth) * 2 - 1;
      input.current.py = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [support]);

  const show3d = support && !failed;

  return (
    <div ref={root} className="absolute inset-0" aria-hidden>
      <div
        className={`hero-fallback pointer-events-none absolute inset-0 flex items-start justify-center pt-[13svh] transition-opacity duration-1000 lg:items-center lg:justify-end lg:pt-0 lg:pr-[6vw] ${
          ready && show3d ? "opacity-0" : "opacity-100"
        }`}
      >
        <RingsFallback className="h-[38svh] w-auto max-w-[86vw] lg:h-[62vh]" />
      </div>
      {show3d && (
        <div className={`absolute inset-0 transition-opacity duration-1000 ${ready ? "opacity-100" : "opacity-0"}`}>
          <SceneBoundary onError={() => setFailed(true)}>
            <InstrumentScene
              input={input}
              quality={support.quality}
              still={support.still}
              active={active}
              onReady={() => setReady(true)}
              onLost={() => setFailed(true)}
            />
          </SceneBoundary>
        </div>
      )}
    </div>
  );
}
