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

`Site` — name, legal name, tagline, `logo_url` and `icon_url` (the published Branding logo and square icon, each a URL
or `null`; `icon_url` is the favicon fallback after the site builder's `favicon_url`, and the apple-touch icon), **`brand: { hue, chroma }`** (every colour derives from these, see
`src/lib/theme.ts`), `currency` (ISO 4217), `time_zone` (IANA, the school's workspace setting, `UTC` when unset — lesson unlock dates and live times are shown in it; absent/unknown → the viewer's zone), `primary_host`, `support_email`, `social[]`,
`default_locale` + `locales` (BCP 47, default first — every published language, see [../i18n.md](../i18n.md)),
`seo { title, description, indexable, og_image_url, twitter_handle }`, `white_label` (hides "Powered by Coursiva"),
`auth_pitch { title, bullets[], quote }` (sign-in page panel), `oauth_providers[]` (e.g. `["google"]`, one sign-in
button each), `sso_enabled` (the school has SAML SSO on and its identity provider connected, so the sign-in page
shows the SSO button; absent = off), and
`features { membership, community, certificates, streaks }` (plan entitlements; the API enforces them too).

**Platform feature availability.** `unavailable: string[]` lists the capability keys the platform switched off for every
school (console → Feature availability) or whose platform connection is missing — empty means everything is available.
The API already applies it to `oauth_providers` (`signin_{provider}`), `sso_enabled` (`sso`) and `features`
(`memberships`, `community`, `certs`); `normalizeSite` applies it again so an older or cached payload can't show a
switched-off feature. The storefront also hides, by key:

| Key            | Hidden                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `live_classes` | `/live/**` and `/webinars/**` answer 404 (route layouts); the header and drawer Live links; header links to them  |
| `ai`           | The AI tutor section in the player (no tutor request either); `GET …/tutor` answers `enabled: false`              |
| `community`    | `/community` 404, its header/tab-bar links (via `features.community`)                                             |
| `certs`        | `/certificates` 404, its header/drawer links (via `features.certificates`)                                        |
| `signin_{p}`   | That provider's "Continue with …" button (via `oauth_providers`); its OAuth start redirects with `not_configured` |
| `sso`          | "Sign in with SSO" (via `sso_enabled`); `/auth/saml/*` answers 404                                                |

Mock: `POST /__mock/availability/{tenant}` with `{ unavailable: [...] }` (test hook, never in the real API).

`social[]` now includes every network the school can add: `linkedin, instagram, youtube, x, facebook, tiktok,
threads, pinterest, spotify, website` (`website` may repeat).

### Site-builder output (additions)

