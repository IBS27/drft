import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";
import "./index.css";

// Clerk's script — the longest pole in the cold start — lives on a
// per-instance host encoded in the publishable key: base64 of the host
// with a trailing "$". Decoding it here lets the TLS handshake start
// before Clerk's loader has even been evaluated. (Convex's origin is
// preconnected from index.html, which the parser reaches sooner.)
function clerkOrigin(key: string | undefined): string | null {
  const encoded = key?.replace(/^pk_(?:test|live)_/, "");
  if (!encoded || encoded === key) return null;
  try {
    const host = atob(encoded).replace(/\$$/, "");
    return /^[\w.-]+$/.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

const origin = clerkOrigin(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
if (origin) {
  const link = document.createElement("link");
  link.rel = "preconnect";
  // Clerk loads its bundle with crossorigin="anonymous"; the preconnected
  // socket is only reused if this matches.
  link.crossOrigin = "anonymous";
  link.href = origin;
  document.head.appendChild(link);
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
// Scroll to the top on navigation (and restore on back/forward) — without
// this, moving between thoughts keeps the old scroll offset, so the new
// thought's words land mid-viewport.
// Route chunks load on hover/focus, so the click itself has nothing left
// to wait for.
const router = createRouter({
  routeTree,
  scrollRestoration: true,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <RouterProvider router={router} />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  </StrictMode>,
);
