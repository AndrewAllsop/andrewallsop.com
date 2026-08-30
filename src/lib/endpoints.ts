/**
 * Cloudflare Worker that backs the site's forms.
 * Source lives in workers/contact-form/.
 */
const DEFAULT_FORMS_ENDPOINT = 'https://contact-form.andrew-d1a.workers.dev';

/** Override with PUBLIC_CONTACT_ENDPOINT; empty makes the contact form use mailto:. */
export const FORMS_ENDPOINT =
  import.meta.env.PUBLIC_CONTACT_ENDPOINT ?? DEFAULT_FORMS_ENDPOINT;

export const NEWSLETTER_ENDPOINT = `${DEFAULT_FORMS_ENDPOINT}/subscribe`;
