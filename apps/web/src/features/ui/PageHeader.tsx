import type { ReactNode } from "react";
import { BackLink } from "./BackLink";

// The header of every page that isn't the collection or a thought: the way
// back, then the page's name and one line about it, on the same column as
// the page's content (the arrow's glyph lines up with the content's left
// edge). Anything aside, like a view switch, sits at the far end.
export function PageHeader({
  title,
  description,
  aside,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
}) {
  return (
    <header className="relative z-10 mx-auto flex min-h-[72px] w-full max-w-[688px] flex-none flex-wrap items-center gap-x-1 py-3 pr-4 pl-1.5 md:px-[30px] lg:min-h-0 lg:px-10 lg:pt-12 lg:pb-5">
      <span className="lg:hidden">
        <BackLink />
      </span>
      <h1 className="text-[17px] font-semibold tracking-[-0.015em] text-ink lg:text-[22px]">{title}</h1>
      {aside && <span className="ml-auto flex flex-none items-center gap-2.5">{aside}</span>}
      {/* Its own line, on the content's edge rather than the title's. */}
      {description && (
        <p className="mt-1 w-full pl-2.5 text-[14px] text-pl lg:pl-0 lg:text-[15px]">{description}</p>
      )}
    </header>
  );
}
