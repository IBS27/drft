import { next, rewrite } from "@vercel/edge";

// One domain, two surfaces (Vercel Edge Middleware — production glue only, no
// effect on local dev): signed-out visitors on "/" get the Astro landing page
// (apps/landing, its own Vercel project); everything else is the app. "/?signin"
// bypasses the landing so its CTA can reach the app's sign-in screen.
const LANDING_ORIGIN = process.env.LANDING_ORIGIN ?? "https://drft-landing.vercel.app";

// Build assets and crawler files served by the landing project.
const LANDING_PATHS = /^\/(_astro\/|robots\.txt$|sitemap)/;

export default function middleware(request: Request): Response {
  const url = new URL(request.url);

  if (LANDING_PATHS.test(url.pathname)) {
    return rewrite(new URL(url.pathname + url.search, LANDING_ORIGIN));
  }

  if (url.pathname === "/" && !url.searchParams.has("signin") && !isSignedIn(request)) {
    return rewrite(new URL("/", LANDING_ORIGIN));
  }

  return next();
}

// Clerk maintains a `__client_uat` cookie on the root domain; "0" means signed
// out. This is only a routing hint — real auth stays with ClerkJS and Convex.
function isSignedIn(request: Request): boolean {
  const cookies = request.headers.get("cookie") ?? "";
  const uat = cookies.match(/(?:^|;\s*)__client_uat=([^;]*)/)?.[1];
  return uat !== undefined && uat !== "" && uat !== "0";
}
