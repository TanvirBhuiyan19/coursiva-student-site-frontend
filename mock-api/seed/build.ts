/** Helpers for writing seed courses compactly (mirrors the design's V/P/Q lesson helpers). */
import type { LessonRow, ModuleRow, QuizQuestionRow } from '../lib/records';

const secs = (mmss: string) => {
  const [m, s] = mmss.split(':').map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
};

type LessonSpec = ['video', string, string] | ['pdf', string] | ['quiz', string, QuizQuestionRow[]];

export const V = (title: string, mmss: string): LessonSpec => ['video', title, mmss];
export const P = (title: string): LessonSpec => ['pdf', title];
export const Q = (title: string, questions: QuizQuestionRow[]): LessonSpec => ['quiz', title, questions];

export function modules(courseKey: string, spec: [string, LessonSpec[]][]): ModuleRow[] {
  return spec.map(([title, lessons], mi) => ({
    id: `mod_${courseKey}_${mi}`,
    title,
    lessons: lessons.map((l, li): LessonRow => {
      const id = `les_${courseKey}_${mi}_${li}`;
      const base = { id, title: l[1], freePreview: mi === 0 && li === 0, questions: [], pdfSizeBytes: null, durationSeconds: null };
      if (l[0] === 'video') return { ...base, type: 'video', durationSeconds: secs(l[2]) };
      if (l[0] === 'pdf') return { ...base, type: 'pdf', pdfSizeBytes: 1_258_291 };
      return { ...base, type: 'quiz', questions: l[2].map((q, qi) => ({ ...q, id: `${id}_q${qi}` })) };
    }),
  }));
}

/** The design's three-question check, reused for every quiz in the seed. */
export const funnelQuiz = (): QuizQuestionRow[] => [
  {
    id: '',
    prompt: 'What is the primary job of the top of your funnel?',
    options: [
      'Close the sale immediately',
      'Attract the right strangers and earn attention',
      'Collect payment details',
      'Reduce refund requests',
    ],
    answer: 1,
  },
  {
    id: '',
    prompt: 'Your landing page headline should lead with…',
    options: ['Your credentials', 'The features of the course', 'The outcome your student wants', 'The price'],
    answer: 2,
  },
  {
    id: '',
    prompt: 'A funnel is "leaking" when…',
    options: ['Traffic is too high', 'One step converts far below the others', 'You send too many emails', 'The course is too short'],
    answer: 1,
  },
];

export const lessonIds = (mods: ModuleRow[]) => mods.flatMap((m) => m.lessons.map((l) => l.id));
