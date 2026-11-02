# Learner-site API contract

This is what the Laravel backend must implement for the learner site (`student-site`). The **executable** version of
this contract is the mock API in `mock-api/` plus its tests in `mock-api/app.test.ts` — if this document and the
tests disagree, the tests win. Resource shapes are the TypeScript types in `src/features/<feature>/types.ts`.

| Feature                          | Doc                                                  | Types                               |
| -------------------------------- | ---------------------------------------------------- | ----------------------------------- |
| Tenant resolution & site config  | [tenant.md](tenant.md)                               | `src/features/tenant/types.ts`      |
| Catalogue                        | [catalog.md](catalog.md)                             | `src/features/catalog/types.ts`     |
| Instructor profiles              | [instructors.md](instructors.md)                     | `src/features/instructors/types.ts` |
| Site-builder pages               | [pages.md](pages.md)                                 | `src/features/pages/types.ts`       |
| Lead forms & embeds              | [forms.md](forms.md)                                 | `src/features/forms/types.ts`       |
| Membership plans                 | [membership.md](membership.md)                       | `src/features/membership/types.ts`  |
| Auth (Sanctum SPA)               | [auth.md](auth.md)                                   | `src/features/auth/types.ts`        |
| Learning, player, quizzes        | [learning.md](learning.md)                           | `src/features/learning/types.ts`    |
| Cart, wishlist, checkout, orders | [commerce.md](commerce.md)                           | `src/features/commerce/types.ts`    |
| Service products & 1:1 bookings  | [commerce.md](commerce.md), [account.md](account.md) | `src/features/bookings/types.ts`    |
| Community                        | [community.md](community.md)                         | `src/features/community/types.ts`   |
| Profile, certificates, support   | [account.md](account.md)                             | `src/features/account/types.ts`     |

## Conventions

- **Base path** `/api/v1`. JSON only. `snake_case` keys on the wire; the site converts to camelCase in
  `src/lib/api/case.ts`. **Never use data values as object keys** — they'd be case-converted. Use arrays.
- **Envelope**: single resources `{ "data": … }`; lists that paginate `{ "data": [...], "meta": { current_page, last_page, per_page, total } }`.
- **Money** is always `{ "amount": <minor units, integer>, "currency": "USD" }`. The client never adds up prices:
  every total (cart, checkout, invoice, instalments, VAT) comes from the API.
- **Times** are ISO 8601 UTC strings.
- **Errors** (Laravel defaults):
  - `401 { message }` unauthenticated · `403 { message }` forbidden (message is shown to the learner)
  - `404 { message }` not found · `419` CSRF token mismatch (client refreshes the token and retries once)
  - `422 { message, errors: { field: [msg] } }` validation — `errors` keys are the request's snake_case field names;
    the first message per field is shown inline.
- **Copy in error messages is user-facing** and should be written for learners (see the mock for tone).

## Languages

Content endpoints accept `?locale=<BCP 47>` (server reads) and `Accept-Language` (browser calls) and return tenant
content in that language, falling back to the tenant default for untranslated fields. Slugs are the same in every
language. Validation messages should honour `Accept-Language` too. Details: [../i18n.md](../i18n.md).

## Tenancy

Every tenant-scoped request identifies the tenant; every query is scoped to it (row-level isolation):

| Caller                             | How the tenant is identified                                               |
| ---------------------------------- | -------------------------------------------------------------------------- |
| Next.js server (Server Components) | `X-Tenant: <slug>` + `Authorization: Bearer <API_SERVICE_TOKEN>`           |
| Browser (via the Next.js proxy)    | `X-Tenant: <slug>` and `X-Forwarded-Host: <tenant host>`, set by the proxy |

The proxy strips any browser-sent `Authorization` header. Laravel should trust `X-Tenant` only from the Next.js
servers (network policy / trusted proxies) and must reject a session cookie that belongs to a different tenant.

Plan entitlements (`site.features`) are enforced by the API: e.g. `GET /community` is `404` for tenants without
community, `GET /membership` is `404` without memberships.

## Server-side page views (analytics)

