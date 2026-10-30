import { BackLink } from "./BackLink";

// The header of every page that isn't the collection or a thought: the way
// back on the left, the page's name at the center.
export function PageHeader({ title }: { title: string }) {
  return (
    <header className="grid h-[72px] grid-cols-[44px_1fr_44px] items-center px-4 md:px-5">
      <BackLink />
      <h1 className="text-center text-[15px] font-medium text-pt">{title}</h1>
      <span />
    </header>
  );
}
