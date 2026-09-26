# Architecture — learner site

The learner site is every tenant's white-label storefront and learning app, served by **one Next.js deployment** for
all tenants. It never shows Coursiva branding unless the tenant's plan does (the "Powered by" credit).

```
Browser ──► CDN (keys on Host) ──► Next.js ──┬─► proxy.ts  (host → tenant, canonical redirect, /api forward, auth gate)
                                              ├─► app/[tenant]/…  (Server Components, ISR)  ──► Laravel API (service token)
                                              └─► /api/*, /sanctum/*  (streamed through) ─────► Laravel API (session cookie)
```

## 1. Multi-tenancy

- **Resolution** — `src/proxy.ts` reads only the `Host` header (never `X-Forwarded-Host`, which a client could spoof
  to poison a CDN) and resolves it via `GET /platform/v1/domains/resolve` (memoised 60 s). `<slug>.<root>` subdomains
  and verified custom domains both work. Unknown → 404; suspended → 503.
- **Canonical host** — every other host of a tenant 308s to `primary_host` (e.g. subdomain → custom domain).
- **Routing** — the request is rewritten to `/<slug>/<locale>/<path>`; `app/[tenant]/[locale]/layout.tsx` is the root
  layout. `next/root-params` gives any Server Component the tenant and locale (`currentScope()`) without prop
  drilling. Tenant-level files (`sitemap.xml`, `robots.txt`, `icon.png`) live in `app/[tenant]/`. Internal
  `/<slug>/…` URLs are not reachable directly (they'd be double-prefixed → 404), so there are no duplicate URLs.
- **Theme** — `lib/theme.ts` derives all brand colours from the tenant's hue/chroma and the root layout inlines them
  as CSS variables: first paint is on-brand, zero client JS, no flash.
- **Languages** — each tenant publishes one or more (`site.locales`); the default is unprefixed, others live under
  `/<lang>/…` with hreflang alternates, and the proxy rewrites to `/{tenant}/{locale}/…`. UI copy via next-intl
  (`messages/<lang>.json`, English fallback), tenant content via `?locale=` on API reads, `dir="rtl"` automatic,
  CSS on logical properties. See [i18n.md](i18n.md). Currency is per tenant (`site.currency`).
- **Entitlements** — `site.features` hides UI (nav, sections, pages → 404); the API enforces the same rules.

## 2. Rendering & caching (SEO)

| Surface                                                                 | Rendering                                       | Indexed                           |
| ----------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------- |
| Home, catalogue, course, membership, help, legal                        | Server Components, **ISR on demand** per tenant | yes                               |
| Personal bits on public pages (cart count, enrolled badges, "Continue") | client, after hydration (TanStack Query)        | —                                 |
| Learning, player, community, account, cart, checkout, orders            | static shell + client data                      | no (`noindex`, robots-disallowed) |
| sitemap.xml, robots.txt, icon.png, og.png                               | route handlers, CDN-cached (`Cache-Control`)    | —                                 |

- **Why the previous caching model, not Cache Components:** with `cacheComponents`, root params need build-time
  values — i.e. the tenant list at build. Tenants sign up at runtime, so every tenant route uses
  `generateStaticParams() => []` (render on first request, then cache). Builds never call the API.
- **Data Cache tags** (`lib/api/server.ts`): `t:<slug>`, `t:<slug>:site`, `…:catalog`, `…:course:<slug>`,
  `…:page:<slug>`, `…:membership`, `…:content`. Laravel calls `POST /hooks/revalidate` (HMAC-signed) with the tags
  that changed; `revalidateTag(tag, 'max')` serves stale while regenerating. One-hour safety expiry.
- **Public pages never read cookies**, which is what keeps them cacheable. Personalisation happens in the browser.
- **SEO surface**: per-page `generateMetadata` (title template, description, canonical, Open Graph, Twitter),
  JSON-LD (`EducationalOrganization`, `WebSite` + SearchAction, `Course` + `Offer` + `AggregateRating` + reviews,
  `ItemList`, `BreadcrumbList`, `FAQPage`), per-tenant `sitemap.xml`/`robots.txt`, generated favicons and course share
  images in the tenant's brand, `X-Robots-Tag: noindex` for non-indexable tenants and `NOINDEX_HOSTS` (staging).
  Course tab content (curriculum, reviews) is in the HTML; tabs only toggle visibility.
- **Core Web Vitals**: self-hosted fonts via `next/font` (no layout shift), `next/image` for CDN covers, React
  Compiler, no client JS on marketing sections except small islands (newsletter, tabs, buy box).

## 3. Auth (Backend-for-Frontend)

Sanctum SPA cookies only work first-party. A tenant on `learn.acme.com` calling `api.coursiva.app` would be
cross-site, so **the browser only ever calls its own host**: the proxy streams `/api/*` and `/sanctum/*` to Laravel,
adding `X-Tenant`/`X-Forwarded-Host` and dropping any browser `Authorization` header. Session and XSRF cookies stay
first-party on each tenant domain. Server Components use a separate service token and never see learner cookies.

Private pages are gated optimistically in the proxy (session cookie present?); the API is the real gate. After
sign-in/out the site does a full navigation, so no prefetched guest response survives the auth change.

## 4. Code layout

```
src/
  proxy.ts                 tenant resolution, canonical host, API forwarding, auth gate
  app/[tenant]/…           routes (thin: fetch + metadata + JSON-LD, then a feature view)
  app/hooks/               host-agnostic endpoints: revalidate (webhook), health
  features/<feature>/
    types.ts               API contract (resource shapes)
    server.ts              cached server reads (server-only)
    api.ts                 client hooks (TanStack Query) — the only browser→API callers
    components/            feature UI (+ CSS Modules)
  components/              layout (header, footer, drawer, tab bar), toast, icons, JsonLd
  lib/                     api clients, case conversion, formatting, routes, SEO builders, theme
  i18n/                    next-intl request config (tenant locale via root params)
  styles/                  tokens, base, shared primitives
messages/en.json           UI copy (tenant content comes from the API)
mock-api/                  Laravel stand-in (Hono) — the executable API contract
```

## 5. Payments

Card entry is Stripe's Payment Element in production (PCI SAQ-A: card data never touches our servers, state or
logs). `features/commerce/payments.ts` is the boundary; in development it validates the design's mock card fields
and returns Stripe test tokens. PayPal, Klarna and Afterpay are hosted redirects started by the API. Every price on
the checkout comes from `POST /checkout/quote`.

## 6. Video

HLS + CENC from the platform pipeline, signed CDN URLs, multi-DRM (Widevine/FairPlay). Play with Shaka Player,
dynamically imported so it never ships to pages without video. Captions are mandatory. The mock has no media.

## 7. Deployment

- Node runtime (`next start`, Docker) behind a CDN that **keys on Host** and preserves it upstream. Cloudflare for SaaS
  (custom hostnames + automatic TLS) fits the platform's R2/CDN setup; Vercel's domains API is the managed alternative.
- For more than one Next.js instance, configure a shared cache handler (Redis) so ISR and `revalidateTag` are
  consistent across instances.
- Env (server-only): `API_URL`, `API_SERVICE_TOKEN`, `PLATFORM_ROOT_DOMAIN`, `REVALIDATE_SECRET`, `NOINDEX_HOSTS`.
  Health check: `GET /hooks/health`.
- Security headers in `next.config.ts` (HSTS, nosniff, referrer policy, permissions policy, frame-ancestors). A
  nonce-based CSP would make every page dynamic; add a hash-based `script-src` once third-party scripts are settled.
