// Small line illustrations for empty states. Colours come from tokens, so
// they work in light and dark mode.

const common = { fill: "none", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** Calendar with a check: nothing due. */
export function AllClearIllustration({ tone = "pay" }: { tone?: "pay" | "receive" }) {
  const accent = tone === "pay" ? "var(--color-pay)" : "var(--color-receive)";
  const soft = tone === "pay" ? "var(--color-pay-soft)" : "var(--color-receive-soft)";
  return (
    <svg width="96" height="72" viewBox="0 0 96 72" aria-hidden {...common}>
      <rect x="22" y="12" width="52" height="48" rx="8" fill="var(--color-surface)" stroke="var(--color-line-strong)" />
      <path d="M22 26h52" stroke="var(--color-line-strong)" />
      <path d="M34 8v8M62 8v8" stroke="var(--color-line-strong)" />
      <circle cx="48" cy="43" r="11" fill={soft} stroke={accent} />
      <path d="m43 43 3.5 3.5L53 40" stroke={accent} strokeWidth="2.5" />
      <path d="M10 30h6M80 22h6M83 46h5M8 50h4" stroke="var(--color-line-strong)" />
    </svg>
  );
}

/** Wallet with coins: nothing tracked yet. */
export function WalletIllustration() {
  return (
    <svg width="104" height="76" viewBox="0 0 104 76" aria-hidden {...common}>
      <rect x="18" y="20" width="62" height="44" rx="9" fill="var(--color-surface)" stroke="var(--color-line-strong)" />
      <path d="M18 32h62" stroke="var(--color-line-strong)" />
      <rect x="60" y="38" width="26" height="16" rx="5" fill="var(--color-pay-soft)" stroke="var(--color-pay)" />
      <circle cx="69" cy="46" r="2.5" fill="var(--color-pay)" stroke="none" />
      <circle cx="30" cy="12" r="7" fill="var(--color-receive-soft)" stroke="var(--color-receive)" />
      <path d="M28 12h4" stroke="var(--color-receive)" />
      <circle cx="88" cy="18" r="5" fill="var(--color-pending-soft)" stroke="var(--color-pending)" />
    </svg>
  );
}

/** Magnifier over lines: no search results. */
export function SearchIllustration() {
  return (
    <svg width="96" height="72" viewBox="0 0 96 72" aria-hidden {...common}>
      <rect x="16" y="14" width="50" height="46" rx="8" fill="var(--color-surface)" stroke="var(--color-line-strong)" />
      <path d="M26 28h30M26 38h22M26 48h26" stroke="var(--color-line)" />
      <circle cx="62" cy="40" r="12" fill="var(--color-canvas)" stroke="var(--color-ink-3)" />
      <path d="m71 49 9 9" stroke="var(--color-ink-3)" strokeWidth="3" />
    </svg>
  );
}

/** Bar chart outline: no activity this month. */
export function ChartIllustration() {
  return (
    <svg width="96" height="72" viewBox="0 0 96 72" aria-hidden {...common}>
      <path d="M18 60h60" stroke="var(--color-line-strong)" />
      <rect x="26" y="40" width="10" height="20" rx="3" fill="var(--color-pay-soft)" stroke="var(--color-line-strong)" />
      <rect x="43" y="28" width="10" height="32" rx="3" fill="var(--color-pay-soft)" stroke="var(--color-line-strong)" />
      <rect x="60" y="46" width="10" height="14" rx="3" fill="var(--color-pay-soft)" stroke="var(--color-line-strong)" />
    </svg>
  );
}
