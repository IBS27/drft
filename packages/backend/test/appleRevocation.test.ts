// @vitest-environment edge-runtime
import { afterEach, describe, expect, it, vi } from "vitest";
import { revokeAppleGrant } from "../convex/appleRevocation";

function base64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

describe("revokeAppleGrant", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("trades the code for a refresh token and revokes it with a valid ES256 client secret", async () => {
    const keys = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = base64(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
    // As pasted from the .p8 file into a single-line env var.
    vi.stubEnv(
      "APPLE_PRIVATE_KEY",
      `-----BEGIN PRIVATE KEY-----\\n${pkcs8.slice(0, 64)}\\n${pkcs8.slice(64)}\\n-----END PRIVATE KEY-----`,
    );
    vi.stubEnv("APPLE_TEAM_ID", "TEAM123");
    vi.stubEnv("APPLE_KEY_ID", "KEY456");

    const calls: { url: string; body: URLSearchParams }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: URLSearchParams }) => {
        calls.push({ url, body: new URLSearchParams(init.body) });
        return url.endsWith("/auth/token")
          ? Response.json({ refresh_token: "refresh-1", access_token: "access-1" })
          : new Response(null, { status: 200 });
      }),
    );

    await revokeAppleGrant("code-1");

    expect(calls.map((c) => c.url)).toEqual([
      "https://appleid.apple.com/auth/token",
      "https://appleid.apple.com/auth/revoke",
    ]);
    expect(calls[0].body.get("code")).toBe("code-1");
    expect(calls[0].body.get("client_id")).toBe("com.srinivasib.drft");
    expect(calls[1].body.get("token")).toBe("refresh-1");
    expect(calls[1].body.get("token_type_hint")).toBe("refresh_token");

    const secret = calls[0].body.get("client_secret") ?? "";
    const [header, payload, signature] = secret.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(header)))).toEqual({
      alg: "ES256",
      kid: "KEY456",
    });
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(payload)))).toMatchObject({
      iss: "TEAM123",
      aud: "https://appleid.apple.com",
      sub: "com.srinivasib.drft",
    });
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keys.publicKey,
      fromBase64url(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(valid).toBe(true);
  });

  it("skips quietly when the Apple key is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await revokeAppleGrant("code-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
