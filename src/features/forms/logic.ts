/**
 * Lead-form rules shared by the form component, the embed frame and the tests: conditional logic (`show_if`), the
 * same per-field checks the API runs (docs/api/forms.md → "Answers", for instant feedback — the API stays the judge),
 * hidden-field prefill from the URL, and the submission body. Pure: no React, no DOM globals.
 */
import type { FileKind, LeadField, LeadValues, PublicForm, SubmissionResult, WireValue } from './types';

/** A failed check: a `forms.errors.*` message key and its ICU arguments. */
export interface Problem {
  code:
    | 'required'
    | 'consentRequired'
    | 'invalid'
    | 'maxChars'
    | 'minChars'
    | 'email'
    | 'phone'
    | 'url'
    | 'letters'
    | 'digits'
    | 'alphanumeric'
    | 'noLinks'
    | 'number'
    | 'numberMin'
    | 'numberMax'
    | 'date'
    | 'choice'
    | 'rating'
    | 'fileType'
    | 'fileSize';
  /** Strings, so numbers print exactly as the API writes them (`5000`, `2.5` — no locale grouping). */
  params?: Record<string, string>;
}

/** The longest value per text-like type (characters). */
export const TYPE_MAX: Partial<Record<LeadField['type'], number>> = {
  text: 500,
  long_text: 5000,
  email: 254,
  phone: 40,
  url: 500,
  hidden: 500,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ().-]{5,40}$/;
