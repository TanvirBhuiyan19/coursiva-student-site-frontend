/**
 * Lead forms (Forms & leads) — the public side, ported from Laravel's Communications\Forms (docs/api/forms.md):
 * signed form tokens, views deduplicated per visitor and day, uploads with type / content / size checks, and
 * submissions with the honeypot, the minimum fill time, Turnstile and per-field answers (FormAnswers).
 *
 * State lives beside each tenant's dataset (a WeakMap, so `POST /__mock/reset` — which builds fresh datasets —
 * resets it too). Only amplify has forms.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TenantData } from './records';

export type FieldType =
  'text' | 'long_text' | 'email' | 'phone' | 'number' | 'choice' | 'checkbox' | 'rating' | 'date' | 'url' | 'hidden' | 'consent' | 'file';
export type FileKind = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'audio' | 'video' | 'archive';

export interface MockField {
  key: string;
  label: string;
  required: boolean;
  type: FieldType;
  options: string[];
  placeholder: string;
  help: string;
  rules: { min: number | null; max: number | null; pattern: 'letters' | 'digits' | 'alphanumeric' | 'no_links' | null };
  showIf: { field: string; equals: string } | null;
  prefill: { source: string; param: string } | null;
  consent: { text: string; version: string } | null;
  file: { accept: FileKind[]; maxMb: number } | null;
}

export interface MockForm {
  id: string;
  name: string;
  status: 'live' | 'paused';
  fields: MockField[];
  settings: {
    title: string;
    description: string;
    submitLabel: string;
    successMessage: string;
    redirectUrl: string | null;
    turnstile: boolean;
    minFillSeconds: number;
  };
  doubleOptIn: boolean;
  views: number;
  spamBlocked: number;
}

export type StoredValue = string | number | boolean | null | { id: string; name: string; sizeBytes: number };

export interface MockSubmission {
  id: string;
  formId: string;
  email: string;
  values: { key: string; label: string; type: FieldType; value: StoredValue }[];
  consents: { key: string; text: string; version: string; acceptedAt: string }[];
  pageUrl: string | null;
  referrer: string | null;
  utm: Record<string, string> | null;
  tracking: unknown;
  createdAt: string;
}

export interface MockUpload {
  id: string;
  formId: string;
  fieldKey: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  submissionId: string | null;
  createdAt: number;
}

interface FormsState {
  forms: MockForm[];
  submissions: MockSubmission[];
  uploads: MockUpload[];
  viewDays: Set<string>;
}

/* ── Seed ── */

export const SEED_FORMS = {
  workshop: 'frm_01jd8x7k3q9w2e5r6t7y8z9abc',
  waitlist: 'frm_01jd8x7k3q9w2e5r6t7y8z9qck',
  partners: 'frm_01jd8x7k3q9w2e5r6t7y8z9tsk',
  paused: 'frm_01jd8x7k3q9w2e5r6t7y8z9pse',
} as const;

/** Cloudflare's always-passing test site key, and the dummy token its test widget produces. */
export const TURNSTILE_TEST = { siteKey: '1x00000000000000000000AA', token: 'XXXX.DUMMY.TOKEN.XXXX' };

const field = (key: string, label: string, type: FieldType, extra: Partial<MockField> = {}): MockField => ({
  key,
  label,
  required: false,
  type,
  options: [],
  placeholder: '',
  help: '',
  rules: { min: null, max: null, pattern: null },
  showIf: null,
  prefill: null,
  consent: null,
  file: null,
  ...extra,
});

const settings = (s: Partial<MockForm['settings']> = {}): MockForm['settings'] => ({
  title: '',
  description: '',
  submitLabel: '',
  successMessage: '',
  redirectUrl: null,
  turnstile: false,
  minFillSeconds: 3,
  ...s,
});

