/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai_limits from "../ai/limits.js";
import type * as ai_models from "../ai/models.js";
import type * as ai_prompts from "../ai/prompts.js";
import type * as enrichment from "../enrichment.js";
import type * as partner from "../partner.js";
import type * as seed from "../seed.js";
import type * as store from "../store.js";
import type * as thoughts from "../thoughts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "ai/limits": typeof ai_limits;
  "ai/models": typeof ai_models;
  "ai/prompts": typeof ai_prompts;
  enrichment: typeof enrichment;
  partner: typeof partner;
  seed: typeof seed;
  store: typeof store;
  thoughts: typeof thoughts;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
