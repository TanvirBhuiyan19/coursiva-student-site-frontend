# Learner-site API contract

This is what the Laravel backend must implement for the learner site (`student-site`). The **executable** version of
this contract is the mock API in `mock-api/` plus its tests in `mock-api/app.test.ts` — if this document and the
tests disagree, the tests win. Resource shapes are the TypeScript types in `src/features/<feature>/types.ts`.

| Feature                          | Doc                            | Types                              |
| -------------------------------- | ------------------------------ | ---------------------------------- |
| Tenant resolution & site config  | [tenant.md](tenant.md)         | `src/features/tenant/types.ts`     |
| Catalogue                        | [catalog.md](catalog.md)       | `src/features/catalog/types.ts`    |
| Site-builder pages               | [pages.md](pages.md)           | `src/features/pages/types.ts`      |
| Membership plans                 | [membership.md](membership.md) | `src/features/membership/types.ts` |
| Auth (Sanctum SPA)               | [auth.md](auth.md)             | `src/features/auth/types.ts`       |
| Learning, player, quizzes        | [learning.md](learning.md)     | `src/features/learning/types.ts`   |
| Cart, wishlist, checkout, orders | [commerce.md](commerce.md)     | `src/features/commerce/types.ts`   |
| Community                        | [community.md](community.md)   | `src/features/community/types.ts`  |
| Profile, certificates, support   | [account.md](account.md)       | `src/features/account/types.ts`    |

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

## Authentication

Laravel Sanctum **SPA (cookie) auth** — see [auth.md](auth.md). The browser only ever calls its own tenant host; the
Next.js proxy forwards `/api/*` and `/sanctum/*` to Laravel, so `laravel_session`/`XSRF-TOKEN` are first-party cookies
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

| Change in the dashboard                             | Tags to send                                       |
| --------------------------------------------------- | -------------------------------------------------- |
| Anything site-wide (theme, name, domain, SEO, plan) | `t:<slug>` (purges everything for the tenant)      |
| Site settings only                                  | `t:<slug>:site`                                    |
| A course created/edited/published/unpublished       | `t:<slug>:catalog`, `t:<slug>:course:<courseSlug>` |
| Site-builder page saved                             | `t:<slug>:page:<pageSlug>`                         |
| Membership plans or prices                          | `t:<slug>:membership`                              |
| Help centre / legal pages                           | `t:<slug>:content`                                 |

Also purge the CDN for the tenant host when the theme or domain changes. Without a webhook, cached data expires
after one hour.
