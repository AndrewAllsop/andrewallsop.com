/** Server-side check of a Cloudflare Turnstile token from the contact form. */

const SITEVERIFY_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Turnstile tokens are at most 2048 characters; anything longer is not one. */
const MAX_TOKEN_LENGTH = 2048;

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Returns true only when Cloudflare confirms the token. A missing token, a
 * reused or expired one, or a failed call to Cloudflare all count as false.
 */
export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null
): Promise<boolean> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return false;

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (remoteIp) body.append('remoteip', remoteIp);

  try {
    const response = await fetch(SITEVERIFY_ENDPOINT, { method: 'POST', body });
    const result = (await response.json()) as SiteverifyResponse;
    if (!result.success) {
      console.warn('Turnstile rejected a submission', result['error-codes'] ?? []);
    }
    return result.success === true;
  } catch (error) {
    console.error('Turnstile verification failed', error);
    return false;
  }
}
