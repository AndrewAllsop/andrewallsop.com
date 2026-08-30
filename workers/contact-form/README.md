# Contact form Worker

Receives JSON submissions from the contact form on andrewallsop.com and relays
them to `andrew@wunderkindagency.com` through the Resend API.

Live: `https://contact-form.andrew-d1a.workers.dev`

## Why Resend and not Email Routing

The first build used Cloudflare's native `send_email` binding. It was dropped
because Email Routing has to be enabled on the sending domain, and enabling it
rewrites that domain's MX records. Both `andrewallsop.com` and
`wunderkindagency.com` receive live Google Workspace mail, so that would have
broken inbound email. Resend sends over HTTPS and needs no MX change.

## Current sender

`FROM_ADDRESS` is `onboarding@resend.dev`, Resend's shared sender. It needs no
DNS setup but generally only delivers to the Resend account owner's address —
fine here, because `TO_ADDRESS` is fixed to your own inbox.

To send from your own domain instead, finish verifying
`updates.wunderkindagency.com` in Resend by adding these records to that zone,
then set `FROM_ADDRESS = "contact@updates.wunderkindagency.com"` and redeploy:

| Type | Name | Value |
| --- | --- | --- |
| TXT | `resend._domainkey.updates` | the DKIM `p=...` value from the Resend dashboard |
| MX | `send.updates` | `feedback-smtp.eu-west-1.amazonses.com` (priority 10) |
| TXT | `send.updates` | `v=spf1 include:amazonses.com ~all` |

These sit on the `updates.` subdomain, so root-domain Google Workspace mail is
unaffected.

## Deploy

```bash
cd workers/contact-form
npm install
npx wrangler deploy
```

The Resend API key is stored as a Worker secret, not in this repo:

```bash
npx wrangler secret put RESEND_API_KEY
```

## Configuration

`[vars]` in `wrangler.toml` — none are secrets:

| Variable | Purpose |
| --- | --- |
| `FROM_ADDRESS` | Sender. Must be a Resend-verified domain, or their shared sender. |
| `FROM_NAME` | Display name on the notification. |
| `TO_ADDRESS` | Where submissions land. |
| `ALLOWED_ORIGINS` | Comma-separated CORS origin allowlist. |

## Behaviour

`POST /` with a JSON body:

```json
{ "name": "...", "email": "...", "topic": "...", "message": "..." }
```

| Response | When |
| --- | --- |
| `200 {"ok":true}` | Accepted and sent |
| `400` | Malformed JSON, failed validation, or honeypot tripped |
| `403` | `Origin` not in `ALLOWED_ORIGINS` |
| `405` | Not POST or OPTIONS |
| `429` | More than 5 submissions from one IP in 60s |
| `500` | `RESEND_API_KEY` missing |
| `502` | Resend rejected the send (check `npm run tail`) |

`Reply-To` is set to the submitter, so replying from your inbox goes to them.

## Spam handling

Three layers: a honeypot `website` field the client never shows, the origin
allowlist, and a per-IP rate limit.

The rate limit is a Durable Object (`src/rate-limit.ts`) holding a sliding
window. Cloudflare's native `[[ratelimits]]` binding was tried first and did not
enforce anything — 20 requests against a 5/60s limit all passed — so it was
replaced rather than left in place looking like protection.

Note the origin allowlist only stops browsers; a script can send any `Origin`
header. The rate limit is what bounds direct abuse. If spam still gets through,
add a Turnstile check to the form and verify the token here.

## Local development

```bash
npm run dev      # http://127.0.0.1:8787
npm run tail     # stream logs from the deployed Worker
```

Local dev calls the real Resend API, so a successful local POST sends a real
email. Use an invalid payload to exercise the non-sending paths:

```bash
curl -X POST http://127.0.0.1:8787 \
  -H 'Origin: http://localhost:4321' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Jane","email":"jane@acme.com","topic":"Test","message":"Testing the contact form."}'
```
