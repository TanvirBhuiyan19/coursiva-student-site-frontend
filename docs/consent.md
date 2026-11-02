# Cookie consent on school sites

Every school site asks (or lets visitors choose) before anything non-essential runs or is stored in the browser. The
storefront itself sets only what it needs to work; the school's own head code, ad click ids and attribution wait for
the visitor's consent.

## Categories

| Category      | What it covers                                                                                                                                                                                                                                                                                                                                                                       | Gated by                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| **Essential** | Session and CSRF cookies (`coursiva_session`/Laravel's, `XSRF-TOKEN`), guest cart, site-lock unlocks, the consent choice itself, and the server-side page-view count (no cookie, no storage: `features/analytics/pageviews.ts`).                                                                                                                                                     | never (always on)               |
| **Analytics** | First-touch campaign hints (`utm_source`, `utm_medium`, `utm_campaign`, external referrer origin, sessionStorage `coursiva:acquisition`), the last blog post read (`coursiva:post`, 30 days), and school head code marked `data-consent="analytics"`.                                                                                                                                | `granted('analytics')`          |
| **Marketing** | Ad click ids (`gclid`, `fbclid`, `ttclid`, `li_fat_id`, `msclkid`, `epik`, `twclid`), the partner link `?ref=`: its click report (`POST /affiliates/{slug}/clicks`) and the recorded click (`coursiva:ref` = partner + click id, kept for the school's cookie window and by its first/last-click rule), and all other school head code (scripts, pixels, external styles and links). | `granted('marketing')`, not GPC |

## Modes

The school's **Settings → Privacy → Cookie banner** (`GET /site` → `cookie_banner`, docs/api/tenant.md) picks the mode:

- **Banner on — opt-in.** The notice asks first: **Accept**, **Decline** or **Choose cookies** (per category). Until
  the visitor accepts a category, nothing of it runs or is stored. Never answering is the same as declining.
- **Banner off — opt-out.** Categories are on, and the visitor can turn them off at any time.

In both modes:

- **Cookie settings** in the site footer reopens the choices (essential is shown as always on). A changed choice applies
  at once and in the visitor's other tabs.
- **Global Privacy Control** (`navigator.globalPrivacyControl === true`) keeps marketing off whatever is stored; the
  marketing switch is disabled with a note.
- Until the page has hydrated and set the mode, nothing is granted (server render and the first paint run no school
  code).
- The staff preview (`/preview/…`) never sets a mode: nothing runs, nothing is stored.

## Withdrawing consent

Turning a category off forgets what the storefront stored for it (the click ids or campaign hints in
`coursiva:acquisition`, `coursiva:ref` and its click marker, or `coursiva:post`) and deletes the well-known first-party
cookies of analytics and ad tools on the school's domain (`_ga*`, `_gid`, `_gat*`, `_hj*`, `_clck`, `_clsk`, `_fbp`,
`_fbc`, `_gcl_*`, `_ttp`, `_uet*`, `_pin_unauth`, `_scid*`, …; `features/consent/tracking.ts`). If the school's code of
that category already ran on the page, the page reloads so it stops.

### The partner link (`coursiva:ref`)

A `?ref=<partner>` landing is reported once per browser session per partner. Only when the API records the click
(`201 { click_id, cookie_days, attribution }`) is `{ value, click, at, days }` kept in `localStorage`: for the school's
cookie window (`cookie_days`, 0 = no expiry) and by its rule (`last_click` replaces what is kept; `first_click` keeps
an unexpired earlier partner). An unknown partner or a failed report keeps nothing; an answer that arrives after
marketing was withdrawn is dropped. Expired entries, and entries without a click id from older site versions, are
deleted on read. The checkout sends `ref` + `ref_click` (marketing only); the API checks the click against the window.

## The school's head code

`GET /site` → `head_code` is split by `partitionHeadCode` (`src/lib/headCode.ts`):

- **Rendered on the server** (can't run code, set a cookie or contact another server): `<meta name|property>` (never
  `http-equiv` or `charset`), `<link rel="me|author|license|help">` and inline `<style>` without `url(`, `image-set(`,
  `@import`, `@font-face` or `src:`. Site verification tags keep working.
- **Waits for consent** (`components/site/ConsentScripts.tsx`): `<script>`, other `<link>`s and styles that load
  resources. Each is added to `<head>` in the school's order once its category is allowed; a classic external script is
  loaded before the code after it runs. A tag marked `data-consent="analytics"` is analytics; anything unmarked is
  marketing (the strictest). The common `type="text/plain"` + `data-consent` pattern runs as a normal script.
- **Dropped:** `<noscript>` (it only renders without JavaScript, so it could never wait for consent; mostly pixels).
- **Never on code-free pages** (`CODE_FREE_PREFIXES` in `src/lib/routes.ts`: sign-in, sign-up, forgot/reset password,
  verify email, subscription confirm, claim, join, webinar join, checkout, account, orders): neither part renders there.
  The server decides from the path, so the code isn't even in those pages' HTML or RSC payload: the root layout renders
  the `@code` parallel slot (`src/app/[tenant]/[locale]/@code`: `page.tsx` for the home page, `[...slug]/page.tsx` for
  the rest, which returns nothing for a code-free path; `components/site/SchoolCode.tsx` renders the code). The path is
  part of each page's cache key, so pages stay as cacheable as before (no request headers are read). React hoists the
  passive `<meta>` and `<link>` tags into `<head>`. A 404 the router can't match to a page (`default.tsx`) carries no
  code. On the client, `HideOnPaths` still hides it, and arriving on a code-free page after school code ran on an
  earlier page reloads it as a fresh document (`CodeFreeReload`), since scripts keep running across client-side
  navigations. The proxy also never applies a school redirect to those paths
  (`isReservedRedirectPath`).

The school's own scripts can read the choice from `<html data-cookie-consent="accepted|declined|partial"
data-consent-analytics="granted|denied" data-consent-marketing="granted|denied">` and the `coursiva:consent` window
event (`detail: { analytics, marketing }`), fired on every change.

## Tracking tags and conversion events

`GET /site` → `tracking` (docs/api/tenant.md) holds the school's validated tag ids; `src/features/tracking` builds each
tag from its id (never from school text):

| Category      | Tags                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| none needed   | site verification `<meta>` (Google, Bing, Yandex, Pinterest), server-rendered |
| **Analytics** | Google Analytics 4, Google Tag Manager, Microsoft Clarity, Yandex Metrica     |
| **Marketing** | Meta pixel, TikTok pixel, LinkedIn Insight Tag                                |

- **Google Consent Mode v2**: `gtag('consent', 'default', …denied)` runs before any Google tag, then `update` from the
  visitor's choice (`analytics_storage` = analytics; `ad_storage`, `ad_user_data`, `ad_personalization` = marketing),
  and again on every change.
- **Events** (`events.ts`): `page_view` on every navigation, `view_item` (course and product pages), `begin_checkout`,
  `add_payment_info` (Pay), `purchase` (order success page, once per order: localStorage `coursiva:purchase:{id}`,
  written only once a tag got it), `sign_up` and `lead` (`coursiva:lead` from lead forms). An event that happens
  before its tag loads (the banner is still open) is sent when the visitor allows it, on the same page.
- **Server-side copies**: checkout, sign-up and lead requests carry `tracking` — the consent and, only as far as it
  allows, the tags' browser ids and the visit's click ids (`conversionSignal()`; docs/api/commerce.md). Meta and
  TikTok get the same event ids from browser and server (`purchase_{order}`, `sign_up_{user}`, `lead_{submission}`), so
  each counts once; GA4 gets only server-side purchases (de-duplicated by `transaction_id`).
- Withdrawing a category deletes the tags' cookies and reloads the page (as for head code); the staff preview loads none.

## Where it lives

| File                                           | Role                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `src/features/consent/store.ts`                | the choice (localStorage `coursiva_cookie_consent`), modes, GPC, `granted` |
| `src/features/consent/tracking.ts`             | gated capture, checkout attribution, withdrawal clean-up                   |
| `src/features/consent/useConsent.ts`           | React hook                                                                 |
| `src/components/site/CookieBanner.tsx`         | notice and choices                                                         |
| `src/components/site/CookieSettingsButton.tsx` | footer link                                                                |
| `src/components/site/ConsentScripts.tsx`       | consent-gated head code                                                    |
| `src/components/site/SchoolCode.tsx`           | the school's code for a page (the layout's `@code` slot decides which)     |
| `src/app/providers.tsx`                        | sets the mode from `cookie_banner`                                         |
| `src/features/tracking/`                       | tag ids, tag loaders, e-commerce events, verification meta                 |

Tests: `src/features/consent/consent.test.tsx` (rules, storage, banner), `src/components/site/schoolCode.test.tsx`
(code per path) and `e2e/consent.spec.ts` (real browser: scripts, storage, cookies, decline, change later, withdrawal,
GPC, banner off, no code in code-free pages' HTML).
