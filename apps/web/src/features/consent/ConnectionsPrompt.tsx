import { api } from "@drft/backend/convex/_generated/api";
import { Graph } from "@phosphor-icons/react";
import { useMutation } from "convex/react";
import { useState } from "react";

// Asked once, before any thought text leaves for OpenAI (App Store
// 5.1.2(i)). Until a choice lands nothing is sent — see
// packages/backend/convex/consent.ts. Same words as the iOS prompt; both
// answers are equally easy, and either can be changed in settings.
export function ConnectionsPrompt() {
  const decide = useMutation(api.consent.setAiConnections);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const choose = (allowed: boolean) => {
    if (pending) return;
    setPending(true);
    setFailed(false);
    // On success the consent query answers and this prompt unmounts.
    void decide({ allowed }).catch(() => {
      setPending(false);
      setFailed(true);
    });
  };

  const button =
    "inline-flex h-11 items-center justify-center rounded-full px-6 text-[15px] font-semibold transition-[background-color,box-shadow,filter,scale] active:scale-[0.98] disabled:opacity-40";

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-md rounded-card bg-scr p-7 ring-1 ring-line ring-inset">
        <span className="flex size-10 items-center justify-center rounded-full bg-tint text-[20px] text-dot-ink">
          <Graph aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.02em] text-ink">
          Connections
        </h1>
        <p className="mt-3 text-[16px] leading-relaxed text-pt">
          drft can link a new thought to the older ones it echoes.
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-pl">
          To do that, the text of each thought is sent to OpenAI, which turns it into
          numbers drft can compare. OpenAI doesn't train on it, and nothing else about
          you is sent.
        </p>

        <div className="mt-8 flex gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => choose(true)}
            className={`${button} bg-dot text-on-dot hover:brightness-105`}
          >
            Allow
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => choose(false)}
            className={`${button} text-pt ring-1 ring-line ring-inset hover:bg-tint hover:text-ink`}
          >
            Not now
          </button>
        </div>
        <p
          role="status"
          className={`mt-3 text-[13px] text-dot-ink ${failed ? "" : "invisible"}`}
        >
          Couldn't save. Try again.
        </p>

        <p className="mt-5 text-[13px] text-pl">
          You can change this anytime in settings.{" "}
          <a
            href="/privacy"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-line underline-offset-4 transition-colors hover:text-ink"
          >
            Privacy policy
          </a>
        </p>
      </div>
    </main>
  );
}
