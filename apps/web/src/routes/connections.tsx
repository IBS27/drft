import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvexAuth, usePaginatedQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useState } from "react";
import { ConnectionsGraph } from "../features/connections/ConnectionsGraph";
import { BackLink } from "../features/ui/BackLink";

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

  return (
    <main className="flex min-h-dvh flex-col">
      <div className="flex min-h-dvh flex-col lg:hidden">
        <header className="grid grid-cols-3 items-center px-5 pt-4 md:px-8">
          <BackLink />
          <span className="justify-self-center text-[11.5px] tracking-[0.4em] text-pl uppercase">
            connections
          </span>
          <span />
        </header>
        <div className="flex flex-1 items-center justify-center px-8 pb-24 text-center text-[10.5px] tracking-[0.26em] text-pl uppercase">
          connections is available on a larger screen
        </div>
      </div>

      <div className="hidden min-h-dvh flex-1 flex-col lg:flex">
        <header className="relative z-10 flex h-[72px] flex-none items-center justify-between px-8">
          <Link
            to="/"
            className="text-[10.5px] tracking-[0.26em] text-pl uppercase transition-colors hover:text-ink"
          >
            ‹ collection
          </Link>
          <span className="pointer-events-none absolute right-0 left-0 text-center text-[12px] tracking-[0.5em] text-pt">
            drft
          </span>
          <span className="flex items-center gap-5">
            <span className="text-[9.5px] tracking-[0.28em] text-pl uppercase">
              connections
            </span>
            <span className="text-[11px] tracking-[0.1em] text-pl tabular-nums">
              {results.length || ""}
            </span>
            {loading && <span aria-label="loading" className="caret h-3 w-px bg-ink" />}
          </span>
        </header>

        <ConnectionsGraph thoughts={results} loading={loading} />
      </div>
    </main>
  );
}
