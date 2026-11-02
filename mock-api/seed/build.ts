/** Helpers for writing seed courses compactly (mirrors the design's V/P/Q lesson helpers). */
import type { AssignmentRow, LessonRow, ModuleRow, QuizQuestionRow, ScormPackageRow, SurveyRow } from '../lib/records';

const secs = (mmss: string) => {
  const [m, s] = mmss.split(':').map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
};

type LessonSpec =
  | ['extra', LessonSpec, LessonExtra]
  | ['text', string]
  | ['live', string, NonNullable<LessonRow['live']>]
  | ['video', string, string, VideoOpts?]
  | ['pdf', string]
  | ['quiz', string, QuizQuestionRow[]]
  | ['scorm', string, ScormPackageRow]
  | ['assignment', string, AssignmentRow]
  | ['survey', string, SurveyRow];

/** `embedUrl`: a third-party embed (the mock has no uploaded media, so this is its only playable video). */
type VideoOpts = { watermark?: boolean; embedUrl?: string };
/** O4 options on top of a lesson: availability, completion rule. */
type LessonExtra = Partial<Pick<LessonRow, 'available' | 'completionRule' | 'completionValue' | 'freePreview' | 'summary'>>;
export const X = (spec: LessonSpec, extra: LessonExtra): LessonSpec => ['extra', spec, extra];
/** A text lesson. */
export const T = (title: string): LessonSpec => ['text', title];
/** A Live lesson linked to a live session. */
export const L = (title: string, live: NonNullable<LessonRow['live']>): LessonSpec => ['live', title, live];
export const V = (title: string, mmss: string, opts?: VideoOpts): LessonSpec => ['video', title, mmss, opts];
export const P = (title: string): LessonSpec => ['pdf', title];
export const Q = (title: string, questions: QuizQuestionRow[]): LessonSpec => ['quiz', title, questions];
/** SCORM / xAPI lesson. Laravel's learner type for it is `text`; the lesson payload carries a `scorm` block. */
export const S = (title: string, pkg: ScormPackageRow): LessonSpec => ['scorm', title, pkg];
/** Assignment lesson (learner type `text`, with an `assignment` block). */
export const A = (title: string, assignment: AssignmentRow): LessonSpec => ['assignment', title, assignment];
/** Survey lesson (learner type `text`, with a `survey` block; completes on submit). */
export const SV = (title: string, survey: SurveyRow): LessonSpec => ['survey', title, survey];

export function modules(courseKey: string, spec: [string, LessonSpec[]][]): ModuleRow[] {
  return spec.map(([title, lessons], mi) => ({
    id: `mod_${courseKey}_${mi}`,
    title,
    lessons: lessons.map((spec, li): LessonRow => {
      const id = `les_${courseKey}_${mi}_${li}`;
      const extra = spec[0] === 'extra' ? spec[2] : {};
      const l = spec[0] === 'extra' ? spec[1] : spec;
      if (l[0] === 'extra') throw new Error('nested extra');
      const base = {
        id,
        title: l[1],
        freePreview: mi === 0 && li === 0,
        questions: [],
        pdfSizeBytes: null,
        durationSeconds: null,
        ...extra,
      };
      if (l[0] === 'text') return { ...base, type: 'text' };
      if (l[0] === 'live') return { ...base, type: 'live', durationSeconds: l[2].durationMin * 60, live: l[2] };
      if (l[0] === 'video')
        return { ...base, type: 'video', durationSeconds: secs(l[2]), watermark: l[3]?.watermark === true, embedUrl: l[3]?.embedUrl };
      if (l[0] === 'pdf') return { ...base, type: 'pdf', pdfSizeBytes: 1_258_291 };
      if (l[0] === 'scorm') return { ...base, type: 'text', scorm: l[2] };
      if (l[0] === 'assignment') return { ...base, type: 'text', assignment: l[2] };
      if (l[0] === 'survey') return { ...base, type: 'text', survey: l[2] };
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
