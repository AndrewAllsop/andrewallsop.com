/**
 * Newsletter signup relayed to ConvertKit.
 *
 * The form used to call ConvertKit straight from the browser, which put the
 * API key in the page source and left the endpoint open to bots. Going through
 * the Worker keeps the key server-side and puts the signup behind the same
 * honeypot, origin allowlist and rate limit as the contact form.
 */

import { isValidEmail, readField } from './validate';

const CONVERTKIT_API = 'https://api.convertkit.com/v3/forms';

export type SubscriptionCheck =
  | { ok: true; email: string }
  | { ok: false; error: string };

export function validateSubscription(payload: unknown): SubscriptionCheck {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, error: 'Expected a JSON object.' };
  }

  const source = payload as Record<string, unknown>;

  // Honeypot: a real person never sees this field, so any value means a bot.
  if (readField(source, 'website').length > 0) {
    return { ok: false, error: 'Rejected.' };
  }

  const email = readField(source, 'email');
  if (email.length === 0) return { ok: false, error: 'An email address is required.' };
  if (!isValidEmail(email)) return { ok: false, error: 'That email address is not valid.' };

  return { ok: true, email };
}

export async function subscribe(apiKey: string, formId: string, email: string): Promise<void> {
  const response = await fetch(`${CONVERTKIT_API}/${formId}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, email }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`ConvertKit responded ${response.status}: ${detail.slice(0, 300)}`);
  }
}
