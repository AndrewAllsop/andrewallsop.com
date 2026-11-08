type Properties = Record<string, string | number | boolean | null | undefined>;

interface PostHogLike {
  capture: (event: string, properties?: Properties) => void;
}

/**
 * Send a custom event to PostHog. Does nothing when PostHog isn't loaded
 * (no key configured, or blocked by the visitor), so callers never break.
 * Never pass names, emails or message text here.
 */
export function track(event: string, properties?: Properties): void {
  const posthog = (window as unknown as { posthog?: PostHogLike }).posthog;
  try {
    posthog?.capture(event, properties);
  } catch (error) {
    console.error('Analytics event failed', event, error);
  }
}
