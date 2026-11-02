// The logo mark (the app icon's dot and caret) beside "drft".
export function Wordmark() {
  return (
    <span className="inline-flex items-baseline gap-[0.45em] text-[17px] font-semibold tracking-[-0.02em] text-ink">
      <LogoMark className="h-[0.74em]" />
      drft
    </span>
  );
}

// The dot and caret from the app icon, cropped to the glyph. Both shapes sit
// on the bottom edge, so in a baseline-aligned row they rest on the baseline.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 26" className={`flex-none ${className ?? ""}`}>
      <circle cx="6" cy="20" r="6" className="fill-dot" />
      <rect x="16" width="4" height="26" rx="1.5" fill="currentColor" />
    </svg>
  );
}
