// Revokes a Sign in with Apple grant, as Apple asks of apps that delete an
// account (TN3194). Clerk's native flow signs in with the identity token
// alone and never holds an Apple refresh token, so the iOS app asks Apple
// for a fresh authorization code at deletion time and the server trades
// it for a token here, then revokes that token.
//
// Needs APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (the .p8 key with
// Sign in with Apple enabled — the one Clerk's Apple connection uses).
// APPLE_CLIENT_ID defaults to the iOS bundle id, the client the code was
// issued to. Without the key the revocation is skipped and logged.

import { fetchWithTimeout } from "./fetchWithTimeout";

declare const process: { env: Record<string, string | undefined> };

const APPLE = "https://appleid.apple.com";
const DEFAULT_CLIENT_ID = "com.srinivasib.drft";

export async function revokeAppleGrant(code: string): Promise<void> {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const privateKey = process.env.APPLE_PRIVATE_KEY;
  const clientId = process.env.APPLE_CLIENT_ID ?? DEFAULT_CLIENT_ID;
  if (!teamId || !keyId || !privateKey) {
    console.warn(
      "[apple] APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY not set — Sign in with Apple grant not revoked",
    );
    return;
  }
  const clientSecret = await clientSecretJwt(teamId, keyId, privateKey, clientId);

  const exchange = await fetchWithTimeout(`${APPLE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!exchange.ok)
    throw new Error(
      `Apple token exchange failed: ${exchange.status} ${await exchange.text()}`,
    );
  const tokens = (await exchange.json()) as {
    refresh_token?: string;
    access_token?: string;
  };
  const [token, hint] = tokens.refresh_token
    ? [tokens.refresh_token, "refresh_token"]
    : [tokens.access_token, "access_token"];
  if (!token) throw new Error("Apple token exchange returned no token");

  const revoke = await fetchWithTimeout(`${APPLE}/auth/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: hint,
    }),
  });
  if (!revoke.ok)
    throw new Error(
      `Apple token revocation failed: ${revoke.status} ${await revoke.text()}`,
    );
}

// The ES256 client secret Apple's token endpoints expect.
async function clientSecretJwt(
  teamId: string,
  keyId: string,
  pem: string,
  clientId: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId };
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + 300,
    aud: APPLE,
    sub: clientId,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8FromPem(pem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto's ECDSA output is already JWS's raw r||s form.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

// Accepts the .p8 file as-is, with real or escaped ("\n") line breaks.
function pkcs8FromPem(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "")
    .replace(/[^A-Za-z0-9+/=]/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64url(input: string | Uint8Array): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