function seedForms(slug: string): MockForm[] {
  if (slug !== 'amplify') return [];
  const rule = (min: number | null, max: number | null, pattern: MockField['rules']['pattern'] = null) => ({ min, max, pattern });
  return [
    {
      id: SEED_FORMS.workshop,
      name: 'Workshop application',
      status: 'live',
      doubleOptIn: false,
      views: 0,
      spamBlocked: 0,
      settings: settings({
        title: 'Apply for the live workshop',
        description: 'Six weeks, twelve seats. Tell us a little about you and we’ll be in touch.',
        submitLabel: 'Send application',
        successMessage: 'Thanks! We’ll review your application within two days.',
      }),
      fields: [
        field('name', 'Your name', 'text', { required: true, placeholder: 'Jordan Tate', rules: rule(2, null, 'letters') }),
        field('email', 'Email', 'email', { required: true, placeholder: 'you@example.com' }),
        field('phone', 'Phone', 'phone'),
        field('team_size', 'Team size', 'number', { help: 'Just you? Enter 1.', rules: rule(1, 10000) }),
        field('role', 'What best describes you?', 'choice', { required: true, options: ['Coach', 'Creator', 'Marketer', 'Other'] }),
        field('role_other', 'Tell us your role', 'text', { required: true, showIf: { field: 'role', equals: 'Other' } }),
        field('website', 'Your website', 'url', { placeholder: 'https://' }),
        field('start_date', 'When could you start?', 'date'),
        field('goals', 'What do you want to get out of it?', 'long_text', { rules: rule(null, 1000, 'no_links') }),
        field('excitement', 'How excited are you?', 'rating'),
        field('newsletter', 'Send me the Friday lesson too', 'checkbox'),
        field('portfolio', 'Portfolio or CV', 'file', {
          help: 'Optional — a PDF or an image.',
          file: { accept: ['pdf', 'image'], maxMb: 2 },
        }),
        field('consent', 'Privacy', 'consent', {
          required: true,
          consent: { text: 'I agree to the privacy policy and to be contacted about the workshop.', version: '2026-10' },
        }),
        field('utm_source', 'UTM source', 'hidden', { prefill: { source: 'utm_source', param: '' } }),
        field('ref', 'Referral', 'hidden', { prefill: { source: 'ref', param: '' } }),
        field('campaign_id', 'Campaign id', 'hidden', { prefill: { source: 'query', param: 'cid' } }),
        field('landing_page', 'Landing page', 'hidden', { prefill: { source: 'page_url', param: '' } }),
        field('came_from', 'Came from', 'hidden', { prefill: { source: 'referrer', param: '' } }),
        field('channel', 'Channel', 'hidden', { prefill: { source: 'static', param: 'website-form' } }),
      ],
    },
    {
      id: SEED_FORMS.waitlist,
      name: 'Waitlist',
      status: 'live',
      doubleOptIn: false,
      views: 0,
      spamBlocked: 0,
      // A long minimum fill time: the fastest humans still pass; a script posting at once doesn't.
      settings: settings({ title: 'Join the waitlist', minFillSeconds: 30 }),
      fields: [field('name', 'Name', 'text'), field('email', 'Email', 'email', { required: true })],
    },
    {
      id: SEED_FORMS.partners,
      name: 'Partner enquiry',
      status: 'live',
      doubleOptIn: true,
      views: 0,
      spamBlocked: 0,
      settings: settings({ title: 'Become a partner', turnstile: true, minFillSeconds: 0, redirectUrl: 'https://example.com/thanks' }),
      fields: [field('email', 'Email', 'email', { required: true }), field('company', 'Company', 'text', { required: true })],
    },
    {
      id: SEED_FORMS.paused,
      name: 'Old survey',
      status: 'paused',
      doubleOptIn: false,
      views: 0,
      spamBlocked: 0,
      settings: settings(),
      fields: [field('email', 'Email', 'email', { required: true })],
    },
  ];
}

const states = new WeakMap<TenantData, FormsState>();

export function formsOf(t: TenantData): FormsState {
  let s = states.get(t);
  if (!s) {
    s = { forms: seedForms(t.site.slug), submissions: [], uploads: [], viewDays: new Set() };
    states.set(t, s);
  }
  return s;
}

export const liveForm = (t: TenantData, id: string) => formsOf(t).forms.find((f) => f.id === id && f.status === 'live') ?? null;

/* ── Public presentation ── */

