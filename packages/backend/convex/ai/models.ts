import { createOpenAI } from "@ai-sdk/openai";

// The Convex runtime provides process.env; declared here so this file
// also typechecks inside the web app's program (no node types there).
declare const process: { env: Record<string, string | undefined> };

// Model routing for embedding-backed enrichment lives here so provider and
// model changes stay out of business logic.
export const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dims, pinned by the vector indexes

export function openaiProvider() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set on the Convex deployment (npx convex env set OPENAI_API_KEY ...)",
    );
  }
  return createOpenAI({ apiKey });
}
