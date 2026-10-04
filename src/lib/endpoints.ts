/**
 * Cloudflare Worker that backs the site's forms.
 * Source lives in workers/contact-form/.
 */
const DEFAULT_FORMS_ENDPOINT = 'https://contact-form.andrew-d1a.workers.dev';

/** Override with PUBLIC_CONTACT_ENDPOINT; empty makes the contact form use mailto:. */
export const FORMS_ENDPOINT =
  import.meta.env.PUBLIC_CONTACT_ENDPOINT ?? DEFAULT_FORMS_ENDPOINT;

export const NEWSLETTER_ENDPOINT = `${DEFAULT_FORMS_ENDPOINT}/subscribe`;

/**
 * Public site key for the invisible Cloudflare Turnstile widget on the contact
 * form. The matching secret lives only in the Worker (TURNSTILE_SECRET_KEY).
 */
const DEFAULT_TURNSTILE_SITE_KEY = '0x4AAAAAAFNTDCmLsp3N1yt_';

/** Override with PUBLIC_TURNSTILE_SITE_KEY, e.g. Cloudflare's test keys locally. */
export const TURNSTILE_SITE_KEY =
  import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? DEFAULT_TURNSTILE_SITE_KEY;
