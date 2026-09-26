# Tenant resolution & site config

## `GET /platform/v1/domains/resolve?host=<host>` — server-to-server

Called by the Next.js proxy for every new host (memoised 60 s in-process). Requires `Authorization: Bearer <service token>`.

- `<slug>.<PLATFORM_ROOT_DOMAIN>` resolves by slug; anything else is looked up as a verified custom domain.
- `200 { data: TenantResolution }` — `{ tenant, primary_host, status: 'active'|'suspended', indexable, default_locale, locales }`
  (`locales` lets the proxy route `/<lang>/…` URLs without another lookup)
- `404` unknown host → the site shows "Site not found". `401` without the service token.

`primary_host` is the canonical host. Requests on any other host of the tenant are `308`-redirected there, so each
page has exactly one URL (SEO). When a tenant connects a custom domain, `primary_host` becomes that domain.
`status: suspended` renders a 503 "temporarily unavailable" page. `indexable: false` adds `X-Robots-Tag: noindex`.

## `GET /api/v1/site` — public, cached (`t:<slug>:site`)

`Site` — name, legal name, tagline, logo, **`brand: { hue, chroma }`** (every colour derives from these, see
`src/lib/theme.ts`), `currency` (ISO 4217), `primary_host`, `support_email`, `social[]`,
`default_locale` + `locales` (BCP 47, default first — every published language, see [../i18n.md](../i18n.md)),
`seo { title, description, indexable, og_image_url, twitter_handle }`, `white_label` (hides "Powered by Coursiva"),
`auth_pitch { title, bullets[], quote }` (sign-in page panel), `oauth_providers[]` (e.g. `["google"]`), and
`features { membership, community, certificates, streaks }` (plan entitlements; the API enforces them too).

**Accessibility requirement:** any colour the API hands out as a background for white text (avatars, covers with
text) must have ≥ 4.5:1 contrast with white — keep OKLCH lightness ≤ 0.55.
