# Community

`404` on every endpoint when the tenant's plan lacks community.

| Endpoint                                                 | Auth    | Result                                                                                                  |
| -------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/community`                                  | —       | `CommunityOverview { name, member_count, online_count, guidelines, spaces[], leaderboard[], events[] }` |
| `GET /api/v1/community/posts?space=&sort=new\|top&page=` | —       | paginated `Post[]`; `403` (with the reason) for a locked space                                          |
| `POST /api/v1/community/posts`                           | learner | `{ space_id, body ≤ 5000 }` → `201 Post`; `403` locked, `422`                                           |
| `PUT/DELETE /api/v1/community/posts/{id}/like`           | learner | `Post` (idempotent)                                                                                     |
| `PUT/DELETE /api/v1/community/events/{id}/rsvp`          | learner | `LiveEvent`                                                                                             |

- **Space access is computed per learner by the API** (`locked`, `locked_reason`): `course` spaces need an
  enrolment, `paid` spaces need the top plan, `cohort` spaces need cohort membership. `sp_all` ("All posts")
  aggregates the spaces the learner can read.
- `LiveEvent.provider` is `zoom | google_meet | teams | built_in`; `join_url` is the learner's personal join link
  (BYO provider via the tenant's OAuth connection) or the in-browser room, `null` for guests.
