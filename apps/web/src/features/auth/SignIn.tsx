import { useSignIn } from "@clerk/clerk-react";
import { AppleLogo, GithubLogo, GoogleLogo, type Icon } from "@phosphor-icons/react";
import { useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { LogoMark } from "../ui/Wordmark";

type Strategy = "oauth_apple" | "oauth_google" | "oauth_github";

// Labels follow Apple's "Continue with Apple" wording, kept uniform across providers.
const PROVIDERS: { strategy: Strategy; label: string; Icon: Icon }[] = [
  { strategy: "oauth_apple", label: "Continue with Apple", Icon: AppleLogo },
  { strategy: "oauth_google", label: "Continue with Google", Icon: GoogleLogo },
  { strategy: "oauth_github", label: "Continue with GitHub", Icon: GithubLogo },
];

export function SignIn() {
  const { signIn, isLoaded } = useSignIn();
  const redirectUrlComplete = useLocation({ select: (location) => location.href });
  const [pending, setPending] = useState<Strategy | null>(null);
  const [failed, setFailed] = useState(false);

  const start = async (strategy: Strategy) => {
    if (!signIn || pending) return;
    setPending(strategy);
    setFailed(false);
    try {
      await signIn.authenticateWithRedirect({
        strategy,
        redirectUrl: "/sso-callback",
        redirectUrlComplete,
      });
    } catch {
      setPending(null);
      setFailed(true);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 pb-16">
      <span className="flex size-[76px] items-center justify-center rounded-[22px] bg-scr shadow-lift ring-1 ring-line ring-inset">
        <LogoMark className="h-[30px] text-ink" />
      </span>
      <h1 className="mt-7 text-[34px] font-semibold tracking-[-0.03em] text-ink">drft</h1>
      <p className="mt-2 text-[17px] text-pt">A space for unfinished thoughts</p>

      <div className="mt-11 flex w-[300px] max-w-full flex-col gap-3">
        {PROVIDERS.map(({ strategy, label, Icon }) => (
          <button
            key={strategy}
            type="button"
            disabled={!isLoaded || pending !== null}
            onClick={() => start(strategy)}
            className={`flex h-12 w-full items-center justify-center gap-3 rounded-full text-[15px] font-medium text-ink ring-1 transition-[background-color,box-shadow,opacity,scale] ring-inset hover:bg-tint hover:ring-dot-edge active:scale-[0.98] disabled:cursor-default ${
              pending === strategy ? "bg-tint ring-dot-edge" : "bg-scr shadow-lift ring-line"
            } ${pending && pending !== strategy ? "opacity-40" : ""}`}
          >
            <Icon aria-hidden="true" weight="fill" className="text-[18px]" />
            {label}
          </button>
        ))}
      </div>

      <p
        role="status"
        className={`mt-6 text-[13px] text-dot-ink ${failed ? "" : "invisible"}`}
      >
        Couldn't sign in. Try again.
      </p>

      <a
        href="/privacy"
        className="fixed bottom-6 text-[13px] text-pl transition-colors hover:text-ink"
      >
        Privacy policy
      </a>
    </main>
  );
}
