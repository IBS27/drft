import { Graph } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useState } from "react";
import { useDesktop } from "../features/ui/useDesktop";
import { ConnectionsGraph } from "../features/connections/ConnectionsGraph";
import { useGroupLayouts } from "../features/connections/useGroupLayouts";
import { localDate } from "../features/thoughts/format";
import { PageHeader } from "../features/ui/PageHeader";

export const Route = createFileRoute("/connections")({
  component: Connections,
});

// A page reads each thought, its links and the thought at the other end of
// each — up to 51 lookups a thought — so 80 is as many as one query can
// carry within Convex's limit on lookups (4,096) whatever the links.
const PAGE_SIZE = 80;

// Connections is the desk's widest room: every thought gets the canvas,
// beside the rail (routes/__root). Narrow screens never start the graph
// query.
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

  // Today's returned thought is named a little firmer, which changes its
  // group's layout — so the map waits for the live answer rather than
  // laying out once for a remembered one and again for the real one.
  const [date] = useState(() => localDate(Date.now()));
  const collection = useQuery(
    api.thoughts.collection,
    isAuthenticated && desktop ? { date } : "skip",
  );
  const returnedId = collection?.resurfacedId ?? null;
  // The map is laid out once, when the last page is in.
  const { map, settled } = useGroupLayouts(
    results,
    returnedId,
    status === "Exhausted" && collection !== undefined,
  );
  const loading = !settled;

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

      <div className="hidden min-h-dvh flex-1 flex-col lg:flex lg:pl-72 xl:pl-80">
        <PageHeader
          title="Connections"
          description="Thoughts that echo each other."
          aside={
            loading && <span aria-label="loading" className="caret h-4 w-0.5 rounded-full bg-dot" />
          }
        />

        {/* The title keeps the shared column; only the map below spreads wider (ConnectionsGraph's COLUMN). */}
        <ConnectionsGraph map={map} />
      </div>
    </main>
  );
}
