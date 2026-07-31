// Stillness has no spinners. While a list is on its way, its rows are
// already in the room: the right heights, the same hairlines, breathing
// faintly — so nothing jumps when the words arrive.

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

// One thought row, to the pixel: text line box (16px text at 1.5) inside
// py-4, closed by the collection's hairline.
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
        <div className="mb-2 flex h-4 items-center">
          <Skeleton className="h-[7px] w-16" />
        </div>
      )}
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3.5 border-b border-line py-4"
        >
          <span className="flex h-6 flex-1 items-center">
            <Skeleton className={`h-[11px] ${WIDTHS[i % WIDTHS.length]}`} />
          </span>
          <Skeleton className="h-[11px] w-8" />
        </div>
      ))}
    </div>
  );
}
