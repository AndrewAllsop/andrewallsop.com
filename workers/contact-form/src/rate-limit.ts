/**
 * Per-IP rate limiter backed by a Durable Object.
 *
 * Cloudflare's native rate limiting binding was tried first and did not
 * enforce anything (20 requests against a 5/60s limit all passed), so this
 * keeps a real sliding window instead. One object per client IP.
 */

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_MS = 60_000;

export class RateLimiter {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get('limit')) || DEFAULT_LIMIT;
    const windowMs = Number(params.get('window')) || DEFAULT_WINDOW_MS;
    const now = Date.now();

    const hits = (await this.state.storage.get<number[]>('hits')) ?? [];
    const recent = hits.filter((at) => now - at < windowMs);

    if (recent.length >= limit) {
      return Response.json({ success: false });
    }

    recent.push(now);
    await this.state.storage.put('hits', recent);
    // Self-clean once the window lapses so idle objects hold nothing.
    await this.state.storage.setAlarm(now + windowMs);

    return Response.json({ success: true });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

export async function withinRateLimit(
  namespace: DurableObjectNamespace,
  clientIp: string
): Promise<boolean> {
  const stub = namespace.get(namespace.idFromName(clientIp));
  const response = await stub.fetch(
    `https://rate-limit/?limit=${DEFAULT_LIMIT}&window=${DEFAULT_WINDOW_MS}`
  );
  const { success } = await response.json<{ success: boolean }>();
  return success;
}