export function publicForm(f: MockForm, token: string) {
  return {
    id: f.id,
    name: f.name,
    title: f.settings.title,
    description: f.settings.description,
    submitLabel: f.settings.submitLabel || 'Submit',
    successMessage: f.settings.successMessage || 'Thanks! We got your submission.',
    redirectUrl: f.settings.redirectUrl,
    fields: f.fields.map((x) => (x.prefill?.source === 'static' ? { ...x, prefill: { ...x.prefill, param: '' } } : x)),
    turnstileSiteKey: f.settings.turnstile ? TURNSTILE_TEST.siteKey : null,
    doubleOptIn: f.doubleOptIn,
    minFillSeconds: f.settings.minFillSeconds,
    token,
  };
}

/* ── Tokens: payload.sig, payload = base64url("{form}:{issued}:{nonce}"), sig = HMAC-SHA256 (32 hex) ── */

const APP_KEY = 'mock-app-key';
const key = (t: TenantData) => `form-token|${t.resolution.tenant}|${APP_KEY}`;
const sign = (t: TenantData, payload: string) => createHmac('sha256', key(t)).update(payload).digest('hex').slice(0, 32);

/** Mints a token (tests pass an older `issuedAt` to skip the minimum fill time). */
export function mintToken(t: TenantData, formId: string, issuedAt = Math.floor(Date.now() / 1000)): string {
  const payload = Buffer.from(`${formId}:${issuedAt}:${randomBytes(8).toString('hex')}`).toString('base64url');
  return `${payload}.${sign(t, payload)}`;
}

/** The token's issue time when it is valid for this form (24 h), else null. */
export function verifyToken(t: TenantData, formId: string, token: unknown): number | null {
  if (typeof token !== 'string' || token.length > 300) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(t, payload));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const [id, issued] = Buffer.from(payload, 'base64url').toString().split(':');
  const at = Number(issued);
  const now = Date.now() / 1000;
  if (id !== formId || !Number.isInteger(at) || at > now + 60 || now - at > 86400) return null;
  return at;
}

/* ── Views ── */

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview/i;

/** Counts a view once per visitor (IP + user agent) per UTC day; bots and empty user agents aren't counted. */
export function countView(t: TenantData, f: MockForm, ip: string, ua: string) {
  if (ua.trim() === '' || BOT_UA.test(ua)) return;
  const day = new Date().toISOString().slice(0, 10);
  const visitor = createHash('sha256').update(`salt-${day}|${t.resolution.tenant}|${ip}|${ua}`).digest('hex').slice(0, 32);
  const k = `${f.id}|${day}|${visitor}`;
  const s = formsOf(t);
  if (s.viewDays.has(k)) return;
  s.viewDays.add(k);
  f.views++;
}

/* ── File kinds (extension allowlist + magic bytes) ── */

const at = (b: Uint8Array, offset: number, ascii: string) => Array.from(ascii).every((ch, i) => b[offset + i] === ch.charCodeAt(0));
const bytes = (b: Uint8Array, offset: number, seq: number[]) => seq.every((v, i) => b[offset + i] === v);
const PK = (b: Uint8Array) => bytes(b, 0, [0x50, 0x4b, 0x03, 0x04]);
const OLE = (b: Uint8Array) => bytes(b, 0, [0xd0, 0xcf, 0x11, 0xe0]);
const TEXT = (b: Uint8Array) => !b.subarray(0, 4096).includes(0);
const FTYP = (b: Uint8Array) => at(b, 4, 'ftyp');

