import { api } from "@drft/backend/convex/_generated/api";
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

  const button = "w-28 border py-2.5 text-[14px] transition-colors disabled:opacity-40";

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p className="text-[10.5px] tracking-[0.32em] text-pl uppercase">connections</p>
        <p className="mt-6 text-[16px] leading-relaxed text-pt">
          drft can link a new thought to the older ones it echoes.
        </p>
        <p className="mt-4 text-[14px] leading-relaxed text-mut">
          to do that, the text of each thought is sent to OpenAI, which turns it into
          numbers drft can compare. OpenAI doesn't train on it, and nothing else about
          you is sent.
        </p>

        <div className="mt-10 flex gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => choose(true)}
            className={`${button} border-ink text-ink hover:bg-ink hover:text-pg`}
          >
            allow
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => choose(false)}
            className={`${button} border-line text-mut hover:text-ink`}
          >
            not now
          </button>
        </div>
        <p className={`mt-3 text-[12px] text-mut ${failed ? "" : "invisible"}`}>
          couldn't save — try again
        </p>

        <p className="mt-8 text-[12px] text-faint">
          you can change this anytime in settings ·{" "}
          <a
            href="/privacy"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-line underline-offset-4 transition-colors hover:text-ink"
          >
            privacy policy
          </a>
        </p>
      </div>
    </main>
  );
}
