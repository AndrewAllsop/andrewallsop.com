/** Validation for the contact form payload, mirroring the client-side rules. */

export interface Submission {
  name: string;
  email: string;
  topic: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; value: Submission }
  | { ok: false; error: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_LENGTH = {
  name: 200,
  email: 320,
  topic: 120,
  message: 5000,
} as const;

const MIN_MESSAGE_LENGTH = 10;

/**
 * Anything interpolated into a mail header must not carry CR/LF, or a
 * submitter could inject extra headers.
 */
export function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function validate(payload: unknown): ValidationResult {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, error: 'Expected a JSON object.' };
  }

  const source = payload as Record<string, unknown>;

  // Honeypot: a real person never sees this field, so any value means a bot.
  if (readString(source, 'website').length > 0) {
    return { ok: false, error: 'Rejected.' };
  }

  const name = readString(source, 'name');
  const email = readString(source, 'email');
  const topic = readString(source, 'topic');
  const message = readString(source, 'message');

  if (name.length === 0) return { ok: false, error: 'A name is required.' };
  if (email.length === 0) return { ok: false, error: 'An email address is required.' };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: 'That email address is not valid.' };
  if (message.length < MIN_MESSAGE_LENGTH) {
    return { ok: false, error: `A message of at least ${MIN_MESSAGE_LENGTH} characters is required.` };
  }

  for (const [field, limit] of Object.entries(MAX_LENGTH)) {
    const value = { name, email, topic, message }[field as keyof typeof MAX_LENGTH];
    if (value.length > limit) {
      return { ok: false, error: `The ${field} field is too long (max ${limit} characters).` };
    }
  }

  return { ok: true, value: { name, email, topic, message } };
}