const EXT: Record<string, { kind: FileKind; mime: string; magic: (b: Uint8Array) => boolean }> = {
  jpg: { kind: 'image', mime: 'image/jpeg', magic: (b) => bytes(b, 0, [0xff, 0xd8, 0xff]) },
  jpeg: { kind: 'image', mime: 'image/jpeg', magic: (b) => bytes(b, 0, [0xff, 0xd8, 0xff]) },
  png: { kind: 'image', mime: 'image/png', magic: (b) => bytes(b, 0, [0x89, 0x50, 0x4e, 0x47]) },
  gif: { kind: 'image', mime: 'image/gif', magic: (b) => at(b, 0, 'GIF8') },
  webp: { kind: 'image', mime: 'image/webp', magic: (b) => at(b, 0, 'RIFF') && at(b, 8, 'WEBP') },
  heic: { kind: 'image', mime: 'image/heic', magic: FTYP },
  pdf: { kind: 'pdf', mime: 'application/pdf', magic: (b) => at(b, 0, '%PDF-') },
  docx: { kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: PK },
  doc: { kind: 'document', mime: 'application/msword', magic: OLE },
  odt: { kind: 'document', mime: 'application/vnd.oasis.opendocument.text', magic: PK },
  rtf: { kind: 'document', mime: 'application/rtf', magic: (b) => at(b, 0, '{\\rtf') },
  txt: { kind: 'document', mime: 'text/plain', magic: TEXT },
  xlsx: { kind: 'spreadsheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: PK },
  xls: { kind: 'spreadsheet', mime: 'application/vnd.ms-excel', magic: OLE },
  ods: { kind: 'spreadsheet', mime: 'application/vnd.oasis.opendocument.spreadsheet', magic: PK },
  csv: { kind: 'spreadsheet', mime: 'text/csv', magic: TEXT },
  pptx: { kind: 'presentation', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: PK },
  ppt: { kind: 'presentation', mime: 'application/vnd.ms-powerpoint', magic: OLE },
  odp: { kind: 'presentation', mime: 'application/vnd.oasis.opendocument.presentation', magic: PK },
  mp3: { kind: 'audio', mime: 'audio/mpeg', magic: (b) => at(b, 0, 'ID3') || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0) },
  m4a: { kind: 'audio', mime: 'audio/mp4', magic: FTYP },
  wav: { kind: 'audio', mime: 'audio/wav', magic: (b) => at(b, 0, 'RIFF') && at(b, 8, 'WAVE') },
  ogg: { kind: 'audio', mime: 'audio/ogg', magic: (b) => at(b, 0, 'OggS') },
  mp4: { kind: 'video', mime: 'video/mp4', magic: FTYP },
  mov: { kind: 'video', mime: 'video/quicktime', magic: (b) => FTYP(b) || at(b, 4, 'moov') },
  webm: { kind: 'video', mime: 'video/webm', magic: (b) => bytes(b, 0, [0x1a, 0x45, 0xdf, 0xa3]) },
  zip: { kind: 'archive', mime: 'application/zip', magic: PK },
};

/** Stores an upload after the checks; returns the 422 errors instead when it fails them. */
export async function acceptUpload(
  t: TenantData,
  f: MockForm,
  fieldKey: unknown,
  file: unknown,
): Promise<{ upload: MockUpload } | { errors: Record<string, string> }> {
  const target = f.fields.find((x) => x.type === 'file' && x.key === fieldKey);
  if (!target) return { errors: { field: 'This form has no such file field.' } };
  if (!(file instanceof File) || file.size === 0) return { errors: { file: 'Upload a file.' } };
  const rules = target.file ?? { accept: ['pdf', 'image', 'document'] as FileKind[], maxMb: 10 };
  const ext = /\.([^./\\]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? '';
  const kind = EXT[ext];
  if (!kind || !rules.accept.includes(kind.kind)) return { errors: { file: "This file type isn't allowed." } };
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (!kind.magic(head)) return { errors: { file: "This file type isn't allowed." } };
  if (file.size > rules.maxMb * 1024 * 1024) return { errors: { file: `The file must not be larger than ${rules.maxMb} MB.` } };
  const upload: MockUpload = {
    id: `fup_${randomBytes(13).toString('hex').slice(0, 26)}`,
    formId: f.id,
    fieldKey: target.key,
    name: file.name.slice(0, 200),
    mimeType: kind.mime,
    sizeBytes: file.size,
    submissionId: null,
    createdAt: Date.now(),
  };
  formsOf(t).uploads.push(upload);
  return { upload };
}

/* ── Answers (FormAnswers) ── */

const TYPE_MAX: Partial<Record<FieldType, number>> = { text: 500, long_text: 5000, email: 254, phone: 40, url: 500, hidden: 500 };
const TEXTISH: FieldType[] = ['text', 'long_text', 'email', 'phone', 'url', 'hidden'];
const M = {
  required: 'This field is required.',
  consent: 'You must agree to continue.',
  invalid: 'Enter a valid value.',
  max: (n: number) => `Enter no more than ${n} characters.`,
  min: (n: number) => `Enter at least ${n} characters.`,
  email: 'Enter a valid email address.',
  phone: 'Enter a valid phone number.',
  url: 'Enter a valid URL starting with https:// or http://',
  letters: 'Use letters only.',
  digits: 'Use digits only.',
  alphanumeric: 'Use letters and digits only.',
  noLinks: "Links aren't allowed here.",
  number: 'Enter a number.',
  numberMin: (n: number) => `Enter a number of at least ${n}.`,
  numberMax: (n: number) => `Enter a number no greater than ${n}.`,
  date: 'Enter a valid date.',
  choice: 'Choose one of the options.',
  rating: 'Choose a rating from 1 to 5.',
  file: 'Upload the file again.',
};

const isDate = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
};