The site counts traffic **on its server**, not in the browser: no tracking script, no analytics cookie, nothing for
ad blockers to drop and nothing to consent to. For every page it serves, the proxy (`src/proxy.ts`, helpers in
`src/features/analytics/pageviews.ts`) reports the view in the background:

```http
POST {API_URL}/api/v1/analytics/pageviews
Authorization: Bearer <API_SERVICE_TOKEN>
X-Tenant: <slug>
Content-Type: application/json

{
  "path": "/checkout?course=the-funnel-blueprint&utm_campaign=spring",
  "visitor_ip": "203.0.113.7",
  "user_agent": "Mozilla/5.0 …",
  "referrer": "https://www.google.com/"
}
```

- **`204`** whenever authorised — an uncounted view (a bot, a path it doesn't classify) is not an error. `401` without
  the service token, `404` for an unknown tenant, `422` for a bad body (`path` must start with `/`, ≤ 2000 chars;
  `visitor_ip` must be an IP; `user_agent` ≤ 500 chars — the site trims it; `referrer` optional, ≤ 2000 chars).
- **What is a page view**: a `GET` that is a document navigation (`Sec-Fetch-Dest: document`, or `Accept` containing
  `text/html` when there are no `Sec-Fetch-*` headers) or an App Router client navigation (`RSC: 1`), **never a
  prefetch** (`Next-Router-Prefetch`, `Next-Router-Segment-Prefetch`, `Purpose`/`Sec-Purpose: prefetch|prerender`).
  Never `/api/*`, `/sanctum/*`, `/_next/*`, `/hooks/*`, tenant files (`/sitemap.xml`, `/robots.txt`, `/icon.png`),
  paths with a file extension, or requests the proxy redirects (canonical host, `/en/…`, guests sent to sign-in).
  Client navigations served from the router cache (back/forward, a recently visited static page) make no request and
  are not counted; `router.refresh()` is.
- **`path`** is the locale-less app path plus its query (`/es/courses/x` → `/courses/x`; Next's `_rsc` cache-buster is
  removed). The API classifies `/courses/{slug}` as a course page view and `/checkout?course={slug}` as a checkout
  started.
  The API also reads UTM tags and ad click ids (`gclid`, `fbclid`, …) from this query, so the landing URL's query is
  all it needs for campaigns.
- **`referrer`** (optional) is the view's **external** referrer, so the API knows the visit's traffic class (direct,
  organic search, social, referral). For a document load it is the request's `Referer` header, sent as-is (full URL,
  capped at 2000 chars) **only when its host differs from the school's own host** — a referrer on the school's site
  counts as none, so it is left out. Client-side navigations (`RSC: 1`) never send one: their referrer is the
  previous page of the same site. No `Referer` (direct visits, `Referrer-Policy: no-referrer` sites) or an unparseable
  one → the field is omitted. Browsers' default `strict-origin-when-cross-origin` policy usually sends other sites'
  referrers as an origin only (`https://www.google.com/`).
- **`visitor_ip`** is the first `X-Forwarded-For` hop, else `X-Real-IP`; no report when neither is a valid IPv4/IPv6
  address. The edge in front of the site must set these (and overwrite client-sent values) for visitor counts to be
  meaningful. **`user_agent`** is the request's `User-Agent`. The API stores neither: it hashes them with a daily-rotating
  salt only to count each visitor once a day, and filters bots itself.
- **Never delays or breaks a page**: fire-and-forget through the proxy event's `waitUntil`, 1.5 s timeout, every error
  swallowed.
- **`DNT: 1` / `Sec-GPC: 1` are not consulted**: the report contains no identifier that survives the day and no
  cookie, and nothing personal is stored, so there is no tracking for those signals to opt out of.
- **Dev hosts**: bare `localhost` (which serves `DEV_DEFAULT_TENANT`) reports like any host, so the flow can be
  checked locally; the mock API accepts and discards the reports.
- **Off switch**: `ANALYTICS_PAGEVIEWS=off` (server env, default `on`).

## Authentication

