import { describe, expect, it, vi } from "vitest";
import { createTokenFetcher, type TokenFetcherDeps } from "./tokenFetcher";

type GetToken = (options: {
  template: string;
  skipCache: boolean;
}) => Promise<string | null>;

// A Clerk session that stays signed in, and a clock that does not wait.
function setup(getToken: GetToken) {
  const live: { session: { getToken: GetToken } | null | undefined } = {
    session: { getToken },
  };
  const waits: number[] = [];
  const hooks = { onWait: () => {} };
  const log = vi.fn<TokenFetcherDeps["log"]>();
  const fetcher = createTokenFetcher({
    session: () => live.session,
    wait: async (ms) => {
      waits.push(ms);
      hooks.onWait();
    },
    log,
  });
  return { fetcher, live, waits, hooks, log };
}

describe("createTokenFetcher", () => {
  it("keeps asking when Clerk answers empty while still signed in", async () => {
    const getToken = vi
      .fn<GetToken>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("jwt");
    const { fetcher, waits, log } = setup(getToken);

    await expect(fetcher({ forceRefreshToken: true })).resolves.toBe("jwt");

    expect(getToken).toHaveBeenCalledTimes(3);
    expect(getToken).toHaveBeenLastCalledWith({
      template: "convex",
      skipCache: true,
    });
    expect(waits).toEqual([1000, 2000]);
    // The failure is logged once per flight, and so is the recovery.
    expect(log.mock.calls).toEqual([
      ["token-failed", { reason: "empty", force: true }],
      ["token-recovered", { attempts: 2 }],
    ]);
  });

  it("keeps asking when Clerk throws, and never rejects", async () => {
    const getToken = vi
      .fn<GetToken>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce("jwt");
    const { fetcher, log } = setup(getToken);

    await expect(fetcher({ forceRefreshToken: true })).resolves.toBe("jwt");

    expect(log).toHaveBeenCalledWith("token-failed", {
      reason: "threw",
      code: "TypeError",
      force: true,
    });
  });

  it("answers empty once Clerk has no session", async () => {
    const getToken = vi.fn<GetToken>().mockResolvedValue(null);
    const { fetcher, live } = setup(getToken);
    live.session = null;

    await expect(fetcher({ forceRefreshToken: false })).resolves.toBeNull();
    expect(getToken).not.toHaveBeenCalled();
  });

  it("stops retrying when a sign-out lands mid-flight", async () => {
    const { fetcher, live } = setup(async () => {
      live.session = null;
      return null;
    });

    await expect(fetcher({ forceRefreshToken: true })).resolves.toBeNull();
  });

  it("waits out the moment Clerk is between sessions", async () => {
    const getToken = vi.fn<GetToken>().mockResolvedValue("jwt");
    const { fetcher, live, waits, hooks } = setup(getToken);
    const session = live.session;
    live.session = undefined;
    hooks.onWait = () => {
      live.session = session;
    };

    await expect(fetcher({ forceRefreshToken: true })).resolves.toBe("jwt");
    expect(waits).toEqual([1000]);
  });

  it("backs off to a ceiling, and for as long as Clerk asks", async () => {
    const limited = Object.assign(new Error("Too many requests"), {
      status: 429,
      errors: [{ code: "too_many_requests" }],
      retryAfter: 30,
    });
    const getToken = vi.fn<GetToken>();
    getToken.mockRejectedValueOnce(limited);
    for (let i = 0; i < 5; i++) getToken.mockResolvedValueOnce(null);
    getToken.mockResolvedValueOnce("jwt");
    const { fetcher, waits, log } = setup(getToken);

    await fetcher({ forceRefreshToken: true });

    expect(waits).toEqual([30000, 2000, 4000, 8000, 15000, 15000]);
    expect(log).toHaveBeenCalledWith("token-failed", {
      reason: "api",
      status: 429,
      code: "too_many_requests",
      force: true,
    });
  });

  it("shares one flight between forced calls, and keeps cached calls out of it", async () => {
    let release: (token: string) => void = () => {};
    const getToken = vi.fn<GetToken>(({ skipCache }) =>
      skipCache
        ? new Promise<string>((resolve) => {
            release = resolve;
          })
        : Promise.resolve("cached"),
    );
    const { fetcher } = setup(getToken);

    const first = fetcher({ forceRefreshToken: true });
    const second = fetcher({ forceRefreshToken: true });
    const cached = fetcher({ forceRefreshToken: false });
    release("fresh");

    await expect(Promise.all([first, second, cached])).resolves.toEqual([
      "fresh",
      "fresh",
      "cached",
    ]);
    expect(getToken).toHaveBeenCalledTimes(2);

    // A flight that has landed is never handed out again.
    const next = fetcher({ forceRefreshToken: true });
    release("fresher");
    await expect(next).resolves.toBe("fresher");
  });
});
