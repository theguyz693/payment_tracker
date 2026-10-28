// Shared class strings for the landing page (tokens are scoped to .landing in globals.css).

export const btnPaper =
  "press group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-paper px-6 text-[15px] font-semibold text-studio shadow-[0_12px_30px_-12px_rgb(236_230_218/0.35)] transition-[transform,box-shadow,background-color] duration-300 hover:-translate-y-px hover:bg-white hover:shadow-[0_16px_36px_-12px_rgb(236_230_218/0.45)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass";

export const btnGhost =
  "press inline-flex h-12 items-center justify-center rounded-full border border-line-strong px-6 text-[15px] font-semibold text-ink transition-colors duration-300 hover:border-ink-3 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass";

/** Small uppercase mono label used as figure captions and eyebrows. */
export const eyebrow = "font-mono text-[11px] tracking-[0.22em] uppercase";

/** Large editorial serif headline. */
export const display = "font-display leading-[0.95] tracking-[-0.02em] text-ink";

export const d = (n: number) => ({ "--d": n }) as React.CSSProperties;
