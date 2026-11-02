import type { SurveyField, SurveyInput, SurveyResponse, SurveyValue } from './types';

/**
 * Survey lessons: the answer form's state and the checks the API also makes (LessonSurveys::validated), so most
 * mistakes show before a round trip. The API stays the judge — its 422s are mapped back onto the questions.
 */

/** One question's draft: text types, number and choice as typed (""), checkbox as a boolean, rating 1–5 or null. */
export type SurveyDraft = string | boolean | number | null;

/** The longest answer per text type (characters) — the API's limits. */
export const SURVEY_MAX_LENGTH: Partial<Record<SurveyField['type'], number>> = { text: 500, long_text: 5000, email: 254, phone: 40 };

export type SurveyErrorKey = 'required' | 'tooLong' | 'email' | 'phone' | 'number';
export interface SurveyFieldError {
  key: SurveyErrorKey;
  max?: number;
}

const NUMBER = /^-?\d{1,12}(\.\d{1,6})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const PHONE = /^\+?[0-9 ().-]{5,40}$/;

/** An empty draft per question. */
export function emptyDraft(fields: SurveyField[]): SurveyDraft[] {
  return fields.map((f) => (f.type === 'checkbox' ? false : f.type === 'rating' ? null : ''));
}

/** The stored response as a draft (for "Edit your answers"), matched by question key. */
export function draftFromResponse(fields: SurveyField[], response: SurveyResponse | null): SurveyDraft[] {
  const empty = emptyDraft(fields);
  if (!response) return empty;
  return fields.map((f, i) => {
    const v = response.answers.find((a) => a.key === f.key)?.value ?? null;
    if (v === null) return empty[i]!;
    if (f.type === 'checkbox') return v === true;
    if (f.type === 'rating') return typeof v === 'number' ? v : null;
    return typeof v === 'number' ? String(v) : typeof v === 'string' ? v : empty[i]!;
  });
}

const blank = (f: SurveyField, d: SurveyDraft) =>
  d === null || (f.type === 'checkbox' ? d !== true : typeof d === 'string' ? d.trim() === '' : false);

/** One question's error, or null. */
export function fieldError(f: SurveyField, d: SurveyDraft): SurveyFieldError | null {
  if (blank(f, d)) return f.required ? { key: 'required' } : null;
  if (typeof d !== 'string') return null;
  const v = d.trim();
  if (f.type === 'number') return NUMBER.test(v) ? null : { key: 'number' };
  const max = SURVEY_MAX_LENGTH[f.type];
  if (max !== undefined && Array.from(v).length > max) return { key: 'tooLong', max };
  if (f.type === 'email' && !EMAIL.test(v)) return { key: 'email' };
  if (f.type === 'phone' && (!PHONE.test(v) || (v.match(/[0-9]/g)?.length ?? 0) < 5)) return { key: 'phone' };
  return null;
}

/** Per-question errors (null = fine) and whether at least one question is answered (the API's "answer at least one"). */
export function validateSurvey(fields: SurveyField[], draft: SurveyDraft[]) {
  const errors = fields.map((f, i) => fieldError(f, draft[i] ?? null));
  const answered = fields.some((f, i) => !blank(f, draft[i] ?? null));
  return { errors, answered, ok: answered && errors.every((e) => e === null) };
}

/** The request body: unanswered questions are left out; numbers go as numbers, checkboxes as booleans. */
export function surveyInput(fields: SurveyField[], draft: SurveyDraft[]): SurveyInput {
  const answers: SurveyInput['answers'] = [];
  fields.forEach((f, i) => {
    const d = draft[i] ?? null;
    if (f.type === 'checkbox') {
      answers.push({ key: f.key, value: d === true });
      return;
    }
    if (blank(f, d)) return;
    const value: SurveyValue = f.type === 'number' && typeof d === 'string' ? Number(d.trim()) : typeof d === 'string' ? d.trim() : d;
    answers.push({ key: f.key, value });
  });
  return { answers };
}

/** The API's 422 → messages per question (`answers.{i}`) and the form-level one (`answers`). */
export function serverErrors(fields: SurveyField[], fieldErrors: Record<string, string>) {
  const perField = fields.map((_, i) => fieldErrors[`answers.${i}`] ?? null);
  return { perField, form: fieldErrors.answers ?? null };
}
