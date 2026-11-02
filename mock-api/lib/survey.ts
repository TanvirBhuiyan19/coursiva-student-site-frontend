/**
 * Survey lessons — Laravel's Courses\Surveys\LessonSurveys (Go: learning surveys), ported closely enough that the site
 * sees the same shapes, messages and status codes. One response per lesson and learner; `allowResubmit` replaces it.
 */
import type { SurveyBlock, SurveyField, SurveyValue } from '@/features/learning/types';
import type { LessonRow, SurveyResponseRow, TenantData, UserRow } from './records';

export const SURVEY_MESSAGES = {
  noSurvey: 'This lesson has no survey.',
  already: 'You’ve already answered this survey.',
  list: 'The answers field must be a list of at most 50 answers.',
  required: 'The answers field is required.',
  answerOne: 'Answer at least one question.',
  question: 'This question needs an answer.',
  text: 'This answer must be text.',
  email: 'Enter a valid email address.',
  phone: 'Enter a valid phone number.',
  number: 'Enter a number.',
  choice: 'Choose one of the options.',
  checkbox: 'Answer yes or no.',
  rating: 'Choose a rating from 1 to 5.',
};

const MAX_LENGTH: Record<string, number> = { text: 500, long_text: 5000, email: 254, phone: 40 };

const responseOf = (t: TenantData, userId: string, lessonId: string) =>
  (t.surveyResponses ??= []).find((r) => r.userId === userId && r.lessonId === lessonId);

/** The questions learners answer: every field but `email`. */
export const surveyQuestions = (lesson: LessonRow): SurveyField[] =>
  (lesson.survey?.fields ?? []).filter((f) => f.key !== 'email' && f.key);

/** The lesson payload's `survey` (null without a form or without questions). */
export function surveyBlock(t: TenantData, user: UserRow, lesson: LessonRow, enrolled: boolean): SurveyBlock | null {
  const s = lesson.survey;
  const fields = surveyQuestions(lesson);
  if (!s || fields.length === 0) return null;
  const row = enrolled ? responseOf(t, user.id, lesson.id) : undefined;
  return {
    formId: s.formId,
    title: s.title,
    fields,
    allowResubmit: s.allowResubmit,
    canSubmit: enrolled && (!row || s.allowResubmit),
    response: row ? { answers: row.answers, submissions: row.submissions, submittedAt: row.submittedAt } : null,
  };
}

/** One answer normalised for its type, and why it is invalid (null = valid). */
function valueOf(q: SurveyField, input: unknown): [SurveyValue, string | null] {
  let raw = input;
  if (typeof raw === 'string') {
    raw = raw.trim();
    if (raw === '') raw = null;
  }
  if (raw === null || raw === undefined || (q.type === 'checkbox' && raw === false)) {
    return [q.type === 'checkbox' && raw === false ? false : null, q.required ? SURVEY_MESSAGES.question : null];
  }
  switch (q.type) {
    case 'checkbox':
      return raw === true ? [true, null] : [null, SURVEY_MESSAGES.checkbox];
    case 'number': {
      let n: unknown = raw;
      if (typeof n === 'string' && /^-?\d{1,12}(\.\d{1,6})?$/.test(n)) n = Number(n);
      if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) >= 1e12) return [null, SURVEY_MESSAGES.number];
      return [n, null];
    }
    case 'rating':
      return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 5 ? [raw, null] : [null, SURVEY_MESSAGES.rating];
    case 'choice':
      return typeof raw === 'string' && q.options.includes(raw) ? [raw, null] : [null, SURVEY_MESSAGES.choice];
  }
  if (typeof raw !== 'string') return [null, SURVEY_MESSAGES.text];
  const max = MAX_LENGTH[q.type] ?? MAX_LENGTH.text!;
  if (Array.from(raw).length > max) return [null, `This answer must not be longer than ${max} characters.`];
  if (q.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(raw)) return [null, SURVEY_MESSAGES.email];
  if (q.type === 'phone' && (!/^\+?[0-9 ().-]{5,40}$/.test(raw) || (raw.match(/[0-9]/g)?.length ?? 0) < 5))
    return [null, SURVEY_MESSAGES.phone];
  return [raw, null];
}

export type SurveySubmit =
  { status: 404 | 409; message: string } | { status: 422; errors: Record<string, string> } | { status: 201; row: SurveyResponseRow };

/** Validates and stores the answers (`[{ key, value }]`); errors keyed `answers.{i}` by the question's index. */
export function submitSurvey(t: TenantData, user: UserRow, lesson: LessonRow, answers: unknown): SurveySubmit {
  const fields = surveyQuestions(lesson);
  if (!lesson.survey || fields.length === 0) return { status: 404, message: SURVEY_MESSAGES.noSurvey };
  const existing = responseOf(t, user.id, lesson.id);
  if (existing && !lesson.survey.allowResubmit) return { status: 409, message: SURVEY_MESSAGES.already };
  if (answers === undefined || answers === null) return { status: 422, errors: { answers: SURVEY_MESSAGES.required } };
  if (!Array.isArray(answers) || answers.length > 50) return { status: 422, errors: { answers: SURVEY_MESSAGES.list } };
  const sent = new Map<string, unknown>();
  for (const a of answers as unknown[])
    if (a !== null && typeof a === 'object' && 'key' in a && typeof a.key === 'string') sent.set(a.key, 'value' in a ? a.value : null);
  const errors: Record<string, string> = {};
  let answered = 0;
  const out = fields.map((q, i) => {
    const [value, error] = valueOf(q, sent.get(q.key) ?? null);
    if (error) errors[`answers.${i}`] = error;
    if (value !== null && value !== false) answered++;
    return { key: q.key, label: q.label, type: q.type, value };
  });
  if (Object.keys(errors).length) return { status: 422, errors };
  if (answered === 0) return { status: 422, errors: { answers: SURVEY_MESSAGES.answerOne } };
  const now = new Date().toISOString();
  if (existing) {
    Object.assign(existing, { answers: out, submissions: existing.submissions + 1, submittedAt: now });
    return { status: 201, row: existing };
  }
  const row: SurveyResponseRow = { userId: user.id, lessonId: lesson.id, answers: out, submissions: 1, submittedAt: now };
  t.surveyResponses!.push(row);
  return { status: 201, row };
}
