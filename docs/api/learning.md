# Learning — dashboard, player, progress, quizzes

All endpoints require a session (`401` otherwise).

| Endpoint                                     | Result                                                                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/me/enrollments`                 | `Enrollment[]` — progress `{ completed, total, percent }` (**rounded by the API**), `resume_lesson` (first incomplete, or the first lesson when done), `completed_at` |
| `GET /api/v1/me/dashboard`                   | `Dashboard` — streak, weekly goal, 7-day `activity` (Monday first), `up_next[]`, `recommendation { course, reason }`, `next_event`, `achievements[]`, `purchases[]`   |
| `PUT /api/v1/me/goal`                        | `{ weekly_goal: 1..30 }` → `{ weekly_goal }`                                                                                                                          |
| `GET /api/v1/me/courses/{slug}`              | `PlayerCourse` — sidebar curriculum with per-lesson `completed`; `403` if not enrolled                                                                                |
| `GET /api/v1/me/lessons/{id}`                | `Lesson` — content by type (below), `resources[]`, the learner's `note`, `questions[]` (thread order: oldest first), `next_lesson_id`                                 |
| `POST /api/v1/me/lessons/{id}/complete`      | `{ completed: true, progress }` — `422` for quizzes (pass them instead)                                                                                               |
| `DELETE /api/v1/me/lessons/{id}/complete`    | `{ completed: false, progress }`                                                                                                                                      |
| `POST /api/v1/me/lessons/{id}/quiz-attempts` | `{ answers: [{ question_id, option_id }] }` → `201 QuizResult { score_percent, passed, correct, total }`                                                              |
| `PUT /api/v1/me/lessons/{id}/note`           | `{ body ≤ 10 000 chars }` → `{ body }` (autosaved, debounced by the client)                                                                                           |
| `POST /api/v1/me/lessons/{id}/questions`     | `{ body }` → `201 LessonQuestion`                                                                                                                                     |
| `GET /api/v1/me/certificates`                | `Certificate[]` — see [account.md](account.md)                                                                                                                        |

## Lesson content by type

- `video { hls_url, poster_url, captions[] { lang, label, url } }` — HLS with CENC encryption from the platform
  pipeline, signed URLs, multi-DRM licences (Widevine/FairPlay). The site plays it with Shaka Player (lazy-loaded).
  **Captions are required** (WCAG 2.2).
- `pdf { url, size_bytes }` — signed download URL.
- `quiz { pass_percent, questions[] { id, prompt, options[] { id, label } }, last_result }` —
  **correct answers never leave the server.** Grading, the pass mark and completion happen in the API; every
  question must be answered (`422` otherwise); passing marks the lesson complete.

## Rules the API owns

- Completing the last lesson of a course (or passing its last quiz) **issues a certificate** (idempotent) when the
  plan includes certificates.
- Access: enrolled courses, plus courses unlocked by the learner's membership plan. Free-preview lessons are
  readable without enrolment.
- Progress percentages, streaks, weekly totals and recommendations are computed server-side only.
