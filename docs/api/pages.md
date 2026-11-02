# Site-builder pages (public)

The school composes pages in the dashboard's site builder. The API returns every page **resolved**: referenced
courses, plans, stats and links are looked up server-side, so the storefront never recomputes them. What the school
sees in the editor canvas is what this API describes.

Everything comes from what is **published to the website** (the starter site before the first publish). A valid
`?preview=<token>` (a dashboard preview link) renders the **draft** instead, ignores page visibility and the site
lock, and is never cached.

## `GET /api/v1/pages/{slug}`

`{slug}` is the page path without the leading `/`: `home` for `/`, `about`, `about/team` (multi-segment). Slug grammar
(the same everywhere — editor, validator, this route): lower-case segments `[a-z0-9-]+` joined by `/`, ≤ 200 chars,
no `_`, no `:`. `/home` is the home page (`home` → `/`). Template pages (`/courses/:slug`, `/learn/:course`) are never
served here.

Query: `preview=<token>` (optional), `locale=<BCP 47>` (or `Accept-Language`, for server-made labels, see below).

```
Page { slug, title, seo { title, description, og_image_url, noindex }, sections: Section[], updated_at }
```

- `seo.title` / `seo.description`: the page's SEO override (dashboard SEO) wins over the builder's; `null` when unset.
- `seo.og_image_url`: the site's share image (`null` when none). `seo.noindex`: `true` for members-only and
  password pages (site-wide indexability is `GET /site` → `seo.indexable`).
- `updated_at`: when the newest **website** version was published (app-only publishes don't count); the draft's last
  save on a preview.

### Access (visibility and the site lock)

| Situation                                       | Response                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Unknown page, template page, or app-only        | `404 { message, code: not_found }`                                                  |
| Site lock on, no valid unlock cookie or preview | `401 { message, code: site_locked }` → lock screen (`POST /site/unlock`)            |
| `Password` page, no valid page cookie           | `401 { message, code: page_password_required, title }` → password form (`…/unlock`) |
| `Members only` page, signed out                 | `401 { message, code: members_only }` → sign-in (then retry)                        |
| `Members only` page, signed in without access   | `403 { message, code: members_only }` → "members only" message                      |

**Members** are signed-in learners with at least one live enrolment (`active` or `completed`) **or** a membership in
`Active`, `Trialing` or `Past due`. Members-only and password pages, locked sites and previews answer with
`Cache-Control: private, no-store`: fetch them uncached, forwarding the visitor's `Cookie` header (session and unlock
cookies) on server-side calls. Public pages of an unlocked site are cacheable.

### Caching tags

`t:<tenant>`, `t:<tenant>:pages` (every builder page — learner feedback, categories and publishes revalidate it),
`t:<tenant>:page:<key>` (`<key>` = the slug param with `/` → `_`, e.g. `about_team`), plus `t:<tenant>:catalog` and
`t:<tenant>:membership`. Revalidate with expire-now semantics (no stale-while-revalidate): a publish must never serve
one more stale page.

## Sections: the common frame

Every section carries the frame, then its kind payload (flat, same object):

```
{
  id: string,                                   // the builder's stable id — use as React key
  kind: string,                                 // see the table below
  anchor: string | null,                        // render as the section element's id (#anchor links target it)
  style: {
    bg: 'white' | 'gray' | 'tint' | 'brand' | 'dark',
    pad: 's' | 'm' | 'l',
    align: 'left' | 'center',
    width: 'contained' | 'full',
    divider: boolean,                           // a divider line above the section
    variant: 'course' | 'progress' | 'cert'     // card variant (only meaningful for featured_courses)
  },
  visibility: { desktop: boolean, mobile: boolean },   // hide per breakpoint with CSS (never both false: those are omitted)
  animation: 'fade_up' | 'slide_in' | 'zoom' | null    // entrance animation; respect prefers-reduced-motion
}
```

Hidden sections, sections off on every device, app-screen kinds (`coursedetail, cart, dashboard, community, profile,
auth, legal, help, contact, checkout, filters, list, player` — they configure built-in screens, see `GET /site` →
`screens`) and sections with nothing to show are **omitted**. Unknown `kind`s must be ignored by the site, so new
kinds can ship in the API first.

### Shared shapes

```
Cta    { label: string, href: string }  // href: a site path ('/courses', '/about#faq'), '#anchor', or an https:// URL
Stat   { value: string, label: string }
Person { name, initials, avatar_url: null, color }     // as elsewhere
Video  { url: string, provider: 'youtube' | 'vimeo' | 'loom' | 'wistia' | 'media', embed_url: string | null }
```

