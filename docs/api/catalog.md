# Catalogue (public, cached)

## `GET /api/v1/courses` — tags `t:<slug>:catalog`

`Catalog { courses: CourseSummary[], categories: Category[], bundles: Bundle[] }`

- `courses` sorted by popularity (student count). Only published courses.
- `CourseSummary` includes `lesson_count` and `duration_minutes` (computed from the curriculum — one owner),
  `payment_plan { installments, installment_price }` when instalments are offered, `featured` (at most one: the
  storefront's "Most popular"), `updated_at` (sitemap `lastmod`).
- `categories[].course_count` counts published courses.
- `bundles[]` include `compare_at_price` (sum of the courses) and `savings_percent`, both computed by the API.
- `cover { url, color, alt }` — `url` is a CDN image (`cdn.coursiva.app`) or `null`, then `color` is the placeholder.

The catalogue page renders the full list on the server (crawlable); search, category, sort and grid/list view are
client-side and live in the URL. For catalogues beyond a few hundred courses, add `?page=` and server-side filtering.

## `GET /api/v1/courses/{slug}` — tags `t:<slug>:catalog`, `t:<slug>:course:<slug>`

`CourseDetail` = `CourseSummary` + `description`, `outcomes[]`, `requirements[]`, `audience[]`, `faqs[]`,
`modules[] { id, title, lessons[] { id, title, type, duration_seconds, question_count, free_preview } }`,
`instructor_profile`, `guarantee_days`, `certificate`, `community`, `preview` (the free-preview lesson),
`reviews[]` (latest first, used for JSON-LD too), `rating_distribution[] { stars, percent }`,
`included_in_plan { plan_id, plan_name, per_month }` (cheapest membership plan that unlocks the course, or null),
`related[]`, `language`, `published_at`.

`404` for unknown or unpublished courses. Lesson **content** is never public — only the outline.

## Course reviews

`POST /api/v1/courses/{slug}/reviews` — signed in, enrolled, once per course.
Body `{ rating: 1..5, body: string ≥ 10 }` → `201 Review`. `403` not enrolled, `422` invalid or already reviewed.
Increments `review_count`; send `t:<slug>:course:<slug>` to the revalidation webhook.
