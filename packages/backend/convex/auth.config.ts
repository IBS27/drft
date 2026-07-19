// CLERK_JWT_ISSUER_DOMAIN is set on the Convex deployment
// (npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<slug>.clerk.accounts.dev)
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
