import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// Three things moved in one release: embeddings off the thought
// (`thoughtEmbeddings`), an owner onto every connection, and
// `lastReturnedAt` onto every returned thought. New writes use the new
// shapes from the first moment; rows written before need
// migrations:backfillFastPaths to carry them over. Until it has, a reader
// cannot assume the new shape is complete — so each one asks here and
// keeps to the old path until its backfill is marked finished.
//
// A deployment that never runs the backfill stays correct, only slower.
// The follow-up that drops `thoughts.embedding` deletes this file, the
// `migrationState` table, and every branch that calls `migrated`.

export type Migration = Doc<"migrationState">["name"];

export async function migrated(
  ctx: QueryCtx,
  name: Migration,
): Promise<boolean> {
  const row = await ctx.db
    .query("migrationState")
    .withIndex("by_name", (q) => q.eq("name", name))
    .first();
  return row !== null;
}

export async function markMigrated(ctx: MutationCtx, name: Migration) {
  if (!(await migrated(ctx, name)))
    await ctx.db.insert("migrationState", { name, doneAt: Date.now() });
}
