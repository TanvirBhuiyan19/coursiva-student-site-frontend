# Lead forms — public API, hosted page, embeds

A school builds lead forms in its dashboard (Students → Forms & leads). The learner site shows them in three places,
all rendering the same component (`src/features/forms/components/LeadForm.tsx`):

| Where                         | URL (school host)                           | Notes                                                                  |
| ----------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| Hosted page                   | `/forms/{id}`                               | School chrome, normal page headers, `noindex`                          |
| Embed frame                   | `/embed/forms/{id}?origin=…&page=…`         | Framable by **any** site, `noindex`, no chrome, transparent background |
| Embed script                  | `/embed/forms.js`                           | Plain JS for other websites; cacheable 1 h                             |
| Site-builder `lead_form` kind | any builder page (see [pages.md](pages.md)) | A `form` section set to a lead form (`opt.lead_form`); rendered inline |

Types: `src/features/forms/types.ts`. Executable contract: `mock-api/routes/forms.ts` + `mock-api/forms.test.ts`.

## Public API

Base `/api/v1`, school host (the browser goes through the site's proxy, which adds `X-Tenant`). **No sign-in, no
cookies, no CSRF**: the site calls these with `credentials: 'omit'` and without the Sanctum handshake (in the embed
frame the school's cookies are third-party and usually blocked) — the routes must be CSRF-exempt and answer
`Access-Control-Allow-Origin: *` (no credentials). The signed form token is the proof.

Request bodies and 422 `errors` keys are **not** case-converted by the site: `values` is keyed by field keys (data),
and errors come back as `values.{key}`. Field keys are sent and expected exactly as the API wrote them.

### Form token

`payload.sig` — `payload` = base64url-no-pad(`"{form_id}:{issued_unix}:{nonce 16 hex}"`), `sig` = first 32 hex of
HMAC-SHA256(payload, `"form-token|{tenant_id}|{APP_KEY}"`). Valid 24 h, minted by `GET`. Invalid / expired / another
form's token → `422 { errors: { token: ["This form has expired. Reload the page and try again."] } }`.

### `GET /forms/{id}` → `200 { data: PublicForm }`

`Cache-Control: private, no-store`. `404 { message: "Form not found." }` for unknown or paused forms. Throttle 60/min/IP.

```
PublicForm { id, name, title, description, submit_label (default "Submit"), success_message (default
  "Thanks! We got your submission."), redirect_url: string|null, fields: FormField[], turnstile_site_key: string|null,
  double_opt_in: boolean, min_fill_seconds: number, token: string }

FormField { key, label, required: boolean,
  type: 'text'|'long_text'|'email'|'phone'|'number'|'choice'|'checkbox'|'rating'|'date'|'url'|'hidden'|'consent'|'file',
  options: string[],              // choice only, else []
  placeholder: string, help: string,   // '' = none
  rules: { min: number|null, max: number|null, pattern: null|'letters'|'digits'|'alphanumeric'|'no_links' },
  show_if: { field: string, equals: string } | null,     // an EARLIER field
  prefill: { source: 'utm_source'|'utm_medium'|'utm_campaign'|'utm_term'|'utm_content'|'ref'|'query'|'static'
             |'page_url'|'referrer', param: string } | null,   // hidden only; `static` comes with param ''
  consent: { text: string, version: string } | null,    // consent only (always required)
  file: { accept: FileKind[], max_mb: number } | null }  // file only
FileKind = 'image'|'pdf'|'document'|'spreadsheet'|'presentation'|'audio'|'video'|'archive'
```

Every key is always present. The site renders all types: `hidden` fields are never shown (their values come from
`prefill`), `consent` shows its `consent.text` beside a checkbox, `rating` is five stars (1–5), `file` uploads on
choose.

### `POST /forms/{id}/views` `{ token }` → `204`

Sent once per mount of the form. Deduplicated per visitor and UTC day; bots / empty user agents → `204` uncounted.
Throttle 120/min/IP. Invalid token → the token 422.

### `POST /forms/{id}/uploads` (multipart `token`, `field`, `file`) → `201 { data: { id, name, size_bytes } }`

Throttle 10/min/IP + 300/h per form + 30/h per form and IP. Uploads count against the school's storage quota.
Errors (422):

| Key     | Message                                                | When                                                     |
| ------- | ------------------------------------------------------ | -------------------------------------------------------- |
| `token` | This form has expired. Reload the page and try again.  | bad token (no minimum fill check here)                   |
| `field` | This form has no such file field.                      | `field` isn't a `file` field of the form                 |
| `file`  | Upload a file.                                         | no / empty file                                          |
| `file`  | This file type isn't allowed.                          | extension not in `accept`, or first bytes don't match it |
| `file`  | The file must not be larger than {max_mb} MB.          | too big                                                  |
| `file`  | This form can't take files right now. Try again later. | the school is at its storage limit                       |

Extensions per kind (lower-cased last extension; the API also checks magic bytes): image `jpg jpeg png gif webp heic` ·
pdf `pdf` · document `docx doc odt rtf txt` · spreadsheet `xlsx xls ods csv` · presentation `pptx ppt odp` ·
audio `mp3 m4a wav ogg` · video `mp4 mov webm` · archive `zip`. The site checks extension and size before uploading
(same messages), shows name / size / progress, and can cancel or remove the file. The returned `id` is the field's
value. Unused uploads are pruned after 24 h. Each upload belongs to one submission: a second submit naming an upload
another submission claimed (a double click, a second tab) is refused with 422 `values.{key}` "Upload the file again."
and nothing is stored.

### `POST /forms/{id}/submissions` (JSON) → `201`

```
{ token, values: { [field key]: string|number|boolean|null }, website: '' /* honeypot */, turnstile_token?,
  page_url, referrer, tracking? /* pixels; ignored by forms */ }
```

What the site sends: skipped fields (`show_if` not met) `null`; checkbox / consent booleans; rating a number 1–5; file
the upload id; empty answers `null`; everything else the trimmed string. `page_url` / `referrer` are the hosted page's
`location.href` / `document.referrer`, or in the embed the embedding page's URL / referrer. The body is built in one
function (`buildSubmissionBody` in `src/features/forms/logic.ts`) so the pixels integration can add `tracking`.

Checks, in order: 404 form → token (422 `token`) → honeypot `website` non-empty → **201 like a success with
`submission_id: null`, nothing stored** → faster than `min_fill_seconds` since the token was issued → 422 `token`
"That was quick! Please wait a moment and submit again." → Turnstile on and token missing/failed → 422
`turnstile_token` "Complete the anti-spam check and try again." → answers. Throttle 10/min + 50/h per IP,
600/h per form → 429.

Answers (422 keyed `values.{key}`; `values` not an object → `values` "The values field must be an object."):

| Check                                                                                                   | Message                                                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| required & empty                                                                                        | This field is required. (consent: You must agree to continue.)                                   |
| text-like value not a string/number                                                                     | Enter a valid value.                                                                             |
| length > type max (text 500, long_text 5000, email 254, phone 40, url 500, hidden 500) or > `rules.max` | Enter no more than {n} characters.                                                               |
| length < `rules.min`                                                                                    | Enter at least {min} characters.                                                                 |
| email `^[^\s@]+@[^\s@]+\.[^\s@]+$`                                                                      | Enter a valid email address.                                                                     |
| phone `^\+?[0-9 ().\-]{5,40}$` and ≥ 5 digits                                                           | Enter a valid phone number.                                                                      |
| url `^https?://[^\s/$.?#][^\s]*$` (i)                                                                   | Enter a valid URL starting with https:// or http://                                              |
| pattern letters / digits / alphanumeric / no_links                                                      | Use letters only. · Use digits only. · Use letters and digits only. · Links aren't allowed here. |
| number `^-?\d{1,12}(\.\d{1,6})?$`, `rules.min/max`                                                      | Enter a number. · Enter a number of at least {min}. · Enter a number no greater than {max}.      |
| date `YYYY-MM-DD`, a real date                                                                          | Enter a valid date.                                                                              |
| choice not an option                                                                                    | Choose one of the options.                                                                       |
| rating not an integer 1–5                                                                               | Choose a rating from 1 to 5.                                                                     |
| checkbox/consent not a boolean-ish value                                                                | Enter a valid value.                                                                             |
| file not an unused upload of this form & field (≤ 24 h)                                                 | Upload the file again.                                                                           |

A field whose `show_if` isn't met (the referenced field's normalised value as a string — checkboxes `true`/`false`,
numbers as the number (`05` → `5`, `1.50` → `1.5`, not a number → empty), email lower-cased — differs from `equals`)
is skipped: not required, stored `null`. The site compares the same way. `hidden` + `static` prefill: the server's value wins. The site
runs the same checks first for instant feedback (`src/features/forms/logic.ts`, messages in `messages/*.json` →
`forms.errors`) and shows the API's messages under the fields it shows; `token`, other keys and a `values.{key}` error of a field the
visitor can't see (hidden type, or a condition the site evaluates differently) show above the button (`{label}: {message}`),
`turnstile_token` under the Turnstile widget (which then reloads).

Success → `201 { data: { received: true, confirmation_required, submission_id: string|null, success_message,
redirect_url } }` (`success_message` with defaults applied). With the school's double opt-in on, every stored
submission answers `confirmation_required: true` and "Thanks! Check your inbox to confirm your subscription." — also
for an address that is already an active contact, so the reply never tells whether someone is subscribed: that
contact gets the confirmation email too, and the submission's properties and form actions wait for the click. So does
the Lead conversion: the site fires its browser Lead event (event id `lead_{submission_id}`) only when
`confirmation_required` is false; for a held submission the server sends the Lead once the contact confirms. The site shows `success_message`, or follows `redirect_url` (http/https only).

### Turnstile

When `turnstile_site_key` is set the site loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`
on demand, renders the widget (`action: 'lead-form'`) and sends its token as `turnstile_token`. No CSP change is needed
(the site sets no `script-src` / `frame-src`).

## Browser events

- `window` `CustomEvent('coursiva:lead', { detail: { form_id, submission_id } })` after a **stored** submission (not
  for a honeypot answer, whose `submission_id` is `null`). Ad pixels hook this.
- On the embedding page, `/embed/forms.js` dispatches `CustomEvent('coursiva:form-submitted', { bubbles: true,
detail: { form, submission } })` on its `<script>` element.

## Embedding

```html
<script src="https://{school host}/embed/forms.js" data-form="frm_…" async></script>
<!-- optional: data-target="element-id" (render inside that element), data-title="Accessible frame title" -->
```

The script (`src/features/forms/embedScript.ts`, served by `app/[tenant]/embed/forms.js/route.ts`, `Cache-Control:
public, max-age=3600…`, `Cross-Origin-Resource-Policy: cross-origin`) handles every `script[data-form]` whose `src` is
`…/embed/forms.js` — several forms and several schools per page, each set up once. For each it inserts (after the
script or into `#data-target`):

```html
<iframe
  sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
  title="{data-title|Form}"
  loading="lazy"
  style="width:100%;border:0;…"
  src="{script origin}/embed/forms/{id}?origin={location.origin}&page={location.href}&referrer={document.referrer}&utm_source=…&utm_medium=…&utm_campaign=…&utm_term=…&utm_content=…&ref=…"
></iframe>
```

### Frame ⇄ parent protocol

The frame posts `{ source: 'coursiva-form', v: 1, form: '{id}', type, … }` to `window.parent` with
`targetOrigin` = the `origin` query parameter **only when it is a bare http(s) origin**; otherwise it never posts.

| `type`      | Payload                | Parent (`forms.js`) does                                               |
| ----------- | ---------------------- | ---------------------------------------------------------------------- |
| `resize`    | `height` (px)          | sets the iframe height, clamped 50–10000 (ResizeObserver in the frame) |
| `submitted` | `submission` (`fsb_…`) | dispatches `coursiva:form-submitted` on the script element             |
| `redirect`  | `url`                  | `location.assign(url)` for http/https URLs only                        |

The parent accepts a message only when `event.source` is that iframe's window, `data.source === 'coursiva-form'`,
`data.form` is that iframe's form id, and `event.origin` is the origin of that frame's first such message (its resize
on load). The script's origin can't be required: after the school moves to a custom domain, a frame of the old host is
redirected (308) to the new one.

Hidden-field prefill in the frame reads the embedding page: `page_url` = `page`, `referrer` = `referrer`, `query` and
`utm_*`/`ref` from `page`'s query, with the forwarded `utm_*`/`ref` parameters winning.

### Headers

`/embed/forms/{id}` (unprefixed, exactly one segment): `Content-Security-Policy: frame-ancestors *; base-uri 'self';
object-src 'none'; form-action 'self'`, **no** `X-Frame-Options`, `X-Robots-Tag: noindex, nofollow`. Every other page
(including `/forms/{id}`, `/es/embed/forms/{id}` and `/embed/forms/{id}/x`) keeps `frame-ancestors 'none'` +
`X-Frame-Options: DENY` (`src/lib/securityHeaders.ts`). The frame has no session and makes only anonymous API calls.
`/forms/` and `/embed/` are in `NOINDEX_PREFIXES` (robots.txt `Disallow`).

## Site-builder `lead_form` section

A `form` section with `opt.lead_form` set to a live form is presented as

```
{ …SectionFrame, kind: 'lead_form', form_id: 'frm_…', title: string, subtitle: string }
```

(`title`/`subtitle` = the section's texts; `''` → the form's own title/description). The site renders the lead form
inline in the section frame. A paused/deleted form falls back to the section's own builder form (`kind: 'form'`).

## Mock

Tenant **amplify** seeds: `frm_01jd8x7k3q9w2e5r6t7y8z9abc` "Workshop application" (every field type, a conditional
field, a file field, a consent field, hidden fields of every prefill source; min fill 3 s),
`frm_01jd8x7k3q9w2e5r6t7y8z9qck` "Waitlist" (min fill 30 s; used by the `/about/team` `lead_form` section),
`frm_01jd8x7k3q9w2e5r6t7y8z9tsk` "Partner enquiry" (Turnstile with Cloudflare's test key `1x00000000000000000000AA`,
accepted token `XXXX.DUMMY.TOKEN.XXXX`; double opt-in; redirect), `frm_01jd8x7k3q9w2e5r6t7y8z9pse` (paused → 404).
Test hook (mock only): `GET /__mock/forms/{tenant}/{form}` → `{ views, spam_blocked, submissions, uploads }`. Rate
limits are not simulated.
