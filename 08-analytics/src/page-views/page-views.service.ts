import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../shared/shared.module';
import {
  MultiViewInput,
  parseHourKey,
  SingleViewInput,
  validateMultiView,
  validateSingleView,
} from './validation';

export type RecordResult = { kind: 'recorded' } | { kind: 'invalid'; error: string };

@Injectable()
export class PageViewsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async recordSingle(body: unknown): Promise<RecordResult> {
    const result = validateSingleView(body);
    if (!result.ok) return { kind: 'invalid', error: result.error };

    await this.insertSingle(result.value);
    return { kind: 'recorded' };
  }

  async recordMulti(body: unknown): Promise<RecordResult> {
    const result = validateMultiView(body);
    if (!result.ok) return { kind: 'invalid', error: result.error };

    await this.upsertMulti(result.value);
    return { kind: 'recorded' };
  }

  // A single INSERT, no read-before-write - see docs/design.md on why raw
  // appends never contend with each other under concurrent load.
  private async insertSingle(input: SingleViewInput): Promise<void> {
    await this.pool.query('INSERT INTO page_view_raw (page, ts) VALUES ($1, $2)', [
      input.page,
      new Date(input.timestamp),
    ]);
  }

  // The payload carries deltas, not totals, so accumulation (not
  // overwrite) is required - one bulk upsert statement for the whole
  // payload regardless of how many page/hour pairs it contains.
  private async upsertMulti(input: MultiViewInput): Promise<void> {
    const values: unknown[] = [];
    const tuples: string[] = [];

    for (const [page, hours] of Object.entries(input)) {
      for (const [hourKey, views] of Object.entries(hours)) {
        const hourBucket = parseHourKey(hourKey);
        const base = values.length;
        tuples.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
        values.push(page, hourBucket, views);
      }
    }

    if (tuples.length === 0) return;

    await this.pool.query(
      `INSERT INTO page_view_hourly (page, hour_bucket, views)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (page, hour_bucket)
       DO UPDATE SET views = page_view_hourly.views + EXCLUDED.views`,
      values,
    );
  }
}
