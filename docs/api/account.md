# Account — profile, notifications, certificates, support, content

| Endpoint                                     | Auth    | Result                                                                                                                                     |
| -------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/me/profile`                     | learner | `Profile` — details, `timezones[]` to pick from, `card`, `membership`, `preferences`                                                       |
| `PATCH /api/v1/me/profile`                   | learner | `{ name, email, bio ≤ 500, timezone, website }` → `Profile`; `422`                                                                         |
| `PUT /api/v1/me/password`                    | learner | `{ current_password, password ≥ 8 }` → `{ updated }`; `422`                                                                                |
| `PUT /api/v1/me/preferences`                 | learner | `{ new_lessons, community_replies, live_reminders }` → `Preferences`                                                                       |
| `GET /api/v1/me/billing-portal?return=`      | learner | `302` to the payment provider's billing portal (Stripe Customer Portal), back to `return`                                                  |
| `GET /api/v1/me/export`                      | learner | GDPR export of everything held about the learner in this school (JSON attachment)                                                          |
| `GET /api/v1/me/notifications`               | learner | `Notification[]` newest first                                                                                                              |
| `POST /api/v1/me/notifications/read-all`     | learner | `{ read: true }`                                                                                                                           |
| `GET /api/v1/me/certificates`                | learner | `Certificate[]`                                                                                                                            |
| `GET /api/v1/help`                           | —       | `HelpCategory[]` (cached, `t:<slug>:content`)                                                                                              |
| `GET /api/v1/legal/{refund\|privacy\|terms}` | —       | `LegalDocument` (cached, `t:<slug>:content`)                                                                                               |
| `POST /api/v1/support/tickets`               | —       | `{ topic: access\|billing\|refund\|certificate\|other, message ≥ 10, email }` → `201 { id }` (email comes from the session when signed in) |

## Certificates

Issued by the **platform registry**, so a credential stays verifiable if the school closes, rebrands or is
suspended. `verify_url` is `https://verify.coursiva.io/<id>`; `linked_in_url` is a pre-filled "Add to profile"
link; `pdf_url` downloads the certificate PDF.
