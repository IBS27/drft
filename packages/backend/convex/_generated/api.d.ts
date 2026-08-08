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
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as enrichment from "../enrichment.js";
import type * as migrations from "../migrations.js";
import type * as resurfacing from "../resurfacing.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as selection from "../selection.js";
import type * as settings from "../settings.js";
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
  crons: typeof crons;
  email: typeof email;
  enrichment: typeof enrichment;
  migrations: typeof migrations;
  resurfacing: typeof resurfacing;
  search: typeof search;
  seed: typeof seed;
  selection: typeof selection;
  settings: typeof settings;
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
