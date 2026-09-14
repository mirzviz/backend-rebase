import { Pool } from 'pg';

const DELETE_BATCH_SIZE = 5000;

// The grace period callers are expected to subtract from "now" before
// calling runCleanupCycle, to get `cutoff` - see docs/design.md for why
// inserted_at needs this margin at all. Exported so every caller (main.ts,
// and tests) uses the same value instead of re-deriving it.
export const GRACE_PERIOD_MS = 5_000;

export interface CycleResult {
  upsertedGroups: number;
  deletedRows: number;
}

// One cleaner cycle: aggregate every page_view_raw row whose inserted_at
// is at or before `cutoff` into page_view_hourly, then delete those same
// raw rows in batches. See ../../docs/design.md for why the boundary is
// inserted_at (not id/MAX(id)), and why a crash between the two steps
// below is an accepted, documented limitation rather than something this
// function guards against - fixing that would need a transaction
// spanning both statements, which the assignment disallows.
export async function runCleanupCycle(pool: Pool, cutoff: Date): Promise<CycleResult> {
  const upsertResult = await pool.query(
    `INSERT INTO page_view_hourly (page, hour_bucket, views)
     SELECT page, date_trunc('hour', ts) AS hour_bucket, count(*) AS views
     FROM page_view_raw
     WHERE inserted_at <= $1
     GROUP BY page, date_trunc('hour', ts)
     ON CONFLICT (page, hour_bucket)
     DO UPDATE SET views = page_view_hourly.views + EXCLUDED.views`,
    [cutoff],
  );

  let deletedRows = 0;
  for (;;) {
    const { rowCount } = await pool.query(
      `DELETE FROM page_view_raw
       WHERE id IN (
         SELECT id FROM page_view_raw WHERE inserted_at <= $1 LIMIT $2
       )`,
      [cutoff, DELETE_BATCH_SIZE],
    );
    const count = rowCount ?? 0;
    deletedRows += count;
    if (count === 0) break;
  }

  return { upsertedGroups: upsertResult.rowCount ?? 0, deletedRows };
}
