import { createOpenAI } from "@ai-sdk/openai";

// The Convex runtime provides process.env; declared here so this file
// also typechecks inside the web app's program (no node types there).
declare const process: { env: Record<string, string | undefined> };

// All model routing in one place — tuning the partner never touches
// business logic. Sessions get the top tier; background work the cheap one.
// (Behavioral caps/thresholds live in ./limits.ts, importable everywhere.)
export const SESSION_MODEL = "gpt-5.6-sol";
export const QUESTION_MODEL = "gpt-5.6-luna";
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
