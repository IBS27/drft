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
    <header className="relative z-10 mx-auto flex min-h-[72px] w-full max-w-[688px] flex-none items-center gap-1 py-3 pr-4 pl-1.5 md:px-[30px] lg:min-h-0 lg:px-10 lg:pt-12 lg:pb-5">
      <span className="self-start lg:hidden">
        <BackLink />
      </span>
      <span className="flex min-w-0 flex-col gap-1 pt-[7px] lg:pt-0">
        <h1 className="text-[17px] leading-[26px] font-semibold tracking-[-0.015em] text-ink lg:text-[22px] lg:leading-[30px]">
          {title}
        </h1>
        {description && <p className="text-[14px] text-pl lg:text-[15px]">{description}</p>}
      </span>
      {aside && <span className="ml-auto flex flex-none items-center gap-2.5">{aside}</span>}
    </header>
  );
}