/** One answer, normalised; `error` when it can't be. Values are not yet checked for `required`. */
function normalise(f: MockField, raw: unknown): { value: string | number | boolean | null } | { error: string } {
  if (f.type === 'checkbox' || f.type === 'consent') {
    if (raw === true || raw === 'true' || raw === '1' || raw === 1) return { value: true };
    if (raw === false || raw === 'false' || raw === '0' || raw === 0 || raw === null || raw === undefined || raw === '')
      return { value: false };
    return { error: M.invalid };
  }
  if (raw === null || raw === undefined) return { value: null };
  if (f.type === 'number') {
    if (typeof raw === 'number' && Number.isFinite(raw)) return { value: raw };
    if (typeof raw === 'string') return raw.trim() === '' ? { value: null } : { value: raw.trim() };
    return { error: M.number };
  }
  if (f.type === 'rating') {
    if (typeof raw === 'number' || typeof raw === 'string') return String(raw).trim() === '' ? { value: null } : { value: raw };
    return { error: M.rating };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return { value: String(raw) };
  if (typeof raw !== 'string') return { error: f.type === 'choice' ? M.choice : f.type === 'date' ? M.date : M.invalid };
  const v = raw.trim();
  return { value: v === '' ? null : v };
}

const asString = (v: string | number | boolean | null) => (v === null ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));
const chars = (s: string) => Array.from(s).length;

