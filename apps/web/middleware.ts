import { next, rewrite } from "@vercel/edge";

// One domain, two surfaces (Vercel Edge Middleware — no effect on local dev,
// where vite.config.ts mirrors this): signed-out visitors on "/" get the Astro
// landing page, which build:deploy bundles into this deployment as
// /landing.html (assets under /_astro/, plus /robots.txt). "/?signin" bypasses
// the landing so its CTA can reach the app's sign-in screen.
export const config = {
  matcher: ["/"],
};

export default function middleware(request: Request): Response {
  const url = new URL(request.url);

  if (!url.searchParams.has("signin") && !isSignedIn(request)) {
    return rewrite(new URL("/landing.html", url));
  }

  return next();
}

// Clerk maintains a `__client_uat` cookie on the root domain; "0" means signed
// out. This is only a routing hint — real auth stays with ClerkJS and Convex.
// Keep in sync with isSignedIn in vite.config.ts.
function isSignedIn(request: Request): boolean {
  const cookies = request.headers.get("cookie") ?? "";
  const uat = cookies.match(/(?:^|;\s*)__client_uat=([^;]*)/)?.[1];
  return uat !== undefined && uat !== "" && uat !== "0";
}
