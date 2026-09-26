# Coursiva — learner site

The white-label storefront and learning app every Coursiva tenant runs on their own domain: catalogue, course
pages, checkout, membership, the course player, community, certificates and account. One Next.js deployment serves
all tenants; each gets its own brand, locale, currency, content, SEO and plan features.

## Quick start

```bash
nvm use            # Node 22
npm install
npm run dev        # mock API on :8787 + Next.js on :3000
```

Open **http://amplify.localhost:3000** (the design's tenant) or **http://northwind.localhost:3000** (a second tenant:
Emerald theme, en-GB, GBP, no community/membership, white-label). `polyglot.localhost:3000` is a test tenant with
three languages (`/`, `/es`, `/ar` — Arabic is right-to-left); its Spanish/Arabic UI copy isn't translated yet. Sign in as `jordan.tate@gmail.com` / `password`.
Chrome, Edge and Firefox resolve `*.localhost` to your machine; plain `localhost:3000` serves Amplify.

Test payment cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined; coupon `LAUNCH20` takes 20% off.

## Scripts

| Command              | What it does                                                                  |
| -------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`        | Mock API + Next dev server                                                    |
| `npm run check`      | Typecheck, lint, format check, unit + API contract tests                      |
| `npm run e2e`        | Production build + Playwright: SEO, multi-tenancy, purchase/player flows, axe |
| `npm run build`      | Production build (no API needed at build time)                                |
| `npm run revalidate` | Purge cached tenant data (simulates Laravel's revalidation webhook)           |

## Docs

- [docs/architecture.md](docs/architecture.md) — multi-tenancy, rendering & caching, SEO, auth, deployment
- [docs/api/](docs/api/README.md) — the API contract the Laravel backend implements
- [docs/i18n.md](docs/i18n.md) — multi-language: URLs, hreflang, RTL, adding a language
- [CLAUDE.md](CLAUDE.md) — conventions for contributors

## Stack

Next.js 16 (App Router) · React 19 + React Compiler · TypeScript strict · next-intl · TanStack Query ·
CSS Modules on design tokens · Hono (mock API) · Vitest · Playwright + axe-core.
