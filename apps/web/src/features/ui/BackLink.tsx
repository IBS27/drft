import { ArrowLeft } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

export function BackLink() {
  return (
    <Link
      to="/"
      aria-label="Back to thoughts"
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-[20px] text-pt transition-colors hover:bg-tint hover:text-ink"
    >
      <ArrowLeft aria-hidden="true" />
    </Link>
  );
}
