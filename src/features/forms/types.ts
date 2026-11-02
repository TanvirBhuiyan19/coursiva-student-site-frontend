/**
 * Lead forms (Forms & leads): the public form a school builds in its dashboard, shown on its hosted page
 * (`/forms/{id}`), in other websites through the embed (`/embed/forms.js` → `/embed/forms/{id}`) and inline in
 * site-builder pages (a `lead_form` section). Contract: docs/api/forms.md
 */

export type LeadFieldType =
  'text' | 'long_text' | 'email' | 'phone' | 'number' | 'choice' | 'checkbox' | 'rating' | 'date' | 'url' | 'hidden' | 'consent' | 'file';

export type FileKind = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'audio' | 'video' | 'archive';

export type PrefillSource =
  'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_term' | 'utm_content' | 'ref' | 'query' | 'static' | 'page_url' | 'referrer';

export type TextPattern = 'letters' | 'digits' | 'alphanumeric' | 'no_links';

/** A normalised field: every key is always present (docs/api/forms.md → "Fields"). */
export interface LeadField {
  /** The field's key in `values` (data — sent as-is, never case-converted). */
  key: string;
  label: string;
  required: boolean;
  type: LeadFieldType;
  /** Choices of a `choice` field (`[]` otherwise). */
  options: string[];
  /** `''` = none. */
  placeholder: string;
  /** `''` = none. */
  help: string;
  /** Length limits (text-like types) or value limits (`number`); `pattern` only for text / long_text. */
  rules: { min: number | null; max: number | null; pattern: TextPattern | null };
  /** Shown only while the earlier field `field` has the value `equals` (as a string; checkboxes `true`/`false`). */
  showIf: { field: string; equals: string } | null;
  /** Hidden fields only. `static` values are set by the server (`param` comes blanked). */
  prefill: { source: PrefillSource; param: string } | null;
  /** Consent fields only (always required). */
  consent: { text: string; version: string } | null;
  /** File fields only. */
  file: { accept: FileKind[]; maxMb: number } | null;
}

/** `GET /api/v1/forms/{id}` */
export interface PublicForm {
  id: string;
  name: string;
  title: string;
  description: string;
  /** Default applied by the API ("Submit"). */
  submitLabel: string;
  /** Default applied by the API. */
  successMessage: string;
  redirectUrl: string | null;
  fields: LeadField[];
  /** Cloudflare Turnstile is on: render the widget and send its `turnstile_token`. */
  turnstileSiteKey: string | null;
  doubleOptIn: boolean;
  minFillSeconds: number;
  /** Signed form token (24 h): proves the visitor loaded the form; sent with views, uploads and the submission. */
  token: string;
}

/** `POST /api/v1/forms/{id}/uploads` → 201 */
export interface FormUpload {
  id: string;
  name: string;
  sizeBytes: number;
}

/** `POST /api/v1/forms/{id}/submissions` → 201 */
export interface SubmissionResult {
  received: boolean;
  confirmationRequired: boolean;
  /** `null` when nothing was stored (the honeypot). */
  submissionId: string | null;
  successMessage: string;
  redirectUrl: string | null;
}

/** A field's value in the form state (files hold their upload id once uploaded). */
export type LeadValue = string | boolean;
export type LeadValues = Record<string, LeadValue | undefined>;

/** A value on the wire (`values` of the submission body). */
export type WireValue = string | number | boolean | null;
