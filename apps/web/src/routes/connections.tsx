import { ArrowLeft } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvexAuth, usePaginatedQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useState } from "react";
import { ConnectionsGraph } from "../features/connections/ConnectionsGraph";
import { Badge } from "../features/ui/Badge";
import { PageHeader } from "../features/ui/PageHeader";
import { Wordmark } from "../features/ui/Wordmark";

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
        <PageHeader title="Connections" />
        <div className="flex flex-1 items-center justify-center px-8 pb-24 text-center text-[15px] text-pt">
          Connections is available on a larger screen.
        </div>
      </div>

      <div className="hidden min-h-dvh flex-1 flex-col lg:flex">
        <header className="relative z-10 grid h-[72px] flex-none grid-cols-[1fr_auto_1fr] items-center px-6">
          <Link
            to="/"
            className="inline-flex h-9 items-center gap-2 justify-self-start rounded-full px-3.5 text-[14px] text-pt transition-colors hover:bg-tint hover:text-ink"
          >
            <ArrowLeft aria-hidden="true" className="text-[16px]" />
            Collection
          </Link>
          <Wordmark />
          <span className="flex items-center gap-2.5 justify-self-end">
            <span className="text-[14px] font-medium text-pt">Connections</span>
            {results.length > 0 && <Badge size="md">{results.length}</Badge>}
            {loading && (
              <span aria-label="loading" className="caret h-4 w-0.5 rounded-full bg-dot" />
            )}
          </span>
        </header>

        <ConnectionsGraph thoughts={results} loading={loading} />
      </div>
    </main>
  );
}
