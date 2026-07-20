import { AuthenticateWithRedirectCallback } from "@clerk/clerk-react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sso-callback")({ component: SsoCallback });

// Finishes the OAuth handshake, then hard-navigates to "/".
function SsoCallback() {
  return (
    <main className="min-h-dvh">
      <AuthenticateWithRedirectCallback />
    </main>
  );
}
