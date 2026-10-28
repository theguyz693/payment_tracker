import Link from "next/link";
import { btnGhost, btnPaper, d } from "../styles";
import { HeroStage } from "./HeroStage";

// Desktop: a tall section with a sticky stage, so the rings align while the
// reader scrolls through it (normal scrolling, nothing is hijacked).
// Mobile: one screen, instrument above the copy.
export function Hero() {
  return (
    <section id="top" className="hero relative lg:h-[185vh]">
      <div className="relative min-h-svh overflow-hidden lg:sticky lg:top-0 lg:h-svh">
        <div className="hero-floor pointer-events-none absolute inset-0" aria-hidden />
        <HeroStage />

        <div className="relative mx-auto flex min-h-svh max-w-[88rem] flex-col justify-end px-5 pt-28 pb-10 sm:px-8 lg:h-svh lg:justify-center lg:pt-16 lg:pb-16">
          <div className="hero-copy max-w-[46rem]">
            <p className="hero-in font-mono text-[11px] tracking-[0.22em] text-brass uppercase" style={d(0)}>
              Fig. 01 — A personal finance instrument
            </p>
            <h1
              className="hero-in mt-5 font-display text-[clamp(3.4rem,10.5vw,9.75rem)] leading-[0.86] tracking-[-0.025em] text-ink"
              style={d(1)}
            >
              Every rupee,
              <br />
              in <em className="text-brass">alignment.</em>
            </h1>
            <p className="hero-in mt-7 max-w-[30rem] text-[17px] leading-relaxed text-ink-2 sm:text-lg" style={d(2)}>
              What you owe, what you&apos;re owed, your EMIs, investments and savings goals, measured and scheduled in one quiet
              place.
            </p>
            <div className="hero-in mt-9 flex flex-col gap-3 min-[420px]:flex-row" style={d(3)}>
              <Link href="/signup" className={btnPaper}>
                Create your account
                <span aria-hidden className="ml-1 transition-transform duration-300 group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
              <Link href="/login" className={btnGhost}>
                Log in
              </Link>
            </div>
          </div>

          <div className="hero-caption pointer-events-none absolute right-8 bottom-16 hidden max-w-[24rem] text-right lg:block">
            <p className="font-mono text-[11px] tracking-[0.22em] text-mint uppercase">Fig. 02 — Aligned</p>
            <p className="mt-3 font-display text-3xl leading-tight text-ink">Payments, receivables, loans, investments and goals. One axis.</p>
          </div>

          <a
            href="#product"
            className="hero-cue absolute bottom-8 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-3 font-mono text-[10px] tracking-[0.3em] text-ink-3 uppercase lg:flex"
          >
            Scroll to align
            <span aria-hidden className="block h-10 w-px bg-gradient-to-b from-ink-3 to-transparent" />
          </a>
        </div>
      </div>
    </section>
  );
}