function check(f: MockField, v: string | number | boolean | null): string | null {
  if (TEXTISH.includes(f.type)) {
    const s = String(v);
    const max = TYPE_MAX[f.type] ?? 500;
    if (chars(s) > max) return M.max(max);
    if (f.rules.min !== null && chars(s) < f.rules.min) return M.min(f.rules.min);
    if (f.rules.max !== null && chars(s) > f.rules.max) return M.max(f.rules.max);
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return M.email;
    if (f.type === 'phone' && (!/^\+?[0-9 ().-]{5,40}$/.test(s) || s.replace(/\D/g, '').length < 5)) return M.phone;
    if (f.type === 'url' && !/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(s)) return M.url;
    if (f.rules.pattern === 'letters' && !/^[\p{L}\p{M}\s'’-]+$/u.test(s)) return M.letters;
    if (f.rules.pattern === 'digits' && !/^[0-9]+$/.test(s)) return M.digits;
    if (f.rules.pattern === 'alphanumeric' && !/^[\p{L}\p{N}]+$/u.test(s)) return M.alphanumeric;
    if (f.rules.pattern === 'no_links' && /https?:\/\/|www\./i.test(s)) return M.noLinks;
    return null;
  }
  switch (f.type) {
    case 'number': {
      const s = String(v);
      if (!/^-?\d{1,12}(\.\d{1,6})?$/.test(s)) return M.number;
      if (f.rules.min !== null && Number(s) < f.rules.min) return M.numberMin(f.rules.min);
      if (f.rules.max !== null && Number(s) > f.rules.max) return M.numberMax(f.rules.max);
      return null;
    }
    case 'date':
      return isDate(String(v)) ? null : M.date;
    case 'choice':
      return f.options.includes(String(v)) ? null : M.choice;
    case 'rating':
      return /^[1-5]$/.test(String(v)) ? null : M.rating;
    default:
      return null;
  }
}

export interface Answers {
  values: MockSubmission['values'];
  consents: MockSubmission['consents'];
  email: string;
  uploads: MockUpload[];
}

/** FormAnswers: validates `values` against the form's fields in order; returns 422 errors keyed `values.{key}`. */
export function answers(t: TenantData, f: MockForm, raw: unknown): { ok: Answers } | { errors: Record<string, string> } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: { values: 'The values field must be an object.' } };
  const input = raw as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const normalised = new Map<string, string | number | boolean | null>();
  const out: Answers = { values: [], consents: [], email: '', uploads: [] };
  const now = new Date().toISOString();
  for (const fd of f.fields) {
    const shown = !fd.showIf || asString(normalised.get(fd.showIf.field) ?? null) === fd.showIf.equals;
    if (!shown) {
      normalised.set(fd.key, null);
      out.values.push({ key: fd.key, label: fd.label, type: fd.type, value: null });
      continue;
    }
    let source = Object.prototype.hasOwnProperty.call(input, fd.key) ? input[fd.key] : null;
    if (fd.type === 'hidden' && fd.prefill?.source === 'static') source = fd.prefill.param;
    const n = normalise(fd, source);
    if ('error' in n) {
      errors[`values.${fd.key}`] = n.error;
      normalised.set(fd.key, null);
      continue;
    }
    const v = n.value;
    normalised.set(fd.key, v);
    const empty = v === null || v === false || (typeof v === 'string' && v.trim() === '');
    if (empty) {
      if (fd.required && fd.type !== 'hidden') errors[`values.${fd.key}`] = fd.type === 'consent' ? M.consent : M.required;
      out.values.push({
        key: fd.key,
        label: fd.label,
        type: fd.type,
        value: fd.type === 'checkbox' || fd.type === 'consent' ? false : null,
      });
      continue;
    }
    if (fd.type === 'file') {
      const up = formsOf(t).uploads.find(
        (u) =>
          u.id === v && u.formId === f.id && u.fieldKey === fd.key && u.submissionId === null && Date.now() - u.createdAt <= 86_400_000,
      );
      if (!up) {
        errors[`values.${fd.key}`] = M.file;
        continue;
      }
      out.uploads.push(up);
      out.values.push({ key: fd.key, label: fd.label, type: fd.type, value: { id: up.id, name: up.name, sizeBytes: up.sizeBytes } });
      continue;
    }
    const problem = check(fd, v);
    if (problem) {
      errors[`values.${fd.key}`] = problem;
      continue;
    }
    let stored: StoredValue = v;
    if (fd.type === 'email') stored = String(v).toLowerCase();
    if (fd.type === 'rating') stored = Number(v);
    if (fd.type === 'number') stored = Number(v);
    if (fd.key === 'email' && fd.type === 'email') out.email = String(stored);
    if (fd.type === 'consent' && fd.consent)
      out.consents.push({ key: fd.key, text: fd.consent.text, version: fd.consent.version, acceptedAt: now });
    out.values.push({ key: fd.key, label: fd.label, type: fd.type, value: stored });
  }
  if (Object.keys(errors).length) return { errors };
  return { ok: out };
}

/** A submission's `page_url` / `referrer`: http(s) and ≤ 500 characters, else null. */
export function httpUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 500) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? v : null;
  } catch {
    return null;
  }
}

/** `utm` from the page URL's query: non-empty utm_* values (≤ 100 characters), or null. */
export function utmOf(pageUrl: string | null): Record<string, string> | null {
  if (!pageUrl) return null;
  const q = new URL(pageUrl).searchParams;
  const out: Record<string, string> = {};
  for (const k of ['source', 'medium', 'campaign', 'term', 'content']) {
    const v = (q.get(`utm_${k}`) ?? '').trim().slice(0, 100);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}