const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const NUMBER = /^-?\d{1,12}(\.\d{1,6})?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PATTERNS = {
  letters: { re: /^[\p{L}\p{M}\s'’-]+$/u, code: 'letters' },
  digits: { re: /^[0-9]+$/, code: 'digits' },
  alphanumeric: { re: /^[\p{L}\p{N}]+$/u, code: 'alphanumeric' },
} as const;

/** Characters as the API counts them (code points, like PHP's mb_strlen). */
const chars = (s: string) => Array.from(s).length;

/** A real calendar date `YYYY-MM-DD`. */
export function isDate(v: string): boolean {
  const m = DATE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * A field's value as `show_if` compares it, normalised as the API does before it compares: checkboxes `true`/`false`,
 * numbers as the number they are (`05` → `5`, `1.50` → `1.5`; not a number → empty), email lower-cased, everything else
 * as typed (trimmed).
 */
export function comparable(field: LeadField, value: LeadValues[string]): string {
  if (field.type === 'checkbox' || field.type === 'consent') return value === true ? 'true' : 'false';
  const v = typeof value === 'string' ? value.trim() : '';
  if (field.type === 'number') return /^-?\d{1,12}(\.\d{1,6})?$/.test(v) ? String(Number(v)) : '';
  if (field.type === 'email') return v.toLowerCase();
  return v;
}

/**
 * The keys of the fields that apply right now. A field whose `show_if` isn't met is skipped — not shown, not
 * required, sent as `null` — and a skipped field counts as empty for the fields that depend on it.
 */
export function visibleKeys(fields: LeadField[], values: LeadValues): Set<string> {
  const shown = new Set<string>();
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const f of fields) {
    if (!f.showIf) {
      shown.add(f.key);
      continue;
    }
    const ref = byKey.get(f.showIf.field);
    const current = ref && shown.has(ref.key) ? comparable(ref, values[ref.key]) : '';
    if (current === f.showIf.equals) shown.add(f.key);
  }
  return shown;
}

/** Whether a value counts as empty for `required`. */
function isEmpty(field: LeadField, value: LeadValues[string]): boolean {
  if (field.type === 'checkbox' || field.type === 'consent') return value !== true;
  return typeof value !== 'string' || value.trim() === '';
}

/** The API's checks for one (applicable) field. File fields hold their upload id once the file is uploaded. */
export function checkValue(field: LeadField, value: LeadValues[string]): Problem | null {
  if (isEmpty(field, value)) {
    if (!field.required) return null;
    return { code: field.type === 'consent' ? 'consentRequired' : 'required' };
  }
  if (field.type === 'checkbox' || field.type === 'consent' || field.type === 'file') return null;
  const v = typeof value === 'string' ? value.trim() : '';
  const { min, max, pattern } = field.rules;
  switch (field.type) {
    case 'number': {
      if (!NUMBER.test(v)) return { code: 'number' };
      const n = Number(v);
      if (min !== null && n < min) return { code: 'numberMin', params: { min: String(min) } };
      if (max !== null && n > max) return { code: 'numberMax', params: { max: String(max) } };
      return null;
    }
    case 'date':
      return isDate(v) ? null : { code: 'date' };
    case 'choice':
      return field.options.includes(v) ? null : { code: 'choice' };
    case 'rating':
      return /^[1-5]$/.test(v) ? null : { code: 'rating' };
    default:
      break;
  }
  const length = chars(v);
  const typeMax = TYPE_MAX[field.type] ?? 500;
  if (length > typeMax) return { code: 'maxChars', params: { n: String(typeMax) } };
  if (min !== null && length < min) return { code: 'minChars', params: { min: String(min) } };
  if (max !== null && length > max) return { code: 'maxChars', params: { n: String(max) } };
  if (field.type === 'email' && !EMAIL.test(v)) return { code: 'email' };
  if (field.type === 'phone' && (!PHONE.test(v) || v.replace(/\D/g, '').length < 5)) return { code: 'phone' };
  if (field.type === 'url' && !URL_RE.test(v)) return { code: 'url' };
  if (pattern === 'no_links') return /https?:\/\/|www\./i.test(v) ? { code: 'noLinks' } : null;
  if (pattern) {
    const p = PATTERNS[pattern];
    return p.re.test(v) ? null : { code: p.code };
  }
  return null;
}

/** Every applicable field's problem, keyed by field key, in field order. */
export function checkAll(fields: LeadField[], values: LeadValues): Map<string, Problem> {
  const shown = visibleKeys(fields, values);
  const out = new Map<string, Problem>();
  for (const f of fields) {
    if (!shown.has(f.key) || f.type === 'hidden') continue;
    const p = checkValue(f, values[f.key]);
    if (p) out.set(f.key, p);
  }
  return out;
}

/* ── Files ── */

/** Allowed extensions per kind (docs/api/forms.md → "File kinds"; the API also checks the file's first bytes). */
export const FILE_EXTENSIONS: Record<FileKind, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'],
  pdf: ['pdf'],
  document: ['docx', 'doc', 'odt', 'rtf', 'txt'],
  spreadsheet: ['xlsx', 'xls', 'ods', 'csv'],
  presentation: ['pptx', 'ppt', 'odp'],
  audio: ['mp3', 'm4a', 'wav', 'ogg'],
  video: ['mp4', 'mov', 'webm'],
  archive: ['zip'],
};

export const extensionsFor = (accept: FileKind[]) => accept.flatMap((k) => FILE_EXTENSIONS[k]);

/** The file input's `accept` attribute. */
export const acceptAttribute = (accept: FileKind[]) =>
  extensionsFor(accept)
    .map((e) => `.${e}`)
    .join(',');

/** The pre-upload checks (type by extension, size); the API repeats them and checks the content. */
export function checkFile(field: LeadField, file: { name: string; size: number }): Problem | null {
  const rules = field.file ?? { accept: ['pdf', 'image', 'document'], maxMb: 10 };
  const ext = /\.([^./\\]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? '';
  if (!extensionsFor(rules.accept).includes(ext)) return { code: 'fileType' };
  if (file.size > rules.maxMb * 1024 * 1024) return { code: 'fileSize', params: { max_mb: String(rules.maxMb) } };
  return null;
}

/* ── Prefill ── */

/** Where hidden fields take their values: the page's query (or the embedding page's), its URL and its referrer. */
export interface PrefillContext {
  params: URLSearchParams;
  pageUrl: string;
  referrer: string;
}

/** A hidden field's value from the context. `static` values are set by the API, so the browser sends none. */
export function prefillValue(field: LeadField, ctx: PrefillContext): string {
  const p = field.prefill;
  if (field.type !== 'hidden' || !p) return '';
  let v: string;
  switch (p.source) {
    case 'static':
      return '';
    case 'query':
      v = p.param === '' ? '' : (ctx.params.get(p.param) ?? '');
      break;
    case 'page_url':
      v = ctx.pageUrl;
      break;
    case 'referrer':
      v = ctx.referrer;
      break;
    default:
      v = ctx.params.get(p.source) ?? '';
  }
  return Array.from(v).slice(0, TYPE_MAX.hidden).join('');
}

export function prefillAll(fields: LeadField[], ctx: PrefillContext): LeadValues {
  const out: LeadValues = {};
  for (const f of fields) if (f.type === 'hidden') out[f.key] = prefillValue(f, ctx);
  return out;
}

/** An absolute http(s) URL, or `''`. */
export function httpUrl(v: string | null | undefined): string {
  if (!v) return '';
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

/** A bare `http(s)://host[:port]` origin, or null (so the frame never posts to anything else). */
export function bareOrigin(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin === v.replace(/\/$/, '') ? u.origin : null;
  } catch {
    return null;
  }
}

const FORWARDED = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'] as const;

/**
 * The embed frame's context from its own query (`/embed/forms/{id}?origin=…&page=…&referrer=…&utm_*=…&ref=…`): the
 * embedding page's query plus the forwarded campaign parameters (which win).
 */
export function embedContext(search: string): PrefillContext & { origin: string | null } {
  const q = new URLSearchParams(search);
  const pageUrl = httpUrl(q.get('page'));
  const params = new URLSearchParams(pageUrl ? new URL(pageUrl).search : '');
  for (const k of FORWARDED) {
    const v = q.get(k);
    if (v !== null && v !== '') params.set(k, v);
  }
  return { params, pageUrl, referrer: httpUrl(q.get('referrer')), origin: bareOrigin(q.get('origin')) };
}

/* ── Submission ── */

/** `values` for the API: skipped fields `null`, checkboxes booleans, ratings numbers, files their upload id. */
export function wireValues(fields: LeadField[], values: LeadValues): Record<string, WireValue> {
  const shown = visibleKeys(fields, values);
  const out: Record<string, WireValue> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (!shown.has(f.key)) out[f.key] = null;
    else if (f.type === 'checkbox' || f.type === 'consent') out[f.key] = v === true;
    else if (typeof v !== 'string' || v.trim() === '') out[f.key] = null;
    else if (f.type === 'rating' && /^[1-5]$/.test(v.trim())) out[f.key] = Number(v.trim());
    else out[f.key] = v.trim();
  }
  return out;
}

export interface SubmissionInput {
  token: string;
  values: Record<string, WireValue>;
  /** The honeypot's content (people leave it empty). */
  website: string;
  turnstileToken: string | null;
  pageUrl: string;
  referrer: string;
}

/**
 * The `POST /forms/{id}/submissions` body, exactly as sent (snake_case written out: `values` keys are data and must
 * never be case-converted). One place on purpose: the pixels integration adds its `tracking` object here.
 */
export function buildSubmissionBody(input: SubmissionInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    token: input.token,
    values: input.values,
    website: input.website,
    page_url: input.pageUrl,
    referrer: input.referrer,
  };
  if (input.turnstileToken !== null) body.turnstile_token = input.turnstileToken;
  return body;
}