Laravel Sanctum **SPA (cookie) auth** — see [auth.md](auth.md). The browser only ever calls its own tenant host; the
Next.js proxy forwards `/api/*` and `/sanctum/*` to Laravel (and SMS short links `/l/{code}`, code `[0-9A-Za-z]{8,12}`,
to `GET /api/v1/l/{code}`, whose `302` passes through untouched), so `laravel_session`/`XSRF-TOKEN` are first-party cookies
on the tenant's domain (works with custom domains, no third-party cookies). Cookies must be set **without a
`Domain` attribute** so each host gets its own.

## Caching contract (revalidation webhook)

Public pages are cached by Next.js (Data Cache + ISR). When content changes, Laravel must call:

```http
POST https://<any learner-site host>/hooks/revalidate
Content-Type: application/json
X-Coursiva-Signature: sha256=<hex HMAC-SHA256 of the raw body using REVALIDATE_SECRET>

{ "tags": ["t:amplify:course:the-funnel-blueprint", "t:amplify:catalog"] }
```

| Change in the dashboard                                                                                | Tags to send                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anything site-wide (theme, name, domain, SEO, plan)                                                    | `t:<slug>` (purges everything for the tenant)                                                                                                          |
| Site settings only                                                                                     | `t:<slug>:site`                                                                                                                                        |
| A course created/edited/published/unpublished                                                          | `t:<slug>:catalog`, `t:<slug>:course:<courseSlug>`, `t:<slug>:instructors`                                                                             |
| An instructor profile published/unpublished/edited/renamed/deleted (or its member removed or re-roled) | `t:<slug>:instructors`, `t:<slug>:instructor:<instructorSlug>` (old and new), `t:<slug>:catalog`, `t:<slug>:course:<courseSlug>` per course they teach |
| A product created/edited/published/deleted                                                             | `t:<slug>:catalog`, `t:<slug>:product:<productSlug>`                                                                                                   |
| Site builder published (pages, header, footer, theme)                                                  | `t:<slug>:site`, `t:<slug>:pages`                                                                                                                      |
| Learner feedback featured, categories edited                                                           | `t:<slug>:pages`                                                                                                                                       |
| A public webinar edited (optional: the page keeps it 60 s at most)                                     | `t:<slug>:webinar:<webinarSlug>`                                                                                                                       |
| Membership plans or prices                                                                             | `t:<slug>:membership`                                                                                                                                  |
| Help centre / legal pages (school contact details)                                                     | `t:<slug>:content`                                                                                                                                     |
| Blog posts published, edited or unpublished                                                            | `t:<slug>:blog`                                                                                                                                        |

Tagged data expires at once (`revalidateTag(tag, { expire: 0 })`, no stale-while-revalidate): the first request after
a publish renders fresh content, never one more stale page. Also purge the CDN for the tenant host when the theme or
domain changes. Without a webhook, cached data expires after one hour.

**Personal rendering.** Dashboard previews (`/any/page?preview=<token>`) and visitors who unlocked a password-locked
site get pages built for them: `/__site` switches on Next's Draft Mode for that browser, so its requests skip every
cache and server reads forward its cookies (session, unlock) and the preview token (`src/lib/api/personal.ts`).
Password and members-only builder pages are fetched in the browser instead (the cached page shows their gate).

**HTTP caching of public reads.** `GET /site`, `/pages/{slug}`, `/courses`, `/courses/{slug}`, `/blog/posts`,
`/blog/posts/{slug}`, `/membership`, `/products/{slug}`, `/instructors`, `/instructors/{slug}`, `/seo` and `/redirects/resolve` answer a response that is not
personalised with:

```http
Cache-Control: max-age=60, public, s-maxage=60, stale-while-revalidate=300
ETag: "<first 32 hex digits of the body's SHA-256>"
Vary: Accept-Language
```

and a request whose `If-None-Match` matches the ETag (or is `*`) gets `304 Not Modified` with no body. A response is
personalised, and answered `Cache-Control: no-store, private` without an ETag, when the request carries the learner
session cookie (`coursiva_learner_session`) or an `Authorization` header, or a `?preview=` token; when the site lock is
on; for password and members-only pages; and for any status other than 200 (`401 site_locked`, `404`…). Both backends
send the same headers.
