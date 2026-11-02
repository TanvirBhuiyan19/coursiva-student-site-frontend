# Learning — dashboard, player, progress, quizzes

All endpoints require a session (`401` otherwise).

| Endpoint                                                                                                                                                                   | Result                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/me/enrollments`                                                                                                                                               | `Enrollment[]` — progress `{ completed, total, percent }` (**rounded by the API**), `resume_lesson` (first incomplete, or the first lesson when done), `completed_at`                                                                                                                                                                                                        |
| `POST /api/v1/me/enrollments`                                                                                                                                              | `{ course_slug }` → `201 Enrollment` for a **free** course (one click from the course page — no checkout, no card); `402` for paid courses, which go through checkout                                                                                                                                                                                                        |
| `GET /api/v1/me/dashboard`                                                                                                                                                 | `Dashboard` — streak, weekly goal, 7-day `activity` (Monday first), `up_next[]`, `recommendation { course, reason }`, `next_event`, `achievements[]`, `purchases[]` (the five latest orders with a receipt — paid, refunded or partially refunded — newest first: `{ order_id, title (first item), created_at, total }`; the table links each invoice and the order history) |
| `PUT /api/v1/me/goal`                                                                                                                                                      | `{ weekly_goal: 1..30 }` → `{ weekly_goal }`                                                                                                                                                                                                                                                                                                                                 |
| `GET /api/v1/me/courses/{slug}`                                                                                                                                            | `PlayerCourse` — sidebar curriculum with per-lesson `completed`, `locked`, `lock_reason`, `unlocks_at`, `after` (see **Availability**); `403` if not enrolled                                                                                                                                                                                                                |
| `GET /api/v1/me/lessons/{id}`                                                                                                                                              | `Lesson` — content by type (below), `resources[]`, the learner's `note`, `questions[]` (thread order: oldest first), `next_lesson_id`                                                                                                                                                                                                                                        |
| `POST /api/v1/me/lessons/{id}/complete`                                                                                                                                    | `{ completed: true, progress }` — only the `manual` completion rule; `422 completion` otherwise (see **Completion rules**)                                                                                                                                                                                                                                                   |
| `DELETE /api/v1/me/lessons/{id}/complete`                                                                                                                                  | `{ completed: false, progress }` — only the `manual` rule (`422 completion` otherwise)                                                                                                                                                                                                                                                                                       |
| `POST /api/v1/me/lessons/{id}/time`                                                                                                                                        | `{ seconds: 1–60 }` → `{ time_spent_sec, completed }` — time heartbeat for the `time` rule; 6/min per learner and lesson                                                                                                                                                                                                                                                     |
| `POST /api/v1/me/lessons/{id}/quiz-attempts`                                                                                                                               | `{ answers: [{ question_id, option_id \| option_ids[] \| text \| blanks[] \| matches[] }] }` → `201 QuizResult` (below); `409` while the last attempt awaits review or attempts are used up                                                                                                                                                                                  |
| `POST /api/v1/me/lessons/{id}/blocks/{blockId}/check\|sort\|continue`                                                                                                      | interactive lesson blocks — grade a knowledge check or a sorting block, pass a continue gate (below)                                                                                                                                                                                                                                                                         |
| `PUT /api/v1/me/lessons/{id}/note`                                                                                                                                         | `{ body ≤ 10 000 chars }` → `{ body }` (autosaved, debounced by the client)                                                                                                                                                                                                                                                                                                  |
| `POST /api/v1/me/lessons/{id}/questions`                                                                                                                                   | `{ body: 3–2,000 chars }` → `201 LessonQuestion` (appended to the thread); `403` free previews, `reason: discussion_off \| muted`; 10/min                                                                                                                                                                                                                                    |
| `POST /api/v1/me/lessons/{id}/submission`                                                                                                                                  | multipart `text` and/or `files[]` (≤ 5) → `201 AssignmentSubmission`; `422` type/size/empty; `409 submission_closed`                                                                                                                                                                                                                                                         |
| `POST /api/v1/me/lessons/{id}/survey`                                                                                                                                      | `{ answers: [{ key, value }] }` → `201 { survey, completed, progress }` — a Survey lesson's answers; `422 answers.{i}` / `answers`, `403`, `404`, `409`, `429` (see **Survey lessons**)                                                                                                                                                                                      |
| `GET /api/v1/me/submissions/{id}/files/{f}`                                                                                                                                | the learner's own file (attachment); `409 reason: file_quarantined` for an infected file                                                                                                                                                                                                                                                                                     |
| `GET\|PUT /api/v1/me/lessons/{id}/scorm`                                                                                                                                   | SCORM / xAPI runtime (below)                                                                                                                                                                                                                                                                                                                                                 |
| `GET /api/v1/me/assignments/{a}/peer-reviews`, `GET /api/v1/me/assignments/{a}/peer-reviews/{r}`, `GET /api/v1/me/assignments/{a}/peer-reviews/{r}/files/{f}`, `PUT …/{r}` | peer review (below)                                                                                                                                                                                                                                                                                                                                                          |
| `GET /api/v1/me/courses/{course}/tutor` + `POST …/messages`, `…/threads/{t}/resolve\|escalate`                                                                             | AI tutor (below)                                                                                                                                                                                                                                                                                                                                                             |
| `GET /api/v1/me/certificates`                                                                                                                                              | `Certificate[]` — see [account.md](account.md)                                                                                                                                                                                                                                                                                                                               |
| `POST /api/v1/me/lessons/{id}/playback`                                                                                                                                    | `{ session, device, segments: [[from, to], …] }` → `200 { completion }` — video analytics (below)                                                                                                                                                                                                                                                                            |

## Lesson content by type

- `body_html: string | null` — the author's Markdown (text lesson body, assignment instructions, survey intro,
  checkpoint prompt) rendered by the API with raw HTML stripped and unsafe links dropped, so the site inserts it as-is.
  Null → show `description` (plain text).
- `blocks: LearnerBlock[] | null` — the lesson's content blocks (course builder v2), null for lessons without a body
  (then `body_html` / `description` apply; `body_html` is not used once a lesson has blocks). Shown in order under the
  lesson's activity (video, quiz, PDF…) by `components/LessonBlocks.tsx`; the free-preview lesson
  (`GET /courses/{slug}/preview`) carries the same `blocks`. Rendered server-side — only `html` is inserted as HTML
  (the `body_html` rules); every other string is plain text. Unknown `type`s are skipped by the site. Each block has
  `id` (`blk_…`) and `type`:
  - `heading { text, level: 2|3 }` (h2/h3 under the lesson's h1) · `text { html }` · `callout { tone:
info|tip|warning|success, html }` · `quote { text, cite, style: plain|large }` · `list { style:
bullet|numbered|check, items[] }` · `divider` · `code { language, code }` (copy button) · `button { label, url
(https), style: primary|secondary }` · `table { header: bool, rows: string[][] }`
  - media (short-lived signed URLs; a block whose asset is gone, not ready or infected is left out): `image { url, alt
("" when decorative), caption, width: normal|wide|full }` · `gallery { items[] { url, alt, caption } }` · `video`
    (the lesson `video` object below + `id`, `type`; no playback reports) · `audio { url, name }` · `pdf { url,
size_bytes, name }` (inline viewer, a link on phones) · `file { url, name, size_bytes, label }`
  - `embed { src, height (200–1,200 px), provider }` — `src` is the API-derived player URL of an allow-listed host,
    framed with `sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"`.
  - interactive (O3; `html` is sanitised Markdown like `text`): `accordion { items[] { title, html } }` (native
    `<details>`) · `tabs { items[] { title, html } }` (WAI-ARIA tabs, arrow keys/Home/End) · `process { items[] { title,
html } }` (one step at a time, Previous/Next + step indicator) · `timeline { items[] { date, title, html } }` (`date`
    free text) · `flashcards { style: grid|stack, cards[] { front, back, image_url } }` (plain-text faces; a card is a
    button — click/Enter/Space flips; `image_url` signed or null) · `hotspots { url, alt, spots[] { x, y, title, html }
}` (`x`/`y` = % of the image; a missing asset leaves the block out) · `sorting { prompt, categories[] { id, label
}, items[] { id, text }, state }` · `check { kind: single|multiple|fill, question_html, options[] { id, text } |
null, required, state }` · `continue { label, passed }` — see **Interactive blocks** below.
- `blocks_locked: int` — blocks withheld after the first continue gate the learner hasn't passed (0 otherwise).
- `link { url, new_tab } | null` — External lessons and Coaching bookings: an https link the site shows as a button
  (`target=_blank` when `new_tab`).
