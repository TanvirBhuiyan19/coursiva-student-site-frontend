@AGENTS.md

# Coursiva learner site (student-site)

Next.js 16 (App Router, Turbopack) · React 19 + React Compiler · TypeScript strict · next-intl · TanStack Query 5 ·
CSS Modules on design tokens (no UI kit) · Hono mock API · Vitest · Playwright + axe.
The white-label storefront + learning app for every tenant, from one deployment. Design reference:
`../design_handoff_coursiva_lms/designs/Student Site.dc.html` (+ handoff README). Read `docs/architecture.md` first.

```
npm run dev          # mock API (:8787) + Next (:3000). Open http://amplify.localhost:3000 (or northwind.localhost:3000)
                     # sign in as jordan.tate@gmail.com / password
npm run check        # typecheck + lint (0 warnings) + prettier + unit/contract tests — must pass before you finish
npm run e2e          # Playwright on a production build (:3100) + mock API (:8797): SEO, tenancy, flows, axe
npm run build        # production build (never needs the API)
npm run revalidate   # purge cached tenant data after editing the mock seed (what Laravel's webhook does)
```

## Rules

### Rendering, caching, SEO

- Tenant routes live under `app/[tenant]/[locale]/` (tenant-level files like `sitemap.xml` under `app/[tenant]/`). Get
  both with `currentScope()` / `getCurrentSite()` (root params). Route handlers can't use root params — read `params`.
- Every tenant page keeps `generateStaticParams() => []` semantics (inherited from the root layout): rendered on first
  request, cached, revalidated by tag. **Public pages must not read cookies/headers** — that would make them dynamic.
  Pages that must read `searchParams` on the server set `export const dynamic = 'force-dynamic'` (private pages only).
- Server reads go through `features/<f>/server.ts` using `apiGet`/`apiGetOrNull` with `cacheTags`. New data → new tag
  → document it in `docs/api/README.md` (Laravel must send it to `/hooks/revalidate`).
- Learner-specific data is fetched in the browser via `features/<f>/api.ts` hooks. Public pages server-render the
  guest state; personal state layers on after hydration (see `CourseCardState`, `BuyBox`).
- Every indexable page: `generateMetadata` with `alternates` from `pageAlternates(path)` (canonical + hreflang), a
  real description, and JSON-LD from
  `lib/seo.ts` when a schema fits. Private/transactional pages: `robots: { index: false }` and listed in
  `NOINDEX_PREFIXES`/`PRIVATE_PREFIXES` (`lib/routes.ts`). All URLs come from `routes` in `lib/routes.ts`.
- Metadata file conventions (`icon.tsx`, `opengraph-image.tsx`, `sitemap.ts`) emit `/{tenant}/…` URLs — use route
  handlers (`icon.png/route.tsx`, `og.png/route.tsx`, `sitemap.xml/route.ts`) instead.

### Data & API contract (Laravel)

- `features/<f>/types.ts` is the contract; `docs/api/<f>.md` documents it; `mock-api/` implements it;
  `mock-api/app.test.ts` locks it in. Change all four together.
- snake_case on the wire, camelCase in code (only `lib/api/case.ts` converts). Never use data values as object keys.
- **The client never computes business figures**: prices, totals, tax, instalments, progress %, streaks, locks and
  quiz scores come from the API. Formatting only (`useFormat()` / `lib/format.ts`, always the tenant locale).
- Mutations: invalidate every key they affect (`refreshMe` for header counters). Toggles (wishlist, like, preferences,
  lesson complete) are optimistic with rollback.
- Browser code calls only same-origin `/api/v1/*` (`lib/api/client.ts` handles CSRF/419). Never call the API host
  directly from the browser, never read `process.env` outside `config/env.ts`.
- Card data never goes to our API: use the provider boundary in `features/commerce/payments.ts`.

### UI

- Tokens only (`styles/tokens.css`, brand tokens from `lib/theme.ts`); never hardcode a colour or use
  `var(--x, fallback)`. Shared primitives are global classes in `styles/ui.css` (`btn`, `input`, `chip`, `option`,
  `switch`, `accordion`, `progress`…); component layout in co-located CSS Modules. In a module, reference global
  classes with `:global(.name)`.
- Breakpoints: desktop ≥1024 · tablet 720–1023 · mobile <720 (design's three tiers). Student surfaces have no dark mode.
- Loading (`skeleton`), error (message + retry) and empty states on every data view.
- Toasts state the consequence ("Added The Funnel Blueprint to your cart").

### i18n — multi-language ready (read `docs/i18n.md`)

- Default language unprefixed, others under `/<lang>/…` (`src/i18n/locales.ts`); the proxy rewrites to
  `/{tenant}/{locale}/…`. Pass `locale` from `currentScope()` to every `features/<f>/server.ts` read.
- No literal UI strings in JSX (`i18next/no-literal-string`): add keys to `messages/en.json` (namespaced by feature)
  and use `useTranslations`/`getTranslations`. Whole sentences as one ICU message — never concatenate fragments.
- Links and navigation: `Link`, `useLocalizedRouter`, `useHardNavigate`, `useAppPathname` from `@/i18n/navigation`
  with locale-less `routes.*` paths — never `next/link` or next/navigation's router for app paths (they'd drop the
  `/<lang>` prefix).
- CSS: logical properties only (`margin-inline-start`, `inset-inline-end`, `text-align: start`…); horizontal motion ×
  `var(--dir-sign)`; directional icons `className="flip-rtl"`. Exceptions: `left: 50%` centring, media controls.

### Accessibility — WCAG 2.2 AA (axe-gated in e2e)

- Real buttons/links; every input labelled; headings in order; `dt` before `dd`; icons `aria-hidden`; modals are
  native `<dialog>`; tabs follow the ARIA pattern; scrollable regions are focusable and labelled.
- Text on colour needs 4.5:1 — API-provided colours for white text must be OKLCH L ≤ 0.55.

### Quality

- TypeScript strict + `noUncheckedIndexedAccess`; ESLint `strictTypeChecked` + jsx-a11y + next, **0 warnings**;
  Prettier. No `any`, no `@ts-ignore`, no `console.log`. An eslint-disable needs a one-line reason.
- New feature → contract test in `mock-api/app.test.ts`, e2e for its main flow, and add its pages to `e2e/a11y.spec.ts`.
