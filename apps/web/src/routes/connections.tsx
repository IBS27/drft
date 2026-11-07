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
        <div className="flex flex-col items-center px-8 pt-[22vh] text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-line/70 text-[22px] text-pt">
            <Graph aria-hidden="true" />
          </span>
          <p className="mt-5 text-[17px] font-medium text-ink">Connections opens on a wider screen</p>
          <p className="mt-2 max-w-[30ch] text-[15px] leading-relaxed text-balance text-pl">
            Each thought's page still shows what it's near.
          </p>
          <Link
            to="/"
            className="mt-5 text-[14px] font-medium text-pt underline decoration-line underline-offset-4 transition-colors hover:text-ink"
          >
            Back to thoughts
          </Link>
        </div>
      </div>

      {desktop && <Rail activeId={null} now={now} />}
      <div className="hidden min-h-dvh flex-1 flex-col lg:flex lg:pl-72 xl:pl-80">
        <header className="relative z-10 mx-auto flex w-full max-w-[688px] flex-none flex-col gap-1 px-10 pt-12 pb-3">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">Connections</h1>
          <p className="text-[15px] text-pl">Thoughts that echo each other.</p>
          <span className="ml-auto flex items-center gap-2.5">
            {loading && (
              <span aria-label="loading" className="caret h-4 w-0.5 rounded-full bg-dot" />
            )}
          </span>
        </header>

        <ConnectionsGraph
          thoughts={results}
          loading={loading}
          returnedId={collection?.resurfacedId ?? null}
        />
      </div>
    </main>
  );
}