- Embed lessons (YouTube/Vimeo) arrive as a `video` block with only `embed_url` (the iframe player URL).

- `video { hls_url, poster_url, captions[] { lang, label, url }, drm, url, embed_url, watermark }` — `hls_url` /
  `poster_url` are signed Mux URLs (4 h) once transcoded, else null; `url` is the signed source file (the fallback);
  `embed_url` a third-party embed (iframe). The site plays HLS with Shaka Player (lazy-loaded, `shaka-player` HLS
  build), falling back to native HLS. **Captions are required** (WCAG 2.2) and render as `<track>`s.
  - `drm { widevine_license_url, fairplay_license_url, fairplay_certificate_url, playready_license_url } | null` →
    Shaka `drm.servers` (`com.widevine.alpha`, `com.apple.fps`, `com.microsoft.playready`) and
    `drm.advanced['com.apple.fps'].serverCertificateUri` (`src/features/learning/video.ts`).
  - `watermark { text, style, opacity, color, font_size_pct, positions[], interval_seconds, seed } | null` — drawn by the
    player (`components/Watermark.tsx`): `color` at `opacity`, font `font_size_pct`% of the player height,
    `pointer-events: none`, moving through `positions` every `interval_seconds` from `seed % positions.length`, inside
    the element that goes fullscreen (the container, not the `<video>`; native fullscreen and PiP are off while it
    shows), re-added by a MutationObserver if removed. Embeds get it too.
