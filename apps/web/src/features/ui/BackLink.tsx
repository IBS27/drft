import { Link } from "@tanstack/react-router";

export function BackLink() {
  return (
    <Link
      to="/"
      aria-label="Back to thoughts"
      className="flex size-11 shrink-0 items-center justify-center text-pl transition-colors hover:text-ink"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m15 5-7 7 7 7" />
      </svg>
    </Link>
  );
}
