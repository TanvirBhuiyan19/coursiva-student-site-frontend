# Catalogue (public, cached)

## `GET /api/v1/courses` — tags `t:<slug>:catalog`

`Catalog { courses: CourseSummary[], categories: Category[], bundles: Bundle[] }`

- `courses` sorted by popularity (student count). Only published courses.
- `CourseSummary` includes `lesson_count` and `duration_minutes` (computed from the curriculum — one owner),
  `price`, `pricing` (below), `payment_plan { installments, installment_price }` when instalments are offered (Payment
  plan courses only), `featured` (at most one: the storefront's "Most popular"), `updated_at` (sitemap `lastmod`).
- **Pricing models** — `pricing { model, interval, minimum_price }`; checkout honours it exactly
  ([commerce.md](commerce.md) → Pricing models at checkout):

  | `model`             | `price`                        | `interval` | `minimum_price` | The site                                                        |
  | ------------------- | ------------------------------ | ---------- | --------------- | --------------------------------------------------------------- |
  | `one_time`          | the list price                 | `null`     | `null`          | "$99"; checkout or cart                                         |
  | `payment_plan`      | the full price                 | `null`     | `null`          | "$99" + the instalment toggle; checkout or cart                 |
  | `subscription`      | the **monthly** price          | `"month"`  | `null`          | "$35/mo"; "Subscribe" → checkout; never in the cart             |
  | `pay_what_you_want` | the suggested price (≥ min)    | `null`     | the minimum     | "From $10" ("Pay what you want" at a $0 minimum); checkout only |
  | `membership`        | the stored list price (unused) | `null`     | `null`          | "Members only"; links to the membership page; never sold alone  |
  | `free`              | `0`                            | `null`     | `null`          | "Free"; one-click enrol                                         |

- `instructor` is `Person & { slug: string | null }`: with a published instructor profile, the profile's name, photo
  (`avatar_url`) and `slug` (link to `/instructors/{slug}`, [instructors.md](instructors.md)); otherwise the member's
  name, `avatar_url: null`, `slug: null` (no link).
- `categories[].course_count` counts published courses.
- `bundles[]` include `compare_at_price` (sum of the courses) and `savings_percent`, both computed by the API.
- `cover { url, color, alt }` — `url` is the cover uploaded in the dashboard (absolute URL on the platform's public
  image storage / CDN, rendered straight from there — never proxied or cached by the site) or `null`, then `color` is the placeholder. The same `cover`
  appears on cart, checkout and order lines (a product line uses the product's thumbnail).

The catalogue page renders the full list on the server (crawlable); search, category, sort and grid/list view are
client-side and live in the URL. For catalogues beyond a few hundred courses, add `?page=` and server-side filtering.

## `GET /api/v1/courses/{slug}` — tags `t:<slug>:catalog`, `t:<slug>:course:<slug>`

`CourseDetail` = `CourseSummary` + `description` (the school's Markdown from the dashboard's rich text editor, ≤ 6,000
characters, the editor's STANDARD features: `##`/`###` headings, `>` quotes, lists, links, bold/italic, no images; older
values are plain text — the course page renders it with `lib/markdown.tsx`, newlines
kept, its top heading an h3 under "Overview"; JSON-LD uses `markdownToPlain`; `excerpt` is the subtitle or, without
one, the description's plain text on one line cut to 160), `outcomes[]`, `requirements[]`, `audience[]`, `faqs[]`,
`modules[] { id, title, lessons[] { id, title, type, duration_seconds, question_count, free_preview, summary } }`
(non-draft lessons of non-draft modules only; `summary` is the lesson's optional description as Markdown — the dashboard's rich text editor: bold, italic, lists, links; raw HTML stripped on save — up to
1,000 characters, string or null — shown when the outline row is expanded, rendered with `lib/markdown.tsx` (`breaks`,
no images; links get `rel="noopener noreferrer nofollow ugc"`); the builder sets it in the lesson settings as "What you'll learn"),
`instructor_profile`, `guarantee_days`, `certificate`, `community`,
`previews[] { lesson_id, title, type, duration_seconds, poster_url }` (every free-preview lesson: the non-draft
lessons flagged `free_preview` of non-draft modules, in curriculum order; `type` is the learner type; each opens in the
guest preview below), `preview { lesson_id, title, type, poster_url } | null` (kept for older clients: the first of
`previews`),
`reviews[]` (latest first, used for JSON-LD too), `rating_distribution[] { stars, percent }`,
`included_in_plan { plan_id, plan_name, per_month }` (cheapest membership plan that unlocks the course, or null),
`related[]`, `language`, `published_at`.

`instructor_profile { role: "Instructor", bio, student_count, slug, headline, course_count, rating, review_count }` —
filled from the instructor's published profile (`bio` = its plain-text excerpt ≤ 280, `student_count` = its learner
count, the rest its stats, `slug` for the "View profile" link); without one: `bio: ""`, `student_count: 0`,
`slug: null`, `headline: ""`, `course_count: 0`, `rating: null`, `review_count: 0` (show the name only). Details in
[instructors.md](instructors.md).

`404` for unknown or unpublished courses. Lesson **content** is never public — only the outline (and the free-preview
lessons below).

## `GET /api/v1/courses/{slug}/preview[?lesson={id}]` — a free-preview lesson (not cached)

No session needed (a learner session, if any, is ignored — the answer is the same for everyone). Same tenant
resolution and site lock as `GET /courses/{slug}`. `lesson` is one of `previews[].lesson_id`; without it, the first.
The course page opens the preview modal from the card cover ("Preview this course": a play overlay whenever the
course has any free preview, opening the first) and from a "Preview" button on every free-preview curriculum row
(opening that lesson). The modal (`CoursePreviewModal.tsx`, Udemy pattern) shows the chosen lesson's player or viewer
and, with more than one free preview, a "Free previews" list to switch between them (buttons; ↑/↓ move between
them; native modal `<dialog>`: focus stays inside, Esc and the backdrop close it, focus returns to the trigger).

```
200 { data: {
  lesson_id, title,
  type,                              // the learner type (video | pdf | quiz | text | live)
  format,                            // the stored type: video | audio | text | pdf | document | files | external |
                                     //   embed | quiz | assignment | survey | live | scorm | coaching | checkpoint
  duration_seconds: int | null,
  poster_url: string | null,          // = video.poster_url
  video: { hls_url, poster_url, captions[] { lang, label, url }, drm, url, embed_url, watermark: null } | null,
  blocks: LearnerBlock[] | null,     // the lesson's content blocks (learning.md)
  blocks_locked: int,                // blocks withheld after the first continue gate (a guest passes none)
  body_html: string | null,          // the lesson's own Markdown as safe HTML: a text lesson's body (without blocks),
                                     //   an assignment's instructions, a survey's intro, a checkpoint's prompt
  pdf: { url, name, size_bytes, downloadable } | null,      // a PDF lesson: the inline viewer (30-minute URL)
  file: { name, size_bytes, url | null } | null,            // a Document lesson
  link: { url, new_tab } | null,                            // an External lesson
  resources: [{ id, kind: pdf|slides|file, name, size_bytes, url | null }],
  summary: { kind, question_count, pass_percent, time_limit_minutes, attempts_allowed, points, starts_at,
             duration_minutes } | null,                    // quiz, assignment, survey, checkpoint, live, SCORM, coaching
  course: { slug, title }
} }
```

By format, the modal shows:

- **Video / audio / embed** (`video`): the lesson player (`VideoPlayer`, no playback reports), uploaded files on signed
  short-lived URLs (Mux HLS/DRM as for learners), YouTube/Vimeo through their iframe players.
- **Text** (`blocks`, else `body_html`): the published blocks or the legacy Markdown.
- **PDF** (`pdf`): an inline viewer (`<object type="application/pdf">`); a Download button only when `downloadable`,
  else "View only — enrol to download".
- **Document** (`file`): the name and size, with Download only when `url` is set ("Download after you enrol" otherwise).
- **Link** (`link`): an "Open {title}" button (new tab, `noopener`).
- **Quiz, assignment, live, survey, SCORM, checkpoint, coaching** (`summary`): "What's inside" — question count, pass
  mark, time limit, attempts, points, start time and length — with "Enrol to take this." and the enrol button.

- `blocks` stop at the first `continue` gate (every gate is unpassed for a guest; `blocks_locked` counts the rest).
  Interactive blocks carry no answers and `state: null`; the modal lets guests try checks and sorting but shows "Sign in
  and enrol to check your answer." instead of Check (the grading endpoints need a session), and "Enrol to see the rest
  of this lesson." with the `blocks_locked` hint at the gate.
- Only a free-preview lesson of a published public or unlisted course (one `previews` lists). Any other lesson — paid,
  draft, in a draft module, another course's, a malformed or array `lesson` — is the same 404 as a course without
  previews (enrolled learners use `GET /me/lessons/{id}`).
- **Never sent to guests**: quiz questions or answers, check answers or feedback, the blocks after the first continue
  gate, an assignment's brief, rubric or submissions, live meeting/join links or recordings, coaching booking links, a
  SCORM launch.
- **Guest file rule** (PDF stamping needs a learner identity, and a guest has none): a file is downloadable only when
  the course allows downloads **and** it is not a PDF the school stamps. A PDF lesson always opens view-only in the
  inline viewer when stamping is on (an unstamped copy through a 30-minute signed URL — a deterrent, not DRM; a school
  that needs every copy stamped shouldn't flag PDF lessons as free previews); stamped PDFs are never offered as
  downloads (`file` blocks of them are left out; `file.url`/`resources[].url` are null).
- `video` is exactly the lesson's `video` object from `GET /me/lessons/{id}` ([learning.md](learning.md)): same keys,
  same signed URLs and TTLs (Mux HLS/poster/DRM 4 h, source file 4 h, captions), each URL valid for this asset only.
  `watermark` is always `null` — the dynamic watermark names a learner and a guest has no identity; the school chose to
  make this lesson public. Its file is the ready, scanned-clean one, or the previous file while a replacement is being
  processed (the same rule as the lesson player); an infected or missing file with no clean previous file means no
  preview.
- `404 { message: "This course has no preview." }` — unknown, unpublished, private or archived course; no free-preview
  lesson; a `lesson` that isn't one of them; a video, audio or embed lesson with nothing playable. The modal then says
  so instead of a player (no retry) and keeps the list.
- `401 { code: site_locked }` while the site is locked for the visitor (as for the course page) · `429` over 60
  requests/min per IP.
- `Cache-Control: private, no-store` — signed URLs expire, so neither the site nor a CDN may cache it. The site fetches
  it in the browser through the same-origin `/api/v1` proxy only when the modal opens or switches lesson
  (`useCoursePreview(slug, lessonId)`, never kept in the query cache once that lesson is closed), shows the poster with
  a spinner meanwhile and an error with Retry on a network/5xx/429 failure; closing the modal pauses and unloads the
  video.
- Nothing is recorded for guests: no progress, no lesson view, no playback analytics (`POST /me/lessons/{id}/playback`
  stays signed-in only — the guest player sends no reports).

## Course reviews

`POST /api/v1/courses/{slug}/reviews` — signed in, enrolled, once per course.
Body `{ rating: 1..5, body: string ≥ 10 }` → `201 Review`. `403` not enrolled, `422` invalid or already reviewed.
Increments `review_count`; send `t:<slug>:course:<slug>` to the revalidation webhook.
