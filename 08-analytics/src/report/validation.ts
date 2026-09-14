import { z } from 'zod';

const MIN_TAKE = 1;
const MAX_TAKE = 24;

function clampTake(value: number): number {
  if (Number.isNaN(value)) return MAX_TAKE;
  return Math.min(MAX_TAKE, Math.max(MIN_TAKE, Math.trunc(value)));
}

const reportQuerySchema = z.object({
  now: z
    .string()
    .optional()
    .refine((value) => value === undefined || !Number.isNaN(Date.parse(value)), {
      message: 'now must be a valid date-time string',
    }),
  order: z.enum(['asc', 'desc']).default('asc'),
  // Out-of-range/garbage values clamp to the nearest valid bound rather
  // than reject the request - the assignment describes take as "display
  // only the first k elements", not a strict validation rule.
  take: z.coerce.number().default(MAX_TAKE).transform(clampTake),
});

export type ReportQueryInput = z.infer<typeof reportQuerySchema>;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateReportQuery(query: unknown): ValidationResult<ReportQueryInput> {
  const result = reportQuerySchema.safeParse(query);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? 'invalid query parameters' };
  }
  return { ok: true, value: result.data };
}