/** Where a successful submission may send the visitor: http(s) only. */
export const safeRedirect = (r: Pick<SubmissionResult, 'redirectUrl'>): string | null => httpUrl(r.redirectUrl) || null;

/* ── Response normalisation (older or partial payloads still render) ── */

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const TYPES: LeadField['type'][] = [
  'text',
  'long_text',
  'email',
  'phone',
  'number',
  'choice',
  'checkbox',
  'rating',
  'date',
  'url',
  'hidden',
  'consent',
  'file',
];

function normalizeField(raw: unknown): LeadField | null {
  const f = rec(raw);
  const type = TYPES.find((x) => x === f.type);
  if (typeof f.key !== 'string' || f.key === '' || !type) return null;
  const rules = rec(f.rules);
  const showIf = rec(f.showIf);
  const prefill = rec(f.prefill);
  const consent = rec(f.consent);
  const file = rec(f.file);
  const pattern = ['letters', 'digits', 'alphanumeric', 'no_links'].find((p) => p === rules.pattern) as LeadField['rules']['pattern'];
  return {
    key: f.key,
    label: str(f.label),
    required: type === 'consent' || f.required === true,
    type,
    options: Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === 'string') : [],
    placeholder: str(f.placeholder),
    help: str(f.help),
    rules: { min: num(rules.min), max: num(rules.max), pattern: pattern ?? null },
    showIf: typeof showIf.field === 'string' && showIf.field !== '' ? { field: showIf.field, equals: str(showIf.equals) } : null,
    prefill:
      type === 'hidden'
        ? { source: (str(prefill.source) || 'utm_source') as NonNullable<LeadField['prefill']>['source'], param: str(prefill.param) }
        : null,
    consent: type === 'consent' ? { text: str(consent.text), version: str(consent.version) || '1' } : null,
    file:
      type === 'file'
        ? {
            accept: Array.isArray(file.accept)
              ? (file.accept.filter((k) => typeof k === 'string' && k in FILE_EXTENSIONS) as FileKind[])
              : ['pdf', 'image', 'document'],
            maxMb: Math.min(25, Math.max(1, num(file.maxMb) ?? 10)),
          }
        : null,
  };
}

export function normalizeForm(raw: unknown): PublicForm {
  const f = rec(raw);
  return {
    id: str(f.id),
    name: str(f.name),
    title: str(f.title),
    description: str(f.description),
    submitLabel: str(f.submitLabel),
    successMessage: str(f.successMessage),
    redirectUrl: typeof f.redirectUrl === 'string' && f.redirectUrl !== '' ? f.redirectUrl : null,
    fields: (Array.isArray(f.fields) ? f.fields : []).map(normalizeField).filter((x): x is LeadField => x !== null),
    turnstileSiteKey: typeof f.turnstileSiteKey === 'string' && f.turnstileSiteKey !== '' ? f.turnstileSiteKey : null,
    doubleOptIn: f.doubleOptIn === true,
    minFillSeconds: num(f.minFillSeconds) ?? 0,
    token: str(f.token),
  };
}
