import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../shared/shared.module';
import { validateReportQuery } from './validation';

export interface ReportRow {
  h: number;
  v: number;
}

export type ReportResult = { kind: 'ok'; data: ReportRow[] } | { kind: 'invalid'; error: string };

const HOURS_IN_WINDOW = 24;
const MS_PER_HOUR = 60 * 60 * 1000;

function floorToHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MS_PER_HOUR) * MS_PER_HOUR);
}

@Injectable()
export class ReportService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getReport(page: string, query: unknown): Promise<ReportResult> {
    const result = validateReportQuery(query);
    if (!result.ok) return { kind: 'invalid', error: result.error };

    const { now, order, take } = result.value;
    // Window is [floor(now) - 23h, floor(now)] - always exactly 24
    // round hours ending at "now"'s own hour, per the assignment's example.
    const end = floorToHour(now ? new Date(now) : new Date());
    const start = new Date(end.getTime() - (HOURS_IN_WINDOW - 1) * MS_PER_HOUR);

    // generate_series + LEFT JOIN zero-fills hours with no aggregated row
    // yet, in the same statement that applies ordering and the take
    // limit - so "take" is always applied after ordering, as required.
    const { rows } = await this.pool.query(
      `SELECT h.hour_bucket AS hour_bucket, COALESCE(v.views, 0) AS views
       FROM generate_series($2::timestamptz, $3::timestamptz, interval '1 hour') AS h(hour_bucket)
       LEFT JOIN page_view_hourly v ON v.page = $1 AND v.hour_bucket = h.hour_bucket
       ORDER BY h.hour_bucket ${order === 'desc' ? 'DESC' : 'ASC'}
       LIMIT $4`,
      [page, start, end, take],
    );

    const data: ReportRow[] = rows.map((row: { hour_bucket: Date; views: string }) => ({
      h: new Date(row.hour_bucket).getUTCHours(),
      v: Number(row.views),
    }));

    return { kind: 'ok', data };
  }
}
