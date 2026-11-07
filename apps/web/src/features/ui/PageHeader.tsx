import { BackLink } from "./BackLink";

// The header of every page that isn't the collection or a thought: the way
// back, then the page's name, on the same column as the page's content
// (the arrow's glyph lines up with the content's left edge).
export function PageHeader({ title }: { title: string }) {
  return (
    <header className="mx-auto flex h-[72px] w-full max-w-[688px] items-center gap-1 px-1.5 md:px-[30px] lg:h-auto lg:px-10 lg:pt-12 lg:pb-3">
      <span className="lg:hidden">
        <BackLink />
      </span>
      <h1 className="text-[17px] font-semibold tracking-[-0.015em] text-ink lg:text-[22px]">{title}</h1>
    </header>
  );
}
