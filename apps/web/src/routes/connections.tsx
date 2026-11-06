import { Graph } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, usePaginatedQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useState } from "react";
import { ConnectionsGraph } from "../features/connections/ConnectionsGraph";
import { BackLink } from "../features/ui/BackLink";
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

  return (
    <main className="flex min-h-dvh flex-col">
      <div className="flex min-h-dvh flex-col lg:hidden">
        <PageHeader title="Connections" />
        <div className="flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-line/70 text-[22px] text-pt">
            <Graph aria-hidden="true" />
          </span>
          <p className="mt-5 text-[17px] font-medium text-ink">Connections opens on a wider screen</p>
          <p className="mt-2 max-w-[30ch] text-[15px] leading-relaxed text-pl">
            Each thought's page still shows what it's near.
          </p>
        </div>
      </div>

      <div className="hidden min-h-dvh flex-1 flex-col lg:flex">
        <header className="relative z-10 grid h-[72px] flex-none grid-cols-[1fr_auto_1fr] items-center px-4 md:px-5">
          <span className="justify-self-start">
            <BackLink />
          </span>
          <h1 className="text-[16px] font-medium tracking-[-0.01em] text-ink">Connections</h1>
          <span className="flex items-center gap-2.5 justify-self-end">
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
