import { z } from 'zod';

const MAX_LENGTH = 50;
const MAX_PORT = 65535;
const TEXTUAL_FIELD_PATTERN = /^[A-Za-z0-9_-]+$/;

// a-zA-Z0-9_- only, per the spec's "Textual input fields" rule - shared by
// destination.host and name.
const textualField = z.string().max(MAX_LENGTH).regex(TEXTUAL_FIELD_PATTERN);

const nodeRegistrationSchema = z.object({
  destination: z.object({
    host: textualField,
    port: z.number().int().min(0).max(MAX_PORT),
  }),
  // null and "" are equivalent to missing, per the spec.
  name: z.preprocess((value) => (value === '' || value === undefined ? null : value), textualField.nullable()).default(null),
});

export type NodeRegistrationInput = z.infer<typeof nodeRegistrationSchema>;

export type ValidationResult =
  | { ok: true; value: NodeRegistrationInput }
  | { ok: false; error: string };

export function validateNodeRegistration(body: unknown): ValidationResult {
  const result = nodeRegistrationSchema.safeParse(body);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? 'invalid request body' };
  }
  return { ok: true, value: result.data };
}
