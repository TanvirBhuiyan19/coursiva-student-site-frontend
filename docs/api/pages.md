# Site-builder pages (public, cached)

## `GET /api/v1/pages/{slug}` — tags `t:<slug>:page:<slug>` (+ catalog, membership)

`Page { slug, title, seo { title, description }, sections: Section[], updated_at }` — today only `home`.

The tenant composes the page in the dashboard's site builder. The API returns sections **resolved**: referenced
courses, plans and stats are looked up and computed server-side, so the storefront never recomputes them.

| `kind`             | Payload                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `hero`             | `eyebrow, title, subtitle, primary_cta, secondary_cta, stats[] { value, label }, spotlight` |
| `featured_courses` | `title, courses[]` (CourseSummary)                                                          |
| `topics`           | `title, categories[]`                                                                       |
| `instructor`       | `eyebrow, title, instructor { …Person, role, bio }, stats[], video`                         |
| `membership_plans` | `title, subtitle, plans[]` (omitted when the plan lacks memberships)                        |
| `testimonials`     | `title, items[] { quote, rating, author, context }`                                         |
| `value_props`      | `items[] { icon: check\|infinity\|sparkle, title, body }`                                   |
| `newsletter`       | `title, body` (signup posts to `/api/v1/newsletter`)                                        |

Unknown `kind`s are ignored by the site, so new section types can ship in the API first. Section `id`s are stable
keys — never array indices.

## `POST /api/v1/newsletter` — public

`{ email }` → `201 { subscribed: true }`, idempotent. `422` invalid email.
