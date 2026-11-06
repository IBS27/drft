import { SignOutButton, useUser } from "@clerk/clerk-react";
import { ArrowUpRight, EnvelopeSimple, SignOut } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useRef, useState } from "react";
import { clearRememberedSession } from "../features/auth/rememberedSession";
import { DeleteAccount } from "../features/settings/DeleteAccount";
import { PageHeader } from "../features/ui/PageHeader";
import { Rail } from "../features/thoughts/Rail";

export const Route = createFileRoute("/settings")({ component: Settings });

// Nearly empty by design: the daily email time is the only real
// preference the product has. The server sends the email, so the time
// lives in Convex (docs/experience.html §07) — this page writes through.
// Alongside it, the permission connections need (consent.ts).
function Settings() {
  const { user } = useUser();
  const { isAuthenticated } = useConvexAuth();
  // The page can render before auth lands; ask only once it has.
  const settings = useQuery(api.settings.get, isAuthenticated ? {} : "skip");
  const save = useMutation(api.settings.save);
  const [time, setTime] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const consent = useQuery(api.consent.get, isAuthenticated ? {} : "skip");
  const setConnections = useMutation(
    api.consent.setAiConnections,
  ).withOptimisticUpdate((store, { allowed }) =>
    store.setQuery(api.consent.get, {}, { aiConnections: allowed }),
  );
  const [connectionsFailed, setConnectionsFailed] = useState(false);
  // Never asked reads as off — nothing is sent until allowed.
  const connections = consent?.aiConnections ?? false;

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  // `undefined` is "not answered yet"; `null` is "no row — use the
  // default". Until the answer lands the page keeps its shape and simply
  // says nothing, rather than showing a time that may not be yours.
  const loaded = settings !== undefined;
  const shown = time ?? settings?.sendTime ?? (loaded ? "08:00" : "");
  const email =
    settings?.email ?? user?.primaryEmailAddress?.emailAddress ?? "";

  const change = (value: string) => {
    if (!value) return;
    setTime(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void save({
        sendTime: value,
        timezone,
        email: user?.primaryEmailAddress?.emailAddress,
      })
        .then(() => setFailed(false))
        .catch(() => setFailed(true));
    }, 400);
  };

  const toggleConnections = () => {
    void setConnections({ allowed: !connections })
      .then(() => setConnectionsFailed(false))
      .catch(() => setConnectionsFailed(true));
  };

  return (
    <main className="min-h-dvh">
      <Rail activeId={null} now={now} />
      <div className="flex min-h-dvh flex-col lg:pl-72 xl:pl-80">
      <PageHeader title="Settings" />

      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 pt-6 pb-16 md:px-6">
        <div className={SURFACE}>
          <div className="flex items-center gap-3 px-4 py-3.5 text-[15px]">
            <EnvelopeSimple aria-hidden="true" className="flex-none text-[18px] text-pl" />
            <span className="flex-none text-pl">Signed in as</span>
            {email ? (
              <span className="min-w-0 flex-1 truncate text-right text-ink">{email}</span>
            ) : (
              <span className="inline-block h-2 w-[20ch] max-w-full rounded-full bg-line" />
            )}
          </div>

          <div className="px-4 py-3.5">
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="settings-send-time" className="text-[15px] text-ink">
                Daily thought
              </label>
              <select
                id="settings-send-time"
                value={shown}
                disabled={!loaded}
                onChange={(e) => change(e.target.value)}
                className="h-9 cursor-pointer appearance-none rounded-full bg-pg px-4 text-center text-[15px] text-ink tabular-nums ring-1 ring-line outline-none ring-inset hover:ring-dot-edge focus-visible:ring-dot-edge"
              >
                {timeOptions(shown).map((value) => (
                  <option key={value} value={value}>
                    {clockLabel(value)}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-1 text-[13px] text-pl">
              One thought returns each morning, {timezone.split("/").pop()?.replaceAll("_", " ")} time
            </div>
            {failed && (
              <div role="status" className="mt-1 text-[13px] text-dot-ink">
                Couldn't save. Change it again to retry.
              </div>
            )}
          </div>

          <div className="px-4 py-3.5">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[15px] text-ink">Connections</span>
              <button
                type="button"
                role="switch"
                aria-checked={connections}
                aria-label="Connections"
                disabled={consent === undefined}
                onClick={toggleConnections}
                className={`relative h-6 w-10 flex-none rounded-full transition-colors ${
                  consent === undefined
                    ? "invisible"
                    : connections
                      ? "bg-ink"
                      : "bg-line ring-1 ring-pl ring-inset"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-scr shadow-[0_1px_3px_color-mix(in_oklab,var(--ink)_30%,transparent)] transition-transform ${
                    connections ? "translate-x-4" : ""
                  }`}
                />
              </button>
            </div>
            <div className="mt-1 text-[13px] text-pl">
              Thought text is sent to OpenAI to find echoes
            </div>
            {connectionsFailed && (
              <div role="status" className="mt-1 text-[13px] text-dot-ink">
                Couldn't save. Change it again to retry.
              </div>
            )}
          </div>
        </div>

        <div className={SURFACE}>
          <a href="/privacy" target="_blank" rel="noreferrer" className={LINK_ROW}>
            Privacy policy
            <ArrowUpRight aria-hidden="true" className="text-[16px] text-pl" />
          </a>
          <SignOutButton>
            <button type="button" onClick={clearRememberedSession} className={LINK_ROW}>
              Sign out
              <SignOut aria-hidden="true" className="text-[16px] text-pl" />
            </button>
          </SignOutButton>
        </div>

        <div className={SURFACE}>
          <DeleteAccount />
        </div>
      </section>
      </div>
    </main>
  );
}

// Every half hour of the day, plus the saved time if it falls between
// (set to the minute on iOS), so the picker always shows what is stored.
function timeOptions(current: string): string[] {
  const options = Array.from({ length: 48 }, (_, i) => {
    const hours = String(Math.floor(i / 2)).padStart(2, "0");
    return `${hours}:${i % 2 === 0 ? "00" : "30"}`;
  });
  if (current && !options.includes(current)) options.push(current);
  return options.sort();
}

// "08:00" reads "8:00 am", as times do everywhere else in the room.
function clockLabel(value: string): string {
  const [h, m] = value.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

// Settings groups its rows on quiet surfaces, divided by hairlines.
const SURFACE =
  "divide-y divide-line rounded-[14px] border border-line bg-scr shadow-lift";
const LINK_ROW =
  "flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left text-[15px] text-ink transition-colors first:rounded-t-[13px] last:rounded-b-[13px] hover:bg-tint";