`Video`: only allow-listed sources are emitted. For `youtube` (privacy-enhanced `youtube-nocookie.com`), `vimeo`,
`loom` and `wistia`, render an `<iframe src={embed_url}>`. For `media` (a video from the school's Media library),
`embed_url` is `null` and `url` is a playable file address (`/api/v1/site/assets/{id}`): render `<video src={url}>`.
An unknown or unsafe URL is never emitted (the `video` section is dropped; hero/instructor get `video: null`).

Links the school sets in the builder (`page:<id>`, `route:<name>`, `course:<id>`, `#anchor`, `/path`, `https://…`)
arrive here already resolved to `href`; an unresolvable link falls back to the kind's default.

### Kind payloads

Existing kinds keep their fields (additions are marked **new**).

| `kind`             | Builder kind           | Payload                                                                                                                                                                                              |
| ------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hero`             | hero                   | `eyebrow, title, subtitle, primary_cta: Cta, secondary_cta: Cta\|null, stats: Stat[], spotlight: CourseSummary\|null`, **new** `compact: boolean, side: 'none'\|'card'\|'video', video: Video\|null` |
| `featured_courses` | grid                   | `title, courses: CourseSummary[]`, **new** `link: Cta\|null, show_price: boolean, show_rating: boolean, variant`                                                                                     |
| `topics`           | topics                 | `title, categories: Category[]`                                                                                                                                                                      |
| `instructor`       | bio                    | `eyebrow, title, instructor { …Person, role, bio }, stats: Stat[], video: InstructorVideo\|null`                                                                                                     |
| `membership_plans` | pricing                | `title, subtitle, plans: MembershipPlan[]`, **new** `annual_toggle: boolean, static_plans: StaticPlan[]`                                                                                             |
| `testimonials`     | testimonial            | `title, items[] { quote, rating: number\|null, author: Person, context }`                                                                                                                            |
| `value_props`      | features               | `items[] { icon: 'check'\|'infinity'\|'sparkle', title, body }`, **new** `title` (section heading), `items[].glyph`                                                                                  |
| `newsletter`       | cta with `ph`          | `title, body`, **new** `placeholder, button_label` — signup posts to `/api/v1/newsletter`                                                                                                            |
| `text`             | text                   | **new** `title, body`                                                                                                                                                                                |
| `stats`            | stats                  | **new** `items: Stat[]`                                                                                                                                                                              |
| `faq`              | faq                    | **new** `title, items[] { question, answer }`                                                                                                                                                        |
| `logos`            | logos                  | **new** `title, items[] { name, image_url: string\|null }`                                                                                                                                           |
| `video`            | video                  | **new** `caption, video: Video`                                                                                                                                                                      |
| `cta`              | cta without `ph`       | **new** `title, body, button: Cta\|null`                                                                                                                                                             |
| `banner`           | banner                 | **new** `title, button: Cta\|null`                                                                                                                                                                   |
| `form`             | form                   | **new** `title, subtitle, fields: FormField[], submit_label, note, captcha, save, action`                                                                                                            |
| `lead_form`        | form + `opt.lead_form` | `form_id, title, subtitle` — a form section set to a live lead form; render the lead form inline ([forms.md](forms.md))                                                                              |
| `compare`          | compare                | **new** `title, columns: [string, string, string], highlight: 1, rows[] { feature, values: [string, string, string] }`                                                                               |
| `quote`            | quote                  | **new** `text, name, meta, author: Person`                                                                                                                                                           |

Details per kind (what the school typed always wins over computed data):

- **hero** — `stats`: the school's stat rows when it added any, else computed (course count, average rating,
  completion rate). `side` is `'card'` (show `spotlight`, the most popular course), `'video'` (show `video`) or
  `'none'`; a video side without a valid URL becomes `'none'`. `compact: true` = a compact page title instead of a
  full hero (smaller type, no side content). Default buttons: primary → `/courses`, secondary → `/learning`.
- **featured_courses** — the grid's source: `Featured courses` (default, 3 most popular), `All published courses`
  (≤ 12), `Category: <name>` (≤ 12), or `Manual` (the school's picks, matched by course id, falling back to title).
  Learner-specific sources (`My enrolled courses`, `My certificates`) are not shown on public pages (omitted).
  `link` is the heading's "See all" link (`null` when the school left the label empty; default href `/courses`).
  `show_price` / `show_rating` hide the card's price / rating. Omitted when no course matches.
- **instructor** — `stats`: the school's rows when present, else computed (students taught, average rating,
  certificates). `InstructorVideo { title, duration_seconds, poster_url: null, url, provider, embed_url }` — only
  when the school set a valid video URL (`title`/`duration_seconds` parsed from the caption `"Welcome · 2:04"`);
  otherwise `null`: never show a play button without a video.
- **membership_plans** — real membership plans (`plans`) when the school has memberships and open plans; otherwise the
  school's typed plan cards as `static_plans` (`plans: []`), so the section doesn't vanish:
  `StaticPlan { name, price (display text, e.g. "$59/mo"), description, highlighted (the middle card), button: Cta }`.
  `annual_toggle`: show the monthly/annual switch. Omitted when there are neither.
- **testimonials** — the school's quotes (`rating: null`: the builder has no rating), else learner feedback featured
  from Student experience (`rating` 1–5 from the 0–10 score). Render stars only when `rating` is a number.
- **value_props** — `glyph` is the school's free-text icon (e.g. `✓`, `∞`, `✦`, `★`; may be `''` → pick by
  position); `icon` is kept for older clients (`∞` → `infinity`, `✦` → `sparkle`, anything else → `check`).
- **newsletter** — `placeholder` is the email field placeholder; `button_label` may be `''` (use the site's default).
- **text** — `body` is Markdown (the builder's rich text; no images). Render it with `lib/markdown.tsx` and `breaks`
  (older plain text keeps its line breaks), top heading an h3 under the section title. No HTML.
- **instructor** — `instructor.bio` and **faq** — `items[].answer` are Markdown too (same rendering). `{tenant}` in
  any of them arrives already substituted, the school's name escaped so it never formats.
- **cta** — a button call to action (a `cta` with an email placeholder is a `newsletter`). Default href `/courses`.
- **banner** — a one-line notice. Default href `/checkout`.
- **logos** — `image_url` is an https image address when the school set one, else render the name as a wordmark.
- **video** — omitted when the URL is not allow-listed.
- **compare** — `values` cells: `✓` (included, accent), `—` (not included, faint) or text. The middle column
  (`highlight: 1`) is the highlighted plan. Missing cells are `''`.
- **quote** — a single testimonial card (`author` gives the avatar initials and colour).
- **form** — see below.
- **lead_form** — a `form` section the school set to one of its lead forms (Forms & leads → the section's "Lead form"
  picker, `opt.lead_form`). Sent instead of the builder form only while that form exists and is live (else the
  section's own fields, as `form`). `title`/`subtitle` are the section's texts (`''` → the form's own title and
  description). The site renders the same lead form as the hosted page — see [forms.md](forms.md).

Empty sections are omitted: `stats`/`faq`/`logos`/`value_props`/`testimonials`/`compare` without rows,
`text`/`banner`/`quote` without text, a `form` without fields.

### Form sections

```
FormField { id: 'f1' | 'f2' | …, label, type: 'text' | 'email' | 'phone' | 'long_text' | 'choice' | 'checkbox', required: boolean, options: string[] }
form      { title, subtitle, fields: FormField[], submit_label, note, captcha: boolean, save: boolean, action: string }
```

- `action` is the path to post to: `/api/v1/pages/{slug}/forms/{sectionId}`.
- `options` are the choices of a `choice` field (`[]` otherwise; a choice without options is a free text field).
- `captcha: true` = show the spam-protection note. **Always** render the honeypot: a visually hidden text input named
  `website` (`tabindex="-1"`, `autocomplete="off"`) that people leave empty.
- `submit_label` may be `''` (use the site's default "Send"); `note` is a small footnote under the button.
- `save`: submissions are also saved as a contact in the school's Forms & leads (needs an email field).

## `POST /api/v1/pages/{slug}/forms/{sectionId}` — public, throttled (10/min per visitor)

Body `{ values: { f1: string, f2: boolean, … }, website: '' }` (keys are the field ids; checkboxes are booleans,
everything else strings) → `201 { data: { received: true } }`.

- Validated against the **published** section's fields: required fields, email (`email:rfc`, ≤ 254), phone
  (`+`, digits, spaces, `()-.`; 5–30 chars), choice (one of `options`), text ≤ 500, long text ≤ 5 000.
  `422 { message, errors: { "values.f2": ["Enter a valid email address."] } }` (messages are learner-facing).
- `404` unknown page, section not a published form (draft-only sections can't receive submissions).
- The page's access rules apply (`401 site_locked` / `page_password_required` / `members_only`, `403 members_only`).
- A filled honeypot is answered `201` but nothing is stored.
- Stored as a website form submission (all values, with the page and form); with `save` on and an email field
  filled, the contact is created or updated in Forms & leads (source `Website form`, tag `Lead`; name from a field
  labelled "name"). Like lead forms, submissions aren't audited.

## `POST /api/v1/pages/{slug}/unlock` — public, throttled (10/min per visitor)

Body `{ password }` → `200 { data: { unlocked: true } }` and sets an httpOnly, `SameSite=Lax` cookie bound to this
page and its current password (30 days; changing the password locks the page again). `422 { errors: { password:
["That password isn’t right."] } }` · `404` unknown page or not password-protected · `429`.

## `POST /api/v1/newsletter` — public

`{ email }` → `201 { data: { subscribed, confirmation_required } }`, idempotent. `422` invalid email. With the school's
**double opt-in** on (Sending & senders → Compliance) the contact is created **pending** and emailed a confirmation link
(`subscribed: false, confirmation_required: true` — the same answer for known and new addresses); the form then tells
the visitor to check their inbox. Off: `subscribed: true, confirmation_required: false`. Lead-form submissions
(`POST /api/v1/forms/{id}/submissions` → `{ received: true, confirmation_required }`) and site-builder form contacts
follow the same rule.

## `POST /api/v1/forms/confirm` — public, throttled (10/min per visitor)

`{ token }` → `200 { data: { confirmed: true } }` (idempotent) · `422 { errors: { token: ["This confirmation link is
invalid or has expired. Sign up again to get a new one."] } }`. The token comes from the link in the school's "Confirm
your subscription" email, `{site}/subscribe/confirm?token=…`: signed (HMAC under the school and the app key), valid for
7 days, superseded by a newer confirmation email. The `/subscribe/confirm` page (noindex) shows a **Confirm
subscription** button that posts it — never on load, since mail scanners open links. Until confirmed, the contact is
never synced to ad-network audiences, counted as a subscriber or added to campaigns.

## Server-made labels

Labels the API invents (default button labels such as "Browse courses", headings such as "Featured courses",
"What students say", stat labels such as "avg rating", "Join {plan}") are translated server-side from the request
language (`?locale=` for server reads, `Accept-Language` for browser calls), falling back to English. Text the school
typed is returned as typed (builder variables like `{tenant}` are filled in, learner variables removed).

## Blog — `GET /api/v1/blog/posts`, `GET /api/v1/blog/posts/{slug}` (public)

`/blog` lists published posts (`?per_page=50`, paginated `{ data, meta }` of `BlogPostCard { slug, title, excerpt,
published_at, categories[], author { name }, read_minutes, has_cover }`); `/blog/{slug}` shows one `BlogPost` (the
card + `body` (Markdown, rendered to safe elements by `lib/markdown.tsx`), `seo { title, description }`, `cta`,
`comments[]` approved). Server reads are cached with `t:<slug>:blog` (sent on every blog change) and expire after
5 minutes (scheduled posts go live by the clock). The page reports a read (`POST …/views { source, read_seconds? }`),
remembers the post for last-click blog revenue, and posts comments (`POST …/comments { name, email, text }` →
`202`, held for moderation).

## SEO — `GET /api/v1/seo` (public, cacheable; `401 site_locked` while the site is locked for the visitor)

What the storefront applies of the school's SEO (dashboard → Website → SEO). Types: `src/features/seo/types.ts`.

```ts
{
  title_template: string;     // `{page} — {school}`: the layout's title template (`%s — Acme`)
  noindex: boolean;           // the whole site hidden: robots.txt blocks everything, every page noindex
  schema_enabled: boolean;    // structured data on/off …
  schema_types: { organization, course, product, breadcrumbs, faq, article, person: boolean }; // … and per type
  robots_txt: string;         // the school's own rules (below)
  sitemap: { path: string; updated_at: string | null }[]; // pages the API knows (blog posts, products…)
  pages: {                    // per-page overrides, by locale-less path (only pages the school overrode)
    path: string; title: string | null; description: string | null;
    noindex: boolean; in_sitemap: boolean; canonical_url: string | null; og_image_url: string | null;
  }[];
  // also: auto_og_images, cookie_consent, head_scripts, trackers (consent-gated tags)
}
```

Revalidated with the tenant (`t:<slug>`: every SEO change revalidates the whole school). An older API, an error or a
locked site reads as the defaults (`src/features/seo/normalize.ts`) — SEO never breaks a page.

- **Titles**: `title_template` becomes Next's title template; a page's overridden `title` replaces the templated title
  (`{ absolute }`); `description`, `canonical_url` (a site path is localised) and `og_image_url` (Open Graph and
  Twitter) replace the page's own (`withSeo(path, metadata)` in every indexable page's `generateMetadata`: home and
  landing pages, courses, products and bundles, blog posts, help articles, instructors and the list pages).
- **noindex**: a page's `noindex` adds `robots: noindex, follow` and leaves it out of the sitemap; `in_sitemap: false`
  only leaves it out of the sitemap.
- **JSON-LD** (`components/seo/JsonLd.tsx`) drops nodes whose type is switched off: Organization/WebSite →
  `organization`, Course/ItemList → `course`, Product (with its Offer: price, currency, availability) → `product`,
  BreadcrumbList → `breadcrumbs`, FAQPage → `faq`, Article/BlogPosting → `article`, Person/ProfilePage → `person`. The
  JSON is escaped (`<`, `>`, `&`, U+2028/2029) so school text can't leave the script tag.
- **robots.txt** (`lib/robots.ts`): the school's User-agent groups with their Allow/Disallow/Crawl-delay lines; every
  group also gets the storefront's Disallow lines for private and transactional paths (`NOINDEX_PREFIXES`, `/api/`;
  `/account` becomes `Disallow: /account$` and `Disallow: /account/`, so `/accounting` stays crawlable), an Allow that
  would open one of them is dropped, other directives and the school's Sitemap lines are dropped, a `*`
  group is always present, and the site's own `Sitemap:` line ends the file. A hidden site, indexing off or a site lock
  → `Disallow: /`.
- **sitemap.xml**: the storefront's own list plus blog posts and products from `sitemap`, minus pages hidden or taken
  out of the sitemap, in every language with hreflang alternates.

### Redirects — `GET /api/v1/seo/redirects`, `POST /api/v1/seo/redirects/{id}/hits` (site server: service token + `X-Tenant`)

`GET` → `{ data: { id, from, to, status: 301|302, keep_query }[] }` (oldest first, ≤ 5,000). The proxy holds each
school's table in memory, indexed once (exact rules by key, prefix rules by base): fresh for a minute, then served stale
while one request refreshes it; after `/hooks/revalidate` receives `t:<slug>` the next request waits for the new table;
a failed refresh keeps the last good table (retried after 30 s). For GET/HEAD, before anything else is rendered, it
matches the path (case, trailing/repeated slashes and the query string ignored; exact before
prefix, longest prefix first; `from` ending in `/*` is a prefix, `to` ending in `*` gets the rest of the path), follows
chains to the final destination (one hop for the visitor; a loop or more than 10 hops is no redirect), keeps the
visitor's query string when `keep_query` (the destination's own parameters win) and answers 301/302 (302 if any hop is
temporary). A path under a language prefix with no rule of its own uses the rule for the rest of the path, and a path
destination keeps the prefix (`/es/old` → `/es/new`). Each served redirect (not prefetches) is reported in the
background: `POST …/{id}/hits` → `204`. Without the endpoint (older API, 404) or an error before any table loaded, the
site simply has no redirects. `GET /api/v1/redirects/resolve?path=` stays for
single lookups (renamed instructor profiles).

### 404 monitor — `POST /api/v1/seo/not-found` (site server, service token; 60/min per visitor)

`{ path, visitor_ip, user_agent?, internal?, referrer? }` → `204` always once valid (`422` for a path not starting
with `/` or a bad `visitor_ip`; `401` without the service token — browsers can't report). The API ignores bots and
vulnerability scans, drops the query string, masks email- and token-like path segments, keeps only the referrer's
host, and counts an `internal` visit, or a referral from one of the school's own domains (as the platform records
them), as a broken internal link.

How the site reports (`features/seo/notFound.ts`):

1. **The proxy notes every page request** — documents, client navigations and router prefetches (a prefetched page
   needs no request when clicked) — keyed by the visitor (IP + user agent) and path, for 5 minutes, in this server's
   memory only: _internal_ when it is an App Router request (`RSC: 1`: only the site's own JavaScript, on one of its
   pages, sends it) or its `Referer` is this host; otherwise the external `Referer`.
2. **The 404 page** (`NotFoundReport`) posts only its path to the site itself: `POST /__404 { path }` (mapped by the
   proxy to `app/[tenant]/not-found-report`, same-origin only — `Sec-Fetch-Site: same-origin`, or an `Origin` on this
   host).
3. **The route handler** takes the noted visit for that visitor and path (once) and reports it with the service token.
   Without one (another server instance answered, or it expired) the path still counts, with no referrer and not
   internal.

Why this design: the 404 page can't report while rendering — 404s are served from the ISR cache like any page, so the
render runs once per cache entry, not per visit — and a browser report can't be trusted: anyone could post any path
claiming it was linked from the school's own pages. So the browser only signals "this page was a 404", and where the
visit came from is what the server saw, including in-app (client-side) navigations, whose `document.referrer` never
changes.
