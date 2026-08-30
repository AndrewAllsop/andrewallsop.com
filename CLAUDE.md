# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev        # Start dev server at localhost:4321
npm run build      # Production build to ./dist/
npm run preview    # Preview production build locally
```

No test runner or linter is configured.

## Architecture

**Framework:** Astro 5 with TypeScript (strict) and Tailwind CSS 4. Pure static site — no client-side JS frameworks (React, Vue, etc.). All components are `.astro` files with server-side rendering.

**Routing:** File-based via `src/pages/`. Blog posts use dynamic routes (`[...slug].astro`) with `getStaticPaths()`.

**Content:** Astro Content Collections for blog posts. Markdown files live in `src/content/blog/` with a Zod schema defined in `src/content.config.ts` (title, description, pubDate required; draft, tags, image, updatedDate optional). Draft posts are filtered out in listing pages.

**Layouts:** `BaseLayout.astro` wraps all pages (meta tags, header, footer, analytics). `BlogPost.astro` extends it for blog content with prose styling.

**Styling:** Tailwind via `@tailwindcss/vite` plugin. Custom theme (Inter font) defined in `src/styles/global.css` using `@theme`. Dark mode uses class-based toggle with localStorage persistence and system preference fallback. Custom prose styles for blog content are in global.css.

**Theme toggle:** Inline script in BaseLayout runs before render to prevent FOUC. Reads localStorage first, then system preference.

## External Integrations

- **Deployment:** Vercel (synced via GitHub)
- **Newsletter:** ConvertKit v3 API — form ID 9061075, client-side submission in Hero.astro
- **Contact form:** Cloudflare Worker in `workers/contact-form/` relays submissions via Resend to andrew@wunderkindagency.com. ContactForm.astro posts to the Worker by default; `PUBLIC_CONTACT_ENDPOINT` overrides it, and setting it empty falls back to a `mailto:` compose
- **Analytics:** Google Analytics 4 (GA-LNZJEMMDTN) in BaseLayout
- **AI crawlers:** `public/llms.txt` describes site purpose

## Key Files

- `src/content.config.ts` — Blog collection schema
- `src/styles/global.css` — Tailwind imports, theme config, prose overrides
- `astro.config.mjs` — Site URL and Vite/Tailwind plugin setup
- `src/layouts/BaseLayout.astro` — Shared layout with theme logic and analytics
