/** Quiz answer helpers (pure, unit-tested). Grading never happens here — the API grades every attempt. */
import type { QuizAnswer, QuizQuestion, QuizResult } from './types';

/** Whether the learner gave a full answer of the question's type (the API answers 422 otherwise). */
export function isAnswered(q: QuizQuestion, a: QuizAnswer | undefined): boolean {
  if (!a) return false;
  switch (q.type) {
    case 'free_text':
      return (a.text ?? '').trim() !== '';
    case 'multi_select':
      return (a.optionIds ?? []).length > 0;
    case 'fill_blanks':
      return (a.blanks ?? []).length >= q.blankCount && (a.blanks ?? []).slice(0, q.blankCount).every((b) => b.trim() !== '');
    case 'matching':
      return (a.matches ?? []).length >= q.prompts.length && (a.matches ?? []).slice(0, q.prompts.length).every((m) => m !== '');
    default:
      return !!a.optionId;
  }
}

/** The wire answer for each question, in question order. */
export const quizAnswers = (questions: QuizQuestion[], given: Record<string, QuizAnswer>): QuizAnswer[] =>
  questions.map((q) => given[q.id] ?? { questionId: q.id });

/** How the result should read. The API decides every figure; this only picks the message. */
export function resultKind(r: QuizResult): 'pending' | 'passed' | 'failed' | 'submitted' {
  if (r.reviewStatus === 'pending') return 'pending';
  if (r.passed === true) return 'passed';
  if (r.passed === false) return 'failed';
  return 'submitted';
}
