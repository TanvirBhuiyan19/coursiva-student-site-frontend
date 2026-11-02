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
  `…:pages`, `…:membership`, `…:content`, `…:blog`. Laravel calls `POST /hooks/revalidate` (HMAC-signed) with the tags
  that changed; `revalidateTag(tag, { expire: 0 })` expires them at once, so the next request renders fresh content (no
  stale page after a publish). One-hour safety expiry.
- **Site builder**: the school's pages (`/` and the `[...slug]` catch-all, which never shadows a built-in route),
  header, footer, theme tokens (`data-*` on `<html>` → `styles/tokens.css`), announcement, favicon and head code come
  from `GET /site` and `GET /pages/{slug}` ([api/pages.md](api/pages.md)). Password and members-only pages render
  their gate in the cached HTML and load in the browser with the visitor's cookies.
- **Personal rendering** (previews, unlocked private sites): `/__site` turns on Draft Mode for that browser only; its
  requests bypass the caches and server reads forward its cookies and preview token (`lib/api/personal.ts`). A locked
  site serves everyone else a static lock screen.
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
cross-site, so **the browser only ever calls its own host**: the proxy streams `/api/*` and `/sanctum/*` (and SMS short
links `/l/{code}` → `/api/v1/l/{code}`, no locale rewrite) to Laravel, adding `X-Tenant`/`X-Forwarded-Host` and dropping any browser `Authorization` header. Session and XSRF cookies stay
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

Card entry is Stripe's Payment Element (PCI SAQ-A: card data never touches our servers, state or logs), mounted on
the school's connected account with the publishable key from the quote (`Quote.payment`). It creates a
ConfirmationToken that `POST /checkout` confirms server-side; 3-D Secure comes back as `next_action` and runs with
`stripe.handleNextAction`, then the order is read until the webhook marks it paid. `features/commerce/payments.ts` is
the boundary (`components/PaymentFields.tsx` renders the Element, or a test-card picker with Laravel's fake gateway
and the mock — there are no card fields anywhere). Wallets come inside the Element; PayPal and pay-later only appear
when the gateway can take them (`Quote.payment.methods`). Free orders skip payment; free courses enrol in one click
without checkout. Every price on the checkout comes from `POST /checkout/quote`.

## 6. Video

Signed Mux HLS (4 h tokens), optional Mux DRM (Widevine / FairPlay / PlayReady licence URLs → Shaka's `drm` config),
a signed source-file fallback and third-party embeds. Play with Shaka Player (`shaka-player` HLS build), dynamically
imported so it never ships to pages without video. Captions are mandatory. The school's dynamic watermark is drawn by
the player over the video, inside the fullscreen container. The mock has no media.

Other lesson kinds load their code on demand too (`next/dynamic`): the SCORM/xAPI player (`window.API` /
`API_1484_11` adapters), the assignment and peer-review views, and the AI tutor panel. See
[api/learning.md](api/learning.md).

## 7. Deployment

- Node runtime (`next start`, Docker) behind a CDN that **keys on Host** and preserves it upstream. Cloudflare for SaaS
  (custom hostnames + automatic TLS) fits the platform's R2/CDN setup; Vercel's domains API is the managed alternative.
- **Run a single Node instance** (scale it vertically). ISR pages and `revalidateTag` live in that process's cache:
  Laravel's `/hooks/revalidate` call reaches one instance, so a second instance would keep serving stale pages. More
  than one instance needs a shared cache handler (Redis `cacheHandler` in `next.config.ts`) first — not configured.
- The API must trust this server as a proxy (Laravel `TRUSTED_PROXIES` = this server's IP, or the private network
  it calls from): the BFF forwards the learner's `X-Forwarded-For` and `X-Forwarded-Host`, and Laravel resolves the
  school from the forwarded host and rate-limits by the forwarded IP. See backend `docs/production.md` → Proxies.
- Env (server-only, see `.env.example`):

  | Variable               | Production value                                                                                |
  | ---------------------- | ----------------------------------------------------------------------------------------------- |
  | `API_URL`              | Laravel's origin as seen from this server (private URL is fine)                                 |
  | `API_SERVICE_TOKEN`    | plaintext of the API's `STUDENT_SITE_SERVICE_TOKEN` (the API keeps its `sha256:` hash)          |
  | `API_RESOLVE_PATH`     | default `/api/v1/internal/domains/resolve` (the mock uses `/platform/v1/...`)                   |
  | `SESSION_COOKIE`       | default `coursiva_learner_session` (Laravel's learner cookie; the mock uses `coursiva_session`) |
  | `PLATFORM_ROOT_DOMAIN` | = the API's `PLATFORM_TENANT_ROOT_DOMAIN` (`example.com` → `<school>.example.com`)              |
  | `REVALIDATE_SECRET`    | = the API's `REVALIDATE_SECRET`; the API's `STUDENT_SITE_REVALIDATE_URL` points here            |
  | `NOINDEX_HOSTS`        | staging/preview hosts, e.g. `*.preview.example.com`                                             |

  Health check: `GET /hooks/health`.

- Security headers in `src/lib/securityHeaders.ts`, applied by `next.config.ts` (HSTS, nosniff, referrer policy,
  permissions policy, `frame-ancestors 'none'` + `X-Frame-Options: DENY` on pages, `'self'` on proxied API content for
  SCORM). The staff preview (`/preview/*`) may be framed only by `DASHBOARD_ORIGIN` — the proxy sets that policy (plus
  `no-referrer`, noindex). A nonce-based CSP would make every page dynamic; add a hash-based `script-src` once
  third-party scripts are settled.
