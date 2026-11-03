import { ArrowLeft } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

// Home, or the Held page when that is where you came from.
export function BackLink({ to = "/" }: { to?: "/" | "/held" }) {
  return (
    <Link
      to={to}
      aria-label={to === "/held" ? "Back to held thoughts" : "Back to thoughts"}
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-[20px] text-pt transition-colors hover:bg-tint hover:text-ink"
    >
      <ArrowLeft aria-hidden="true" />
    </Link>
  );
}