- SCORM, assignment and survey lessons come with `type: "text"` (Laravel's learner types are coarse): the `scorm` /
  `assignment` / `survey` blocks say what they are, and `POST …/complete` is `422` for them.
- `pdf { url, size_bytes }` — signed download URL.
- `quiz { pass_percent, questions[], last_result, attempts_allowed, attempts_used, time_limit_minutes, expires_at }` —
  each question `{ id, type: single_choice|multi_select|true_false|free_text|fill_blanks|matching, prompt, points,
media, options[] { id: "o{n}", label }, multiple, blank_count, prompts[], matches[] }`. `prompt` is the author's
  Markdown (dashboard rich text: bold, italic, code, links, lists; no images; ≤ 6,000; older questions are plain text);
  the player renders it with `lib/markdown.tsx` (newlines kept) and names the question's group by it. A blank is `___`.
  **Correct answers never leave the server.** Grading, the pass mark and completion happen in the API; every
  question must be answered (`422` otherwise); passing marks the lesson complete.
- `QuizResult` (and `last_result`): `{ score_percent, passed, correct, total, pending_points, submitted_at,
review_status: null|pending|reviewed, provisional_percent, feedback, reviewed_at }` (+ `attempt_no`,
  `attempts_left`, optional `results[] { question_id, verdict: correct|incorrect|pending, explanation }` on the attempt
  response when the school reveals answers — the site lists each question's verdict with its `explanation`, Markdown
  like the prompt, ≤ 6,000). An attempt with written (`free_text`) answers is held:
  `review_status: pending`, `score_percent`/`passed` null, `provisional_percent` = the auto-scored part. The site shows
  "Awaiting review" instead of the form; a new attempt meanwhile is `409` "Your last attempt is awaiting review. You can
  try again once it has been graded." Once reviewed, `feedback` and `reviewed_at` are shown with the result (the
  learner also gets a `quiz_reviewed` bell notification).
- `scorm { launch_url, standard, state } | null` — `state { completion_status, success_status, score_scaled,
total_seconds, completed } | null` (null before the first launch).
- `assignment` (an assignment lesson) — `{ id, title, brief, points, due_at, due_kind: module_gate|end_of_course|weekly,
due_weekday (0 = Sunday), review_mode, peer_review, late_policy: accepted|accepted_flagged|rejected, attempts,
file_types[], max_file_mb, max_files, gates_next_module, rubric[] { label, hint, max }, submission, can_submit }`.
  `due_at` is **this learner's** deadline (weekly assignments roll per learner from their enrolment). `peer_review` is
  null unless `review_mode: peer_instructor`, else `{ required, assigned, completed, next_due_at }`. `submission`:
  `{ id, status: needs_grading|graded|resubmit, attempt, submitted_at, late_by_days, text, files[] { id, name, ext,
size_kb, scan_status: pending|clean|infected|skipped|error }, grade { points, max_points, percent, feedback,
graded_at } | null, resubmit_feedback, peer_feedback[] { scores[] { label, score, max }, percent, comment,
submitted_at } }` — `peer_feedback` is anonymous and only filled once graded. An `infected` file is shown as
  quarantined, never as a download link.
- `survey` (a Survey lesson with a linked form; null for other lessons, in previews, and for a Survey lesson without a
  form or whose form asks nothing but `email`) — `{ form_id, title, fields[] { key, label, required, type:
text|long_text|email|phone|number|choice|checkbox|rating, options[] }, allow_resubmit, can_submit, response }`. See
  **Survey lessons**.
