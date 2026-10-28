// Static drawing of the hero instrument. Shown while the 3D scene loads, and
// instead of it without JavaScript or WebGL. Server-rendered, no motion.

const TICKS = Array.from({ length: 60 }, (_, i) => i);

export function RingsFallback({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="-260 -260 520 520" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id="rf-steel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2f3f5" />
          <stop offset="0.45" stopColor="#8d9097" />
          <stop offset="1" stopColor="#3c3f45" />
        </linearGradient>
        <linearGradient id="rf-brass" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#6e5430" />
          <stop offset="0.5" stopColor="#e2c48f" />
          <stop offset="1" stopColor="#8a6a3c" />
        </linearGradient>
        <radialGradient id="rf-glass" cx="0.4" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#5a5f69" stopOpacity="0.9" />
          <stop offset="1" stopColor="#15171b" stopOpacity="0.95" />
        </radialGradient>
        <radialGradient id="rf-shadow">
          <stop offset="0" stopColor="#000" stopOpacity="0.55" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="0" cy="238" rx="190" ry="16" fill="url(#rf-shadow)" />
      <ellipse cx="0" cy="0" rx="205" ry="96" fill="none" stroke="url(#rf-steel)" strokeWidth="5" transform="rotate(-18)" />
      <ellipse cx="0" cy="0" rx="74" ry="172" fill="none" stroke="url(#rf-brass)" strokeWidth="8" transform="rotate(24)" />
      <g transform="rotate(-6) scale(1 0.62)">
        <circle r="136" fill="none" stroke="#34373d" strokeWidth="15" />
        {TICKS.map((i) => (
          <line key={i} x1="0" y1={-128} x2="0" y2={i % 5 === 0 ? -112 : -121} stroke="#c9a46b" strokeWidth={i % 5 === 0 ? 1.6 : 0.9} transform={`rotate(${i * 6})`} />
        ))}
      </g>
      <circle r="80" fill="url(#rf-glass)" stroke="url(#rf-brass)" strokeWidth="2.5" />
      <text x="0" y="28" textAnchor="middle" fontSize="88" fontFamily="Georgia, serif" fill="#c9a46b">
        ₹
      </text>
      <line x1="0" y1="-112" x2="40" y2="-168" stroke="#8fd9bf" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="44" cy="-174" r="4.5" fill="#8fd9bf" />
    </svg>
  );
}

/** Small aligned version of the instrument, used as the wordmark's symbol. */
export function InstrumentMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="#c9a46b" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="5.5" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1" />
      <line x1="16" y1="1.5" x2="16" y2="7" stroke="#8fd9bf" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
