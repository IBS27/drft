import { SignOutButton, useUser } from "@clerk/clerk-react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useRef, useState } from "react";
import { BackLink } from "../features/ui/BackLink";

export const Route = createFileRoute("/settings")({ component: Settings });

// Nearly empty by design: the daily email time is the only real
// preference the product has. The server sends the email, so the time
// lives in Convex (docs/experience.html §08) — this page writes through.
function Settings() {
  const { user } = useUser();
  const settings = useQuery(api.settings.get);
  const save = useMutation(api.settings.save);
  const [time, setTime] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const shown = time ?? settings?.sendTime ?? "08:00";
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

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="grid grid-cols-3 items-center px-5 pt-4 md:px-8">
        <BackLink />
        <span className="justify-self-center text-[11.5px] tracking-[0.4em] text-pl uppercase">
          settings
        </span>
        <span />
      </header>

      <section className="mx-auto w-full max-w-2xl flex-1 px-6 pt-16 pb-16">
        <div className="border-b border-line py-4 text-[14px] text-mut">
          {email}
        </div>

        <div className="border-b border-line py-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[16px] text-pt">daily thought</span>
            <input
              type="time"
              value={shown}
              onChange={(e) => change(e.target.value)}
              className="bg-transparent text-[16px] text-pt tabular-nums outline-none"
            />
          </div>
          <div className="mt-1 text-[12px] text-faint">
            one thought returns each morning · {timezone}
          </div>
          {failed && (
            <div className="mt-1 text-[12px] text-mut">
              couldn't save — change it again to retry
            </div>
          )}
        </div>

        <div className="border-b border-line py-4">
          <SignOutButton>
            <button
              type="button"
              className="text-[14px] text-mut transition-colors hover:text-ink"
            >
              sign out
            </button>
          </SignOutButton>
        </div>
      </section>
    </main>
  );
}
