import { Graph } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvexAuth, usePaginatedQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useState } from "react";
import { ConnectionsGraph } from "../features/connections/ConnectionsGraph";
import { localDate } from "../features/thoughts/format";
import { Rail } from "../features/thoughts/Rail";
import { useCachedQuery } from "../features/thoughts/useCachedQuery";
import { PageHeader } from "../features/ui/PageHeader";

export const Route = createFileRoute("/connections")({
  component: Connections,
});

const PAGE_SIZE = 80;

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(() =>
    window.matchMedia("(min-width: 64rem)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 64rem)");
    const change = () => setDesktop(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return desktop;
}

// Connections is the desk's widest room. It deliberately leaves the rail
// behind: every thought gets the canvas, while the same quiet header offers
// one way back. Narrow screens never start the graph query.
function Connections() {
  const desktop = useDesktop();
  const { isAuthenticated } = useConvexAuth();
  const { results, status, loadMore } = usePaginatedQuery(
    api.thoughts.connectionGraph,
    isAuthenticated && desktop ? {} : "skip",
    { initialNumItems: PAGE_SIZE },
  );

  useEffect(() => {
    if (status === "CanLoadMore") loadMore(PAGE_SIZE);
  }, [loadMore, status]);

  const loading = status !== "Exhausted";
  const [now] = useState(() => Date.now());
  const [date] = useState(() => localDate(now));
  const collection = useCachedQuery(
    api.thoughts.collection,
    isAuthenticated && desktop ? { date } : "skip",
    `collection:${date}`,
  );

  return (
    <main className="flex min-h-dvh flex-col">
      <div className="flex min-h-dvh flex-col lg:hidden">
        <PageHeader title="Connections" />
        <div className="flex flex-col items-center px-8 pt-[20vh] text-center">
          <span className="flex size-12 items-center justify-center rounded-[14px] bg-scr text-[22px] text-pt shadow-lift ring-1 ring-line ring-inset">
            <Graph aria-hidden="true" />
          </span>
          <p className="mt-5 max-w-[26ch] text-[17px] font-medium text-balance text-ink">The connections map opens on a wider screen</p>
          <p className="mt-2 max-w-[30ch] text-[15px] leading-relaxed text-balance text-pl">
            Open a thought to see related thoughts.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex h-10 items-center rounded-full bg-scr px-5 text-[14px] font-medium text-pt ring-1 ring-line ring-inset transition-colors hover:bg-tint hover:text-ink"
          >
            Back to thoughts
          </Link>
        </div>
      </div>

      {desktop && <Rail activeId={null} now={now} />}
      <div className="hidden min-h-dvh flex-1 flex-col lg:flex lg:pl-72 xl:pl-80">
        <PageHeader
          title="Connections"
          description="Thoughts that echo each other."
          aside={
            loading && <span aria-label="loading" className="caret h-4 w-0.5 rounded-full bg-dot" />
          }
        />

        <ConnectionsGraph
          thoughts={results}
          loading={loading}
          returnedId={collection?.resurfacedId ?? null}
        />
      </div>
    </main>
  );
}
