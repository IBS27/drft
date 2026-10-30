// No spinners. While a list is on its way, its rows are already in the
// room: the right heights, the same hairlines, breathing faintly, so
// nothing jumps when the words arrive.

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-full bg-line motion-reduce:animate-none ${className}`}
    />
  );
}

// Varied lengths so the placeholder reads as thoughts, not as a table.
const WIDTHS = ["w-[72%]", "w-[48%]", "w-[81%]", "w-[59%]", "w-[66%]", "w-[41%]"];

// One thought row, to the pixel: a 24px line box (16px text) inside
// py-3.5, parted from the row above by a hairline. The heading holds a
// group header's place: pt-[18px], a 20px line, pb-1.
export function SkeletonRows({
  count = 5,
  heading = false,
}: {
  count?: number;
  heading?: boolean;
}) {
  return (
    <div role="status" aria-label="loading">
      {heading && (
        <div className="flex h-5 items-center px-2.5 mt-[18px] mb-1">
          <Skeleton className="h-[9px] w-16" />
        </div>
      )}
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`flex items-center gap-3 px-2.5 py-3.5 ${
            i > 0 ? "shadow-[0_-1px_0_var(--line)]" : ""
          }`}
        >
          <span className="flex h-6 flex-1 items-center">
            <Skeleton className={`h-[11px] ${WIDTHS[i % WIDTHS.length]}`} />
          </span>
          <Skeleton className="h-[11px] w-10" />
        </div>
      ))}
    </div>
  );
}