- School-written Markdown (the dashboard's rich text editor; older values are plain text, so single newlines are kept
  as line breaks): `assignment.brief`, `submission.grade.feedback`, `submission.resubmit_feedback` and the quiz
  `feedback` are rendered with `lib/markdown.tsx` (no images). A lesson's text body, assignment instructions, survey
  intro and checkpoint prompt arrive as `body_html` (the API's safe HTML of the same Markdown).

## Interactive blocks — checks, sorting, continue gates

**Answers never reach the browser before the learner answers**: grading is server-side, and content behind an unpassed
continue gate is not sent at all.

- `sorting` — `items` come in a stable per-learner shuffled order and carry **no category**. `state` is null, or the
  last attempt's `{ correct, results, answer: { placements } }` (`results` maps item id → bool; the site restores the
  board from `placements` with each item's verdict until Try again).
- `check` — **no correct options, accepted answers or feedback** in the payload. `state` is null until answered, then
  `{ answer, correct, correct_option_ids, feedback }` with `answer` the last request body (`{ option_ids }` or
  `{ text }`). `required` checks must be answered (right or wrong) before the next gate opens.
- `continue { label, passed }` — the lesson stops at the first gate with `passed: false`; `blocks_locked` counts what
  follows (the site shows "N more blocks after you continue" at the gate). Passed gates render nothing.
- Ids (`blk_…` blocks; option, category and item ids `[a-z0-9]{1,12}`) — item ids are object keys in `placements` /
  `results`, which the client's snake/camel conversion leaves unchanged.

Endpoints (enrolled learner with access to the lesson — the `GET /me/lessons/{id}` rules, same `404`/`403`; throttled
60/min per learner each, `429`):

| Endpoint                                                | Body → result                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /me/lessons/{lessonId}/blocks/{blockId}/check`    | `{ option_ids?: string[], text?: string ≤ 200 }` → `{ correct, correct_option_ids, feedback }` (`correct_option_ids` empty for fill; `feedback` plain text or null). `422` when `option_ids` aren't the block's options (single: exactly 1) or fill `text` is empty. Latest answer stored, attempts counted, unlimited retries. |
| `POST /me/lessons/{lessonId}/blocks/{blockId}/sort`     | `{ placements: { [item_id]: category_id } }` — every item exactly once, else `422` → `{ correct, results: { [item_id]: bool } }`. Stored like a check.                                                                                                                                                                          |
| `POST /me/lessons/{lessonId}/blocks/{blockId}/continue` | → `{ passed: true }` (idempotent); `422 { message: "Answer the questions above first.", code: "validation_failed", errors: { required: [same] } }` while a `required` check between the previous gate (or the start) and this one has no answer. The next `GET` includes the blocks up to the next gate.                        |

Unknown block ids, the wrong block type, and blocks behind a gate the learner hasn't passed are `404`. Only learners with
access to the lesson through their enrolment may answer: a signed-in learner who isn't enrolled sees a free-preview lesson's
checks but gets `403` on these POSTs (show the enrol prompt, as for guests). Feedback is plain text. Fill answers
match trimmed, case-insensitive, with inner whitespace collapsed.

The site (`components/InteractiveBlocks.tsx`, hooks `useCheckBlock` / `useSortBlock` / `useContinueBlock` in
`api.ts`): Check shows the verdict, feedback and the correct options, then Try again; a check/sort answer is patched
into the cached lesson; Continue shows a `422` message under the button and, on success, refetches the lesson. Sorting
works by drag and drop and, without a pointer, with a category menu per item. In the guest course preview (no
session) checks and sorting can be tried but show "Sign in and enrol to check your answer." instead of Check, and the
first gate ends the content.

## Availability — locked lessons (course builder v2 O4)

The API decides every lock (Laravel `LessonAccess`, Go learning access); the site only explains it.

- Outline lessons (`GET /me/courses/{slug}`) carry `locked`, `lock_reason` (null when open), `unlocks_at` (ISO or null)
  and `after` (`{ id, title }` or null). `GET /me/lessons/{id}` (and every lesson endpoint) on a locked lesson answers
  `403 { message, code: "lesson_locked", reason, unlocks_at, after }` — `ApiError.details` holds the whole body.
- Reasons: `drip` (days after enrolment; `unlocks_at` = start of the enrolment day in the school's time zone + N days)
  · `date` (`unlocks_at` = the author's instant) · `after_item` (`after` = the lesson or module to complete first)
  · `previous_module` · `previous_lesson` · `prerequisite` · `assignment_gate`. Completed lessons always stay open.
- The site (`availability.ts`, `components/LessonStatus.tsx`): a padlock in the outline with one line under the
  title, and a locked screen instead of the lesson — `date` "Opens on {date, time}" (the school's `time_zone` from `GET /site`, e.g. "Nov 10, 2026, 1:00 AM PST"; the viewer's zone when absent — `f.schoolDateTime`),
  `drip` "Opens in N days" / "Opens tomorrow" / "Opens later today" (calendar days to `unlocks_at`), `after_item`
  "Complete “{title}” first" (with a "Go to “{title}”" link when `after` is a lesson of the course), the other reasons
  their own sentence, unknown reasons "This lesson isn’t available yet.". Resuming a course skips locked lessons.

## Completion rules (O4)

`completion: { rule, value, progress, done }` on `GET /me/lessons/{id}` (absent from older APIs — then quizzes, SCORM
and assignments complete themselves and everything else has the Complete button):

| `rule`       | `value`     | completes when                                       | `progress` (0–100) |
| ------------ | ----------- | ---------------------------------------------------- | ------------------ |
| `manual`     | null        | the learner presses Complete                         | null               |
| `video`      | 50–100 (%)  | the watched share (union of played segments) ≥ value | watched share      |
| `time`       | 1–120 (min) | time on the lesson (heartbeats) ≥ value              | time share         |
| `quiz`       | null        | the quiz is passed                                   | null               |
| `assignment` | null        | the submission is graded                             | null               |
| `checks`     | null        | every `check` block has an answer                    | answered share     |
| `live`       | null        | the learner attended the linked live session         | null               |
| `scorm`      | null        | the package reports completed/passed                 | null               |
| `survey`     | null        | the learner submits the lesson's survey              | null               |

- Only `manual` has the Complete / un-complete button. Other rules answer `POST`/`DELETE …/complete` with
  `422 { errors: { completion: ["This lesson completes on its own when …."] } }` — the player shows the message under
  the button (for an API that disagrees with the lesson payload).
- Other rules show their sentence and, when `progress` isn't null, a bar: "Watch 80% of the video to complete — 45% so
  far", "Spend 10 minutes on this lesson — 4 min so far" (minutes = `progress` × `value`), "Answer every knowledge check
  — 2 of 3" (counted from the lesson's check blocks; "N answered so far" while a gate withholds blocks), "Pass the
  quiz", "Your assignment completes when it’s graded", "Attend the live session", "Finish the SCORM activity", "Answer
  the survey to complete this lesson"; done →
  "✓ Completed".
- **Time heartbeat** (`heartbeat.ts`, only for `rule: time` and not done): while the page is visible
  (`visibilityState === 'visible'`) and the window has focus, `POST /me/lessons/{id}/time { seconds }` every 15 s with
  the visible seconds since the last beat (≤ 60; at least 10 s between beats), once more with `fetch` keepalive when the
  page is hidden, left (`pagehide`) or the lesson unmounts. `{ time_spent_sec, completed }` updates the bar; a beat that
  completed the lesson refreshes the sidebar, enrolments, dashboard and certificates like Complete does. `403`/`404`/
  `422` stop the beats; `429` and network errors are dropped. The API caps the total at 10× the rule's minutes.
- **Video rule**: `POST …/playback` answers `200 { data: { completion } }` (the completion after the report); the
  player puts it into the cached lesson. From an older API's `204` it re-reads `GET /me/lessons/{id}` instead and patches
  only `completion`/`completed` (the signed video URLs stay as they are, so playback isn't reloaded).
- **Checks rule**: after a check answer the player re-reads the completion the same way.
- Existing completions are never revoked by a rule change.

## Live lessons (O4)

`live: { session_id, title, starts_at, duration_min, provider: zoom|google_meet|teams|built_in, status:
scheduled|live|ended, join_url, recording }` on a Live lesson (null otherwise). `join_url` is set only while the
session is joinable (the live join rules); `recording` is the published recording as a `video` object (null until
published). The player (`LiveLesson`): title, date/time (the school's time zone, else the viewer's) and duration, provider, status, a
"Starts in …" countdown before the start, **Join** (`target=_blank`, `rel=noopener noreferrer`) while `join_url` is
set — near the start (20 min) or while live without a link, the lesson is re-read every minute — and the recording in
the site's video player (no playback reports).

## Survey lessons

A Survey lesson links a Forms & leads form; learners answer it in the player, under the lesson's intro (`body_html`).
Its default completion rule is `survey` (submitting completes the lesson; `POST …/complete` is `422` "This lesson
completes on its own when you submit the survey.").

- `survey { form_id, title, fields[], allow_resubmit, can_submit, response }` on `GET /me/lessons/{id}`:
  - `fields[] { key, label, required, type, options[] }` — every field of the form except `email` (the account says who
    answered). `type`: `text` · `long_text` · `email` · `phone` · `number` · `choice` (one of `options`) · `checkbox` ·
    `rating` (1–5); `options` is `[]` except for `choice`.
  - `can_submit` — enrolled and (no response yet, or `allow_resubmit`).
  - `response { answers[] { key, label, type, value }, submissions, submitted_at } | null` — the stored answers, one per
    question in form order (labels as they were when answered; `value` null when unanswered); `submissions` counts
    re-submits.
- `POST /me/lessons/{id}/survey` `{ answers: [{ key, value }] }` (≤ 50; unanswered = omitted or null) →
  `201 { data: { survey, completed, progress { completed, total, percent } } }` — the new `survey` block, whether the
  lesson completed (the `survey` rule) and the course progress. Re-submitting (with `allow_resubmit`) replaces the
  response.
  - Values: `text`/`long_text`/`email`/`phone` → string (trimmed; ≤ 500 / 5,000 / 254 / 40 characters); `number` →
    number (a numeric string is accepted); `choice` → one of `options`; `checkbox` → `true`/`false` (`false` doesn't
    count as an answer; a required checkbox must be `true`); `rating` → integer 1–5.
  - `422` keyed `answers.{i}` (`i` = the question's index in `survey.fields`): "This question needs an answer.",
    "Choose a rating from 1 to 5.", "Enter a valid email address.", "Enter a valid phone number.", "Enter a number.",
    "Choose one of the options.", "Answer yes or no.", "This answer must be text.", "This answer must not be longer than
    {max} characters."; or keyed `answers`: "Answer at least one question.", "The answers field must be a list of at most
    50 answers.".
  - `403` not enrolled / lesson locked (`lesson_locked`); `404` "This lesson has no survey."; `409 conflict` "You’ve
    already answered this survey." (answered and `allow_resubmit` off); `429` throttled.
- The player (`components/SurveyPanel.tsx`, `survey.ts`): one labelled input per type (radio groups with a legend for
  `choice` and the 1–5 `rating`), required questions marked, the API's checks repeated in the browser, `422`s shown
  under their question (`aria-invalid` + `aria-describedby`) and `answers` above the button. After sending: "Your
  answers" (read-only, with the submitted date) and, with `allow_resubmit` and `can_submit`, "Edit your answers"
  (pre-filled). A `409` reloads the lesson and shows the stored answers. Nothing is shown when `can_submit` is false and
  there is no response.

## Rules the API owns

- Completing the last lesson of a course (or passing its last quiz) **issues a certificate** (idempotent) when the
  plan includes certificates.
- Access: enrolled courses, plus courses unlocked by the learner's membership plan. Free-preview lessons are
  readable without enrolment by any signed-in learner (`GET /me/lessons/{id}`, read-only). Signed-out visitors play
  the course's preview video through `GET /api/v1/courses/{slug}/preview` (no session; same `video` object, no
  watermark — see [catalog.md](catalog.md)).
- Progress percentages, streaks, weekly totals and recommendations are computed server-side only.
- `Dashboard.next_event` is a `LiveEvent` (as in [community.md](community.md): `going`, `attendees`, personal
  `join_url` once RSVP'd) or `null`: the learner's next live session that is on now or still to come — not ended, and
  either started or due to finish after now — from the courses they are enrolled in (active or completed) and the
  community spaces they can read. The dashboard shows it as the live banner (RSVP, add to calendar, join).
- `player.community_space` is the course's unarchived community space (`{ id, name }`, "Discuss in …"), or `null`
  when there is none or the school's plan has no community.

## Video playback reports

`POST /api/v1/me/lessons/{id}/playback` — signed-in learner (Sanctum session + `X-XSRF-TOKEN`, like every learner
POST), throttled to 120/min.

```json
{
  "session": "b6f1c7e2-6d1f-4c3e-9a51-0f1e2d3c4b5a",
  "device": "web",
  "segments": [
    [0, 14.5],
    [10, 20]
  ]
}
```

- `session`: 8–64 chars `[A-Za-z0-9-]`, one per player mount and lesson (`crypto.randomUUID()`). One session = one play.
- `device`: `web | tablet | app` (nullable → `web`). The site sends `tablet` for iPads (including iPadOS's desktop UA)
  and Android tablets, `web` otherwise; `app` is for the mobile app.
- `segments`: ≤ 50 `[from, to]` pairs in seconds of media time, each within 0–86 400. Ranges that overlap earlier ones
  are **rewatches** and are kept as separate segments (the client only joins segments that touch, e.g. pause → play at
  the same spot). Empty ranges are dropped.
- `200 { data: { completion } }` on success (the lesson's completion after the report — see **Completion rules**; older
  APIs answered `204`) · `401` signed out · `403` a lesson the learner can't open (not enrolled, locked) · `404` unknown
  lesson or not a video · `422` bad body · `429` throttled.
- The API merges ranges per session, counts re-played seconds as rewatches, and caps the new seconds credited per learner
  and lesson (across all of their sessions) to the wall-clock time since their previous report on the lesson (or since
  they opened it) + 30 s, so neither fast reports nor fresh session ids can inflate the figures. A report before the
  learner ever opened the lesson credits 0 s. Figures are keyed by lesson id.

**What the player sends** (`src/features/learning/playback.ts`, used by `VideoPlayer`): while a video lesson plays it
tracks the played ranges from the `<video>` element's `playing`/`timeupdate`/`seeking`/`seeked`/`pause`/`ended` events
(a range opens when playback runs and closes on pause, seek or end; a backwards or > 10 s jump between `timeupdate`s
counts as an unseen seek). It flushes every 15 s while playing, on pause/end, on `visibilitychange` → hidden and on
`pagehide`/unmount (the last two with `fetch` `keepalive`). Reports are best effort: failures are dropped silently, and
a `403`/`404` stops reporting for that mount. Only lessons of type `video` played in the site's own `<video>` element
are reported — third-party embeds (YouTube/Vimeo iframes) expose no playhead and are never reported (the player has
none today).

## SCORM & xAPI runtime

See the backend's `docs/scorm.md`. The site (`components/ScormPlayer.tsx`, lazy-loaded; `scorm/runtime.ts`):

- `GET /me/lessons/{id}/scorm` → `{ launch_url, standard, runtime: scorm12|scorm2004|tincan|cmi5, version, tracking, cmi,
state }` — counts a launch, so the site fetches it once per mount. **`cmi` is keyed by element name**
  (`"cmi.core.lesson_status"`): it is read and committed with `api.raw` (no case conversion).
- SCORM 1.2 gets `window.API`, 2004 `window.API_1484_11`, installed before the iframe's `src` is set. `GetValue` reads
  the `cmi` map (`_count` from stored `cmi.interactions.n.*` / `cmi.objectives.n.*`, `_children` from the standard
  lists); `SetValue` enforces read-only / write-only / unknown elements with the standard error codes and buffers.
- `PUT /me/lessons/{id}/scorm { cmi: { changed elements }, finish? }` → `{ completed, progress, state }` on `Commit`,
  every 30 s, and with `finish: true` on `LMSFinish`/`Terminate`, `pagehide` and leaving the lesson (`keepalive`).
  ≤ 500 elements per request (larger buffers are chunked). LMS-owned elements are ignored by the API.
- xAPI (Tin Can / cmi5): `launch_url` carries the LRS parameters; the package talks to `/api/v1/xapi/*` itself. The
  player refreshes the lesson (completion) every minute and on leaving.
- Package files are served only on the school's own hosts (through the site's proxy, which forwards the host); any
  other host gets 404. When the platform sets `SCORM_CONTENT_ORIGIN`, `launch_url` is absolute on that origin instead.
- Content tokens last 4 h: after 3 h 45 min the player offers "Relaunch" (commit, then a fresh `GET …/scorm`; the
  package resumes from its saved data).
- The mock serves a demo SCO per runtime from `/api/v1/files/scorm/{token}/index.html` and a minimal LRS
  (`POST xapi/fetch/{token}`, `POST xapi/statements`).

## Peer review

- `GET /me/assignments/{a}/peer-reviews` → `{ assignment { id, title, review_mode, rubric[] { id, label, hint, max } },
progress, reviews[] }`.
- `GET …/peer-reviews/{r}` → `PeerReview { id, assignment_id, status: assigned|submitted|missed, assigned_at, due_at,
submitted_at, can_submit, rubric[], work { text, files[], submitted_at }, scores[] { criterion_id, score }, percent,
comment }` — anonymous both ways.
- `PUT …/peer-reviews/{r} { scores: [{ criterion_id, score }], comment ≤ 5,000 }` → `PeerReview`; `422 scores` "Score
  every rubric row first."; `409 submission_closed` after the review's `due_at`.
- `GET …/peer-reviews/{r}/files/{f}` → the work's file (attachment; `409 file_quarantined` when infected).
- The player shows the reviews inside the assignment lesson (the `peer_review_*` notifications link there).

## AI tutor

See the backend's `docs/ai-studio.md`. Shown in the player only when `GET /me/courses/{course}/tutor` says
`enabled: true` (the panel is lazy-loaded).

- `GET …/tutor` → `{ enabled, handoff, threads[] }`; thread `{ id, course_id, lesson_id, title, status:
open|resolved|escalated, escalated_at, resolved_at, created_at, updated_at, messages[] { id, role: student|tutor,
text, lesson_id, created_at } }`. `403` without an enrolment.
- `POST …/tutor/messages { text ≤ 2,000, lesson_id?, thread_id? }` → `201 { reply, covered, can_escalate, thread }`.
  `covered: false` → the site says the material doesn't cover it and, with `can_escalate`, offers "Ask the team".
  `409 { reason: tutor_resting }` "The tutor is resting for this month." (the school's AI cap); `429` after 30 questions
  an hour.
- `POST …/threads/{t}/resolve` → thread; `POST …/threads/{t}/escalate { text? }` → thread (`409 reason: handoff_off |
already_escalated`).

## Errors with a reason

Laravel's API errors carry `{ message, code, …details }`; `ApiError` exposes `code` and `reason` (e.g.
`file_quarantined`, `tutor_resting`, `discussion_off`).

## Staff preview (O7)

The course builder frames this site's real player at `/preview/{token}` for a member checking a course (the token is
made by the dashboard's `POST /courses/{id}/preview-sessions`; full rules in tenant-dashboard `docs/api/courses.md` →
"Preview as a learner"). The token is the only credential — no learner session, no cookies set, nothing recorded.

| Method | Path                                                                | Answer                                                                                                                                                    |
| ------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/preview/{token}`                                           | `{ data: { course, simulation: { now, day, content }, expires_at } }` — the learner course shape with lock fields for the simulated learner.              |
| GET    | `/api/v1/preview/{token}/lessons/{lessonId}`                        | The `GET /me/lessons/{id}` shape plus `preview_lock: { reason, unlocks_at, text } \| null` (locked lessons stay viewable). Quiz/assignment: no questions. |
| POST   | `/api/v1/preview/{token}/lessons/{lessonId}/blocks/{blockId}/check` | As the learner check, graded statelessly (nothing stored). 60/min per token.                                                                              |
| POST   | `/api/v1/preview/{token}/lessons/{lessonId}/blocks/{blockId}/sort`  | As the learner sort, graded statelessly.                                                                                                                  |

Unknown or expired token → `404` "This preview has expired — open it again from the builder.". Answers carry
`Cache-Control: no-store` and `X-Robots-Tag: noindex`, never set a cookie and need no session or CSRF token (the token
in the path is the only credential; mutations are graded statelessly, so there is nothing to forge). The preview API
ignores the school's site lock (the token authenticates staff); this page may still show the lock screen for now — a
known gap. Answers also carry `Referrer-Policy: no-referrer`; a lesson answer adds `draft`; throttles: check and sort
together 60/min per token, the two GETs 120/min per token.

Payload details (types: `PreviewSession`, `PreviewCourse`, `PreviewLesson`, `PreviewLock` in
`src/features/learning/types.ts`):

- `simulation`: `{ now (ISO, the simulated "now"), day (0–365, days since the virtual enrolment), content: working |
published }`. Locks are O4's rules for that virtual learner with **no lessons completed** (drip from the enrolment
  day, dates as of `now`, after-item), `completed: false` and `progress` 0 everywhere, `community_space: null`.
- Outline lessons and modules may carry `draft: true` — only in `working` mode (drafts are never in `published`, nor
  in any learner endpoint).
- The lesson: every block is sent (`blocks_locked: 0`; `continue` blocks come with `passed: false` and the site opens
  them in the browser — the learner rule: every `required` check since the previous gate answered in this preview,
  else "Answer the questions above first."). No `state` on checks/sorting, `note: ""`, `questions: []`, `quiz` with
  `questions: []` and no result, `assignment` with `submission: null`, `can_submit: false`, `peer_review: null`;
  `survey: null`; `completion` with `done: false`; media/resources as signed URLs (never a `/me/…` path); no watermark.
- `preview_lock.text` is the learner's sentence as of the simulated now ("Opens in 14 days", "Opens on Nov 10, 2026,
  1:00 AM PST", "Complete “Launch-day checklist” first"); the site shows "Learners can’t open this yet — {text}".
- `POST …/check|sort`: the learner bodies, validation and answers (`422`, unknown block `404`), `429` past 60/min per
  token (check and sort together). There is no `continue` endpoint.

**The site** (`app/[tenant]/[locale]/preview/[token]`, `components/PreviewPlayer.tsx`): `/preview/{token}?lesson={id}`
(no `lesson` → the first lesson) renders the real player server-side from these reads (`features/learning/server.ts`,
uncached) — the outline (`Sidebar`), video, live, PDF, blocks and interactive checks — under a top bar "Preview · Day
{n} · Working copy / Published" with the expiry and a note in place of the account UI (site header, footer, tab bar and
cookie banner are hidden). A dead token renders the "Preview expired" page (404). Inside `PreviewProvider`
(`previewContext.tsx`): links stay in `/preview/{token}…` (button blocks open a new tab), `usePlaybackReport` and
`useLessonTime` send nothing, checks/sorting post to the preview API, continue gates open client-side, quiz and
assignment lessons show their intro and "Quizzes and assignments can’t be taken in preview.", SCORM isn't launched, and
`lib/api/client.ts` refuses every non-preview request on a preview page (preview requests go with `credentials:
'omit'`, without the CSRF handshake). Only the unprefixed `/preview/…` exists (a language prefix 308s to it); it is not
counted as a page view and is listed in `robots.txt` `Disallow`.

**Headers**: pages get `frame-ancestors 'none'` + `X-Frame-Options: DENY`; `/preview/*` instead gets
`Content-Security-Policy: frame-ancestors {DASHBOARD_ORIGIN}` (set by the proxy from env; unset → the local dashboard in
development, `'none'` in production), `Referrer-Policy: no-referrer` (+ the `referrer` meta) and `X-Robots-Tag:
noindex, nofollow` (+ `robots` meta). See `src/lib/securityHeaders.ts`.

**Mock**: tokens `pv_launchlab_working_day0_demo_000000000000` (Amplify's Launch Lab, working copy, day 0, with a draft
lesson `les_l_draft_0`), `pv_launchlab_published_day15_demo_00000000` (published, day 15) and the expired
`pv_launchlab_expired_demo_0000000000000000` — e.g. http://amplify.localhost:3000/preview/pv_launchlab_working_day0_demo_000000000000.
