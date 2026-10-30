import type { ReactNode } from "react";

// A count, or a few words about one, in the accent's tint: section sizes,
// the collection's total, how many related thoughts.
export function Badge({
  children,
  size = "sm",
}: {
  children: ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={`inline-flex flex-none items-center rounded-full bg-tint-2 font-medium text-dot-ink tabular-nums ${
        size === "md" ? "h-[26px] px-[11px] text-[13px]" : "h-[18px] px-[7px] text-[11.5px]"
      }`}
    >
      {children}
    </span>
  );
}
