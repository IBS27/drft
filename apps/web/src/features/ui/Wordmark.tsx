// drft, with the vermilion dot that marks "now".
export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-[17px] font-semibold tracking-[-0.02em] text-ink">
      <span aria-hidden="true" className="size-2 rounded-full bg-dot" />
      drft
    </span>
  );
}