`GET /site` also carries what the school built in the site builder (published to the website; the draft with
`?preview=<token>`, which is then answered `Cache-Control: private, no-store`). Query `locale` / `Accept-Language`
translates server-made labels (see [pages.md](pages.md#server-made-labels)).

```
navigation {
  header {
    logo_text: string,                 // the header's logo text, else the school name
    cta: { label, href } | null,       // header button
    sticky: boolean, show_cart: boolean, show_notifications: boolean,
    items: { label, href }[]           // header links that are on, then pages with "show in navigation" (page order), de-duplicated by href
  },
  footer {
    tagline: string, copyright: string,
    columns: { title, links: { label, href }[] }[],
    show_social: boolean, show_legal: boolean,
    show_powered: boolean              // forced true unless the plan is white-label
  }
}
theme { font: 'bricolage_instrument' | 'editorial_serif' | 'minimal_sans', radius: 'sharp' | 'soft' | 'round',
        buttons: 'filled' | 'outline' | 'soft', density: 'compact' | 'comfortable' }
announcement: { text } | null          // the announcement bar
favicon_url: string | null             // the school's favicon (a stable /api/v1/site/assets/{id} address)
head_code: string | null               // the school's own custom <head> code (see below)
cookie_banner: boolean                 // show the cookie consent banner
tracking: SiteTracking | null          // analytics tags, ad pixels, site verification (see below); null on previews
site_lock { enabled: boolean, unlocked: boolean, password: boolean }
pages: [{ path, title }]               // public builder pages other than home, no templates (sitemap)
screens {
  auth: AuthScreen | null,
  legal { privacy: LegalScreen | null, terms: LegalScreen | null, refund_policy: LegalScreen | null }
}
```

- **Links** (`href`) are resolved server-side exactly like page links ([pages.md](pages.md#shared-shapes)): site paths
  or `https://` URLs. A header / footer **`#anchor`** link is resolved to the page that has a shown section with that
  anchor — the home page first, else the first page in order — as a path with a fragment (`/#faq`, `/offer#pricing`),
  so it works from every page (on that page the browser scrolls in place). An anchor no page has is left out (a header
  CTA falls back to `/courses`).
- **Older payloads.** The storefront normalises `GET /site` and `GET /pages/{slug}` (`normalizeSite`, `normalizePage`):
  every site builder field and section frame field has a safe default, so a response cached by an older API never
  breaks a page. Server reads also send `X-Storefront-Payload: <version>`, which is part of Next's Data Cache key: a
  build that changes the payload shape doesn't reuse responses cached by the previous build.
- **`theme`** tokens map to the storefront's CSS variables and fonts: `font` (Bricolage Grotesque + Instrument Sans ·
  an editorial serif · a minimal sans), `radius` (corner radius scale), `buttons` (filled · outline · soft tonal),
  `density` (spacing scale).
- **Icons (order).** Favicon: `favicon_url` (site builder) → `icon_url` (Branding icon) → `logo_url` (Branding logo) →
  a generated icon. Apple touch icon: `icon_url` → `logo_url` → generated (not `favicon_url`). `seo.og_image_url` (the
  share image) is unchanged. Every value is `null` when unset, so a school that removes its icon falls back on the next read.
- **`head_code`** is the school's own code for its own site (analytics, verification tags…), added to `<head>` on
  every page **subject to cookie consent** ([../consent.md](../consent.md)): `<meta>`, inert links and plain styles
  are server-rendered; scripts, pixels and anything that loads a resource wait until the visitor allows their category
  (`data-consent="analytics"`, otherwise marketing); `<noscript>` is dropped. It is only sent for the published site
  on the school's host — `null` on previews (a preview link can be opened by anyone it is shared with) and when empty.
- **`head_code`** also carries the SEO screen's **head scripts** (after the site builder's code), through the same
  consent rules.
- **`tracking`** — `{ ga4, gtm, meta_pixel, tiktok_pixel, linkedin_partner, clarity, yandex_metrica, verification: {
google, bing, yandex, pinterest } }`, each a string or `null`. From the school's **Settings → Integrations** tracking
  apps (they win) and the **SEO → Trackers** (GA4, GTM, Meta pixel, Yandex Metrica, and the Search Console / Bing /
  Yandex / Pinterest verification tokens). The API re-checks every value with a strict pattern (`G-[A-Z0-9]{4,15}`,
  `GTM-[A-Z0-9]{4,10}`, 10–20 digits, `[A-Z0-9]{15,25}`, 4–10 digits, `[a-z0-9]{6,20}`, 6–10 digits; tokens
  `[A-Za-z0-9_-]{10,100}` / `[A-Za-z0-9]{10,64}`) and sends `null` otherwise; the site checks again
  (`src/features/tracking/ids.ts`) and builds each tag itself from the id — school text never reaches a script.
  Verification tokens are rendered as `<meta>` tags on the server (no consent needed); GA4, GTM, Clarity and Yandex
  Metrica load with **analytics** consent, the Meta, TikTok and LinkedIn pixels with **marketing** consent; Google
  Consent Mode v2 defaults are denied until the visitor's choice is applied ([../consent.md](../consent.md)).
  Absent (an older API) = no tags.
- **`cookie_banner`**: one source of truth — **Settings → Privacy → Cookie banner** (`privacy.cookie_banner`, default
  on). On = opt-in (the notice asks before anything non-essential runs or is stored); off = opt-out (on until the
  visitor turns it off under "Cookie settings" in the footer). Global Privacy Control always keeps marketing off. See
  [../consent.md](../consent.md). The site builder's own switch is not used by the storefront.
- **`site_lock`**: when `enabled` and not `unlocked`, show the lock screen (with a password field when `password` is
  true; otherwise "This site isn't open yet"). Page, catalogue, course, membership and blog reads answer
  `401 { code: site_locked }` until unlocked. A valid `?preview=` token always unlocks. Locked sites keep
  `seo.indexable: false` (noindex). While the lock is on, `GET /site` is `Cache-Control: private, no-store` (it
  depends on the visitor's cookie): fetch it uncached and forward the visitor's `Cookie` header.
- **`screens`** configure built-in screens from their builder pages (stage 1 consumes these two):
  - `AuthScreen { title, subtitle, button, tagline, quote: { text, author } | null, benefits: string[], signup: boolean,
google: boolean, forgot: boolean }` — from the `auth` section of the builder page at `/login` or `/sign-in`.
    `signup` = show the create-account tab, `google` = show "Continue with Google" (only if `oauth_providers` has
    `google`), `forgot` = show the forgot-password link. `auth_pitch` stays for older clients.
  - `LegalScreen { title, updated, back: string, sections: { heading, body }[], footer }` — from the `legal` section
    of the builder page at `/privacy`, `/terms`, `/refund-policy`; each section `body` is Markdown (the builder's
    rich text, no images; rendered with `breaks`, plain text via `markdownToPlain` for the meta description). When
    `null`, show today's content
    (`GET /legal/{slug}`).

## `POST /api/v1/site/unlock` — public, throttled (10/min per visitor)

Body `{ password }` → `200 { data: { unlocked: true } }` and sets the httpOnly, `SameSite=Lax` cookie
`coursiva_site_unlock` (30 days; bound to the current site password, so changing it locks the site again).
`422 { errors: { password: ["That password isn’t right."] } }` · `404` when the site isn't locked or has no site
password (only preview links open it) · `429`.

**Accessibility requirement:** any colour the API hands out as a background for white text (avatars, covers with
text) must have ≥ 4.5:1 contrast with white — keep OKLCH lightness ≤ 0.55.
