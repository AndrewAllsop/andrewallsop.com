/**
 * Form endpoints for andrewallsop.com.
 *
 *   POST /           contact form  -> email via Resend
 *   POST /subscribe  newsletter    -> ConvertKit
 *
 * Both routes share the origin allowlist, per-IP rate limit and honeypot.
 */

import { corsHeaders, isAllowedOrigin, parseAllowedOrigins } from './cors';
import { sendSubmission } from './email';
import { RateLimiter, withinRateLimit } from './rate-limit';
import { subscribe, validateSubscription } from './subscribe';
import { validate } from './validate';

export interface Env {
  /** Set with `wrangler secret put RESEND_API_KEY` — never in wrangler.toml. */
  RESEND_API_KEY: string;
  /** Set with `wrangler secret put CONVERTKIT_API_KEY`. */
  CONVERTKIT_API_KEY: string;
  CONVERTKIT_FORM_ID: string;
  RATE_LIMITER?: DurableObjectNamespace;
  FROM_ADDRESS: string;
  FROM_NAME: string;
  TO_ADDRESS: string;
  ALLOWED_ORIGINS: string;
}

type Headers_ = Record<string, string>;

function json(body: unknown, status: number, headers: Headers_): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

async function handleContact(payload: unknown, env: Env, headers: Headers_): Promise<Response> {
  const result = validate(payload);
  if (!result.ok) {
    return json({ error: result.error }, 400, headers);
  }

  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set');
    return json({ error: 'Could not send the message.' }, 500, headers);
  }

  try {
    await sendSubmission(
      {
        apiKey: env.RESEND_API_KEY,
        fromAddress: env.FROM_ADDRESS,
        fromName: env.FROM_NAME,
        toAddress: env.TO_ADDRESS,
      },
      result.value
    );
  } catch (error) {
    // Detail stays in the Worker log; the caller gets a generic failure.
    console.error('Failed to send contact email', error);
    return json({ error: 'Could not send the message.' }, 502, headers);
  }

  return json({ ok: true }, 200, headers);
}

async function handleSubscribe(payload: unknown, env: Env, headers: Headers_): Promise<Response> {
  const result = validateSubscription(payload);
  if (!result.ok) {
    return json({ error: result.error }, 400, headers);
  }

  if (!env.CONVERTKIT_API_KEY || !env.CONVERTKIT_FORM_ID) {
    console.error('ConvertKit configuration is missing');
    return json({ error: 'Could not subscribe.' }, 500, headers);
  }

  try {
    await subscribe(env.CONVERTKIT_API_KEY, env.CONVERTKIT_FORM_ID, result.email);
  } catch (error) {
    console.error('Failed to subscribe', error);
    return json({ error: 'Could not subscribe.' }, 502, headers);
  }

  return json({ ok: true }, 200, headers);
}

export { RateLimiter };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const origin = request.headers.get('Origin');
    const headers = corsHeaders(origin, allowed);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405, { ...headers, Allow: 'POST, OPTIONS' });
    }

    if (!isAllowedOrigin(origin, allowed)) {
      return json({ error: 'Origin not allowed.' }, 403, headers);
    }

    // One object per client IP; the binding is optional so local dev still works.
    if (env.RATE_LIMITER) {
      const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      if (!(await withinRateLimit(env.RATE_LIMITER, clientIp))) {
        return json({ error: 'Too many requests. Please try again shortly.' }, 429, headers);
      }
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400, headers);
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, '');

    return path === '/subscribe'
      ? handleSubscribe(payload, env, headers)
      : handleContact(payload, env, headers);
  },
};
