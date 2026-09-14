import { z } from 'zod';

// "YYYY-MM-DD_HH:00" - always a round hour, per the assignment's example
// payload. Parsed as UTC (no timezone is carried in the key itself).
const HOUR_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{2}):00$/;

export function parseHourKey(key: string): Date | null {
  const match = HOUR_KEY_PATTERN.exec(key);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const hourKey = z.string().refine((key) => parseHourKey(key) !== null, {
  message: 'hour key must look like "YYYY-MM-DD_HH:00"',
});

const singleViewSchema = z.object({
  page: z.string().min(1),
  timestamp: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'timestamp must be a valid date-time string',
  }),
});

export type SingleViewInput = z.infer<typeof singleViewSchema>;

const multiViewSchema = z.record(
  z.string().min(1),
  z.record(hourKey, z.number().int().nonnegative()),
);

export type MultiViewInput = z.infer<typeof multiViewSchema>;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateSingleView(body: unknown): ValidationResult<SingleViewInput> {
  const result = singleViewSchema.safeParse(body);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? 'invalid request body' };
  }
  return { ok: true, value: result.data };
}

export function validateMultiView(body: unknown): ValidationResult<MultiViewInput> {
  const result = multiViewSchema.safeParse(body);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? 'invalid request body' };
  }
  return { ok: true, value: result.data };
}
