# Membership (public, cached)

## `GET /api/v1/membership` — tags `t:<slug>:membership`

`404` when the tenant's plan has no memberships.

`Membership { title, subtitle, annual_discount_percent, guarantee_days, plans[], comparison[], testimonial, faqs[] }`

- `plans[].prices[]` — one entry per interval: `{ interval: 'month'|'year', per_month, billed }`. Annual per-month
  and yearly totals are computed by the API (e.g. −20%); the page only switches which entry it shows.
- `comparison[] { label, values[] }` — one value per plan, in `plans` order: `true`/`false` (included / not) or a
  string ("All 6").

Joining a plan goes through checkout with `target: { kind: 'membership', plan_id, interval }` ([commerce.md](commerce.md)).
Pro and above unlock every course; Starter unlocks the first two (mock rule — Laravel reads plan entitlements).
