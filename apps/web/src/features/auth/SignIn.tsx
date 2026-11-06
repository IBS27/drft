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
            className={`grid h-12 w-full grid-cols-[22px_1fr_22px] items-center rounded-full px-5 text-[15px] font-medium text-ink ring-1 transition-[background-color,box-shadow,opacity,scale] ring-inset hover:bg-tint hover:ring-dot-edge active:scale-[0.98] disabled:cursor-default ${
              pending === strategy ? "bg-tint ring-dot-edge" : "bg-scr shadow-lift ring-[color-mix(in_oklab,var(--line),var(--ink)_10%)]"
            } ${pending && pending !== strategy ? "opacity-40" : ""}`}
          >
            {strategy === "oauth_google" ? (
              <GoogleMark />
            ) : (
              <Icon aria-hidden="true" weight="fill" className="text-[19px]" />
            )}
            <span className="text-center">{label}</span>
            <span aria-hidden="true" />
          </button>
        ))}
      </div>

      <p
        role="status"
        className={`mt-5 text-[13px] text-dot-ink ${failed ? "" : "invisible"}`}
      >
        Couldn't sign in. Try again.
      </p>

      <a
        href="/privacy"
        className="mt-2 text-[13px] text-pl underline decoration-line underline-offset-4 transition-colors hover:text-ink"
      >
        Privacy policy
      </a>
    </main>
  );
}

// Google's own four-colour mark, as its sign-in guidelines ask; the other
// providers use their monochrome marks.
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-[17px]">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
