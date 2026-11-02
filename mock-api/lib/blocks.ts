import type {
  CheckAnswer,
  CheckKind,
  CheckResult,
  LearnerBlock,
  LearnerCheckBlock,
  LearnerContinueBlock,
  LearnerSortingBlock,
  SortResult,
} from '@/features/learning/types';
import type { TenantData } from './records';

/**
 * Lesson content blocks (course builder v2) as the API renders them for learners (`blocks` on `GET /me/lessons/{id}`
 * and the free-preview lesson). The mock has no media files, so its demo document uses the blocks that need none (the
 * hotspots image is an inline SVG); `html` is what the API's sanitiser would produce from the author's Markdown.
 *
 * Interactive blocks (O3) are kept here as the author saved them — sorting categories, check answers and feedback stay
 * in this file and are only ever used to grade (`gradeCheck` / `gradeSort`); `presentBlocks` builds the learner shape
 * without them, and withholds everything after the first continue gate the learner hasn't passed.
 */

interface AuthoredSorting {
  id: string;
  type: 'sorting';
  prompt: string;
  categories: { id: string; label: string }[];
  items: { id: string; text: string; categoryId: string }[];
}
interface AuthoredCheck {
  id: string;
  type: 'check';
  kind: CheckKind;
  questionHtml: string;
  options: { id: string; text: string }[] | null;
  /** single / multiple: the correct option ids. */
  correct: string[];
  /** fill: accepted answers. */
  answers: string[];
  feedbackCorrect: string;
  feedbackIncorrect: string;
  required: boolean;
}
interface AuthoredContinue {
  id: string;
  type: 'continue';
  label: string;
}
type Authored =
  | Exclude<LearnerBlock, LearnerSortingBlock | LearnerCheckBlock | LearnerContinueBlock>
  | AuthoredSorting
  | AuthoredCheck
  | AuthoredContinue;

const HOTSPOT_IMAGE =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="#eef1fb"/>' +
      '<rect x="40" y="30" width="720" height="60" rx="10" fill="#c9d2f3"/><rect x="60" y="130" width="380" height="40" rx="8" fill="#5866d8"/>' +
      '<rect x="60" y="190" width="300" height="20" rx="6" fill="#aab4e6"/><rect x="60" y="300" width="200" height="56" rx="12" fill="#f08a4b"/>' +
      '<rect x="500" y="130" width="240" height="240" rx="16" fill="#d9def6"/></svg>',
  );

const DEMO: Record<string, Authored[]> = {
  les_f_0_0: [
    { id: 'blk_demo000000000001', type: 'heading', text: 'What you’ll build', level: 2 },
    {
      id: 'blk_demo000000000002',
      type: 'text',
      html: '<p>By the end of this course you’ll have a <strong>working funnel</strong>: a landing page, a lead magnet and a follow-up sequence.</p>',
    },
    {
      id: 'blk_demo000000000003',
      type: 'callout',
      tone: 'tip',
      html: '<p>Keep a notebook open — every lesson ends with one action to complete.</p>',
    },
    { id: 'blk_demo000000000004', type: 'list', style: 'check', items: ['A clear offer', 'One landing page', 'A three-email sequence'] },
    { id: 'blk_demo000000000005', type: 'quote', text: 'Make it simple. Make it memorable.', cite: 'Leo Burnett', style: 'large' },
    { id: 'blk_demo000000000006', type: 'heading', text: 'The funnel at a glance', level: 3 },
    {
      id: 'blk_demo000000000007',
      type: 'table',
      header: true,
      rows: [
        ['Stage', 'Goal', 'Metric'],
        ['Attract', 'Get the right visitors', 'Visits'],
        ['Convert', 'Turn visitors into leads', 'Opt-in rate'],
        ['Nurture', 'Build trust by email', 'Click rate'],
      ],
    },
    { id: 'blk_demo000000000008', type: 'code', language: 'html', code: '<a href="/start" class="cta">Get the free guide →</a>' },
    { id: 'blk_demo000000000009', type: 'divider' },
    { id: 'blk_demo000000000010', type: 'button', label: 'Open the workbook', url: 'https://example.com/workbook', style: 'secondary' },
    {
      id: 'blk_demo000000000011',
      type: 'accordion',
      items: [
        { title: 'What is a lead magnet?', html: '<p>A small, <strong>free</strong> resource you trade for an email address.</p>' },
        { title: 'How long should the sequence be?', html: '<p>Three emails over a week is plenty to start.</p>' },
      ],
    },
    {
      id: 'blk_demo000000000012',
      type: 'tabs',
      items: [
        { title: 'Landing page', html: '<p>One promise, one form, one button.</p>' },
        { title: 'Lead magnet', html: '<p>A checklist or template beats a long ebook.</p>' },
        { title: 'Emails', html: '<p>Deliver, teach, then invite.</p>' },
      ],
    },
    {
      id: 'blk_demo000000000013',
      type: 'process',
      items: [
        { title: 'Pick one audience', html: '<p>Write down who the funnel is for.</p>' },
        { title: 'Write the promise', html: '<p>One sentence: what they get and how fast.</p>' },
        { title: 'Build the page', html: '<p>Headline, three bullets, the form.</p>' },
      ],
    },
    {
      id: 'blk_demo000000000014',
      type: 'timeline',
      items: [
        { date: 'Week 1', title: 'Offer and page', html: '<p>Draft the offer and publish the page.</p>' },
        { date: 'Week 2', title: 'Lead magnet', html: '<p>Create and attach the free resource.</p>' },
        { date: 'Week 3', title: 'Emails', html: '<p>Write and schedule the sequence.</p>' },
      ],
    },
    {
      id: 'blk_demo000000000015',
      type: 'flashcards',
      style: 'grid',
      cards: [
        { front: 'Opt-in rate', back: 'Sign-ups ÷ visitors to the landing page.', imageUrl: null },
        { front: 'Lead magnet', back: 'A free resource exchanged for an email address.', imageUrl: null },
        { front: 'Nurture', back: 'Emails that build trust before you sell.', imageUrl: null },
      ],
    },
    {
      id: 'blk_demo000000000016',
      type: 'flashcards',
      style: 'stack',
      cards: [
        { front: 'CTA', back: 'Call to action — the one thing you ask the visitor to do.', imageUrl: null },
        { front: 'Above the fold', back: 'What shows before the visitor scrolls.', imageUrl: null },
      ],
    },
    {
      id: 'blk_demo000000000017',
      type: 'hotspots',
      url: HOTSPOT_IMAGE,
      alt: 'A landing page wireframe: header, headline, call-to-action button and an image',
      spots: [
        { x: 30, y: 33.5, title: 'Headline', html: '<p>Say the promise in under ten words.</p>' },
        { x: 20, y: 72.5, title: 'Call to action', html: '<p>One button, one verb: <em>Get the guide</em>.</p>' },
        { x: 77.5, y: 55, title: 'Proof', html: '<p>A photo or result that makes the promise believable.</p>' },
      ],
    },
    {
      id: 'blk_demo000000000018',
      type: 'check',
      kind: 'single',
      questionHtml: '<p>Which stage turns visitors into <strong>leads</strong>?</p>',
      options: [
        { id: 'a', text: 'Attract' },
        { id: 'b', text: 'Convert' },
        { id: 'c', text: 'Nurture' },
      ],
      correct: ['b'],
      answers: [],
      feedbackCorrect: 'Right — the landing page converts.',
      feedbackIncorrect: 'Not quite: converting is where a visitor becomes a lead.',
      required: true,
    },
    {
      id: 'blk_demo000000000019',
      type: 'sorting',
      prompt: 'Sort each item into its funnel stage.',
      categories: [
        { id: 'attract', label: 'Attract' },
        { id: 'convert', label: 'Convert' },
      ],
      items: [
        { id: 'ads', text: 'Social ads', categoryId: 'attract' },
        { id: 'seo', text: 'Blog posts', categoryId: 'attract' },
        { id: 'form', text: 'Opt-in form', categoryId: 'convert' },
        { id: 'magnet', text: 'Free checklist', categoryId: 'convert' },
      ],
    },
    { id: 'blk_demo000000000020', type: 'continue', label: 'Continue' },
    {
      id: 'blk_demo000000000021',
      type: 'check',
      kind: 'multiple',
      questionHtml: '<p>Which belong on a landing page? Choose all that apply.</p>',
      options: [
        { id: 'a', text: 'A single clear promise' },
        { id: 'b', text: 'Links to every blog post' },
        { id: 'c', text: 'An opt-in form' },
      ],
      correct: ['a', 'c'],
      answers: [],
      feedbackCorrect: 'Yes — one promise and one form.',
      feedbackIncorrect: '',
      required: false,
    },
    {
      id: 'blk_demo000000000022',
      type: 'check',
      kind: 'fill',
      questionHtml: '<p>The page a visitor lands on from an ad is the ___ page.</p>',
      options: null,
      correct: [],
      answers: ['landing'],
      feedbackCorrect: '',
      feedbackIncorrect: 'Hint: they land on it.',
      required: true,
    },
    { id: 'blk_demo000000000023', type: 'continue', label: 'Finish the lesson' },
    { id: 'blk_demo000000000024', type: 'text', html: '<p>Nice work — you’ve mapped your funnel. On to the next lesson!</p>' },
  ],
  // O4 `checks` completion rule: the lesson completes once every check has an answer.
  les_l_2_2: [
    { id: 'blk_plan000000000001', type: 'text', html: '<p>Two quick questions about your launch plan.</p>' },
    {
      id: 'blk_plan000000000002',
      type: 'check',
      kind: 'single',
      questionHtml: '<p>When should your first launch email go out?</p>',
      options: [
        { id: 'a', text: 'The day the cart opens' },
        { id: 'b', text: 'A week before, to warm the list' },
      ],
      correct: ['b'],
      answers: [],
      feedbackCorrect: 'Yes — warm the list first.',
      feedbackIncorrect: 'Warm the list a week ahead.',
      required: false,
    },
    {
      id: 'blk_plan000000000003',
      type: 'check',
      kind: 'fill',
      questionHtml: '<p>The page people buy on is the ___ page.</p>',
      options: null,
      correct: [],
      answers: ['sales', 'checkout'],
      feedbackCorrect: '',
      feedbackIncorrect: 'Hint: it’s where the sale happens.',
      required: false,
    },
  ],
};

/** The staff preview's draft lesson (lib/preview.ts) reuses the demo document: a required check, sorting and a gate. */
DEMO.les_l_draft_0 = DEMO.les_f_0_0!;

/* ── learner state (the mock's lesson_block_responses / lesson_block_gates) ───────────────────────────────────── */

export interface BlockResponseRow {
  userId: string;
  lessonId: string;
  blockId: string;
  kind: 'check' | 'sort';
  answer: CheckAnswer | Record<string, string>;
  correct: boolean;
  /** check: what the learner got back; sort: per-item results. */
  result: CheckResult | SortResult;
  attempts: number;
  answeredAt: string;
}
export interface BlockGateRow {
  userId: string;
  lessonId: string;
  blockId: string;
  passedAt: string;
}
type BlockState = Pick<TenantData, 'blockResponses' | 'blockGates'>;

const responses = (t: BlockState) => (t.blockResponses ??= []);
const gates = (t: BlockState) => (t.blockGates ??= []);
const responseOf = (t: BlockState, userId: string | null, lessonId: string, blockId: string) =>
  userId ? responses(t).find((r) => r.userId === userId && r.lessonId === lessonId && r.blockId === blockId) : undefined;
const gatePassed = (t: BlockState, userId: string | null, lessonId: string, blockId: string) =>
  !!userId && gates(t).some((g) => g.userId === userId && g.lessonId === lessonId && g.blockId === blockId);

/** FNV-1a → mulberry32: a stable per-learner order (Laravel/Go seed with hash(user id + block id)). */
function seededShuffle<T>(rows: T[], seed: string): T[] {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  const rand = () => {
    h = (h + 0x6d2b79f5) | 0;
    let x = Math.imul(h ^ (h >>> 15), 1 | h);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The authored blocks the learner may see: up to and including the first continue gate they haven't passed. */
function visible(t: BlockState, lessonId: string, userId: string | null): { blocks: Authored[]; locked: number } | null {
  const doc = DEMO[lessonId];
  if (!doc) return null;
  const gate = doc.findIndex((b) => b.type === 'continue' && !gatePassed(t, userId, lessonId, b.id));
  return gate < 0 ? { blocks: doc, locked: 0 } : { blocks: doc.slice(0, gate + 1), locked: doc.length - gate - 1 };
}

function present(t: BlockState, lessonId: string, userId: string | null, b: Authored): LearnerBlock {
  switch (b.type) {
    case 'sorting': {
      const r = responseOf(t, userId, lessonId, b.id);
      return {
        id: b.id,
        type: 'sorting',
        prompt: b.prompt,
        categories: b.categories,
        items: seededShuffle(
          b.items.map(({ id, text }) => ({ id, text })),
          `${userId ?? ''}${b.id}`,
        ),
        state: r
          ? { correct: r.correct, results: (r.result as SortResult).results, answer: { placements: r.answer as Record<string, string> } }
          : null,
      };
    }
    case 'check': {
      const r = responseOf(t, userId, lessonId, b.id);
      return {
        id: b.id,
        type: 'check',
        kind: b.kind,
        questionHtml: b.questionHtml,
        options: b.options,
        required: b.required,
        state: r ? { answer: r.answer, ...(r.result as CheckResult) } : null,
      };
    }
    case 'continue':
      return { id: b.id, type: 'continue', label: b.label, passed: gatePassed(t, userId, lessonId, b.id) };
    default:
      return b;
  }
}

/**
 * `blocks` + `blocks_locked` for a learner (`userId`) or the guest preview (`null`: every gate unpassed, no state).
 * `blocks` is null for lessons without a body.
 */
export function presentBlocks(
  t: BlockState,
  lessonId: string,
  userId: string | null,
): { blocks: LearnerBlock[] | null; blocksLocked: number } {
  const v = visible(t, lessonId, userId);
  if (!v) return { blocks: null, blocksLocked: 0 };
  return { blocks: v.blocks.map((b) => present(t, lessonId, userId, b)), blocksLocked: v.locked };
}

/** The `checks` completion rule: how many of the lesson's checks (behind gates too) this learner has answered. */
export function checkProgress(t: BlockState, lessonId: string, userId: string): { answered: number; total: number } {
  const checks = (DEMO[lessonId] ?? []).filter((b) => b.type === 'check');
  return { answered: checks.filter((b) => responseOf(t, userId, lessonId, b.id)).length, total: checks.length };
}

/**
 * A block the learner can currently reach (behind no unpassed gate), or null (→ 404). The staff preview (`userId`
 * null) reaches every block: its gates open in the browser only.
 */
function reachable(t: BlockState, lessonId: string, userId: string | null, blockId: string) {
  if (userId === null) return DEMO[lessonId]?.find((b) => b.id === blockId) ?? null;
  return visible(t, lessonId, userId)?.blocks.find((b) => b.id === blockId) ?? null;
}

/**
 * The staff preview's blocks (docs/api/learning.md → Staff preview): the whole document — nothing withheld, every gate
 * unpassed (the site opens them client-side), no answers, items in a stable unseeded order. Null without a body.
 */
export function presentPreviewBlocks(lessonId: string): { blocks: LearnerBlock[] | null; blocksLocked: number } {
  const doc = DEMO[lessonId];
  if (!doc) return { blocks: null, blocksLocked: 0 };
  return { blocks: doc.map((b) => present({}, lessonId, null, b)), blocksLocked: 0 };
}

const normalise = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

type Outcome<T> = { notFound: true } | { invalid: Record<string, string> } | { data: T };

function store(t: BlockState, row: Omit<BlockResponseRow, 'attempts' | 'answeredAt'>) {
  const existing = responseOf(t, row.userId, row.lessonId, row.blockId);
  const answeredAt = new Date().toISOString();
  if (existing) Object.assign(existing, row, { attempts: existing.attempts + 1, answeredAt });
  else responses(t).push({ ...row, attempts: 1, answeredAt });
}

/** `POST …/blocks/{blockId}/check` `{ option_ids?, text? }`. */
export function gradeCheck(
  t: BlockState,
  lessonId: string,
  /** null: the staff preview — graded statelessly, nothing stored. */
  userId: string | null,
  blockId: string,
  input: { optionIds?: unknown; text?: unknown },
): Outcome<CheckResult> {
  const b = reachable(t, lessonId, userId, blockId);
  if (b?.type !== 'check') return { notFound: true };
  let answer: CheckAnswer;
  let correct: boolean;
  if (b.kind === 'fill') {
    if (typeof input.text !== 'string' || !input.text.trim()) return { invalid: { text: 'The text field is required.' } };
    if (input.text.length > 200) return { invalid: { text: 'The text field must not be greater than 200 characters.' } };
    answer = { text: input.text };
    correct = b.answers.some((a) => normalise(a) === normalise(input.text as string));
  } else {
    const ids = input.optionIds;
    const known = new Set((b.options ?? []).map((o) => o.id));
    if (!Array.isArray(ids) || !ids.length || !ids.every((x) => typeof x === 'string' && known.has(x)) || new Set(ids).size !== ids.length)
      return { invalid: { option_ids: 'Choose one of the answers.' } };
    if (b.kind === 'single' && ids.length !== 1) return { invalid: { option_ids: 'Choose exactly one answer.' } };
    answer = { optionIds: ids as string[] };
    correct = ids.length === b.correct.length && b.correct.every((x) => ids.includes(x));
  }
  const feedback = (correct ? b.feedbackCorrect : b.feedbackIncorrect) || null;
  const result: CheckResult = { correct, correctOptionIds: b.kind === 'fill' ? [] : b.correct, feedback };
  if (userId) store(t, { userId, lessonId, blockId, kind: 'check', answer, correct, result });
  return { data: result };
}

/** `POST …/blocks/{blockId}/sort` `{ placements: { item_id: category_id } }` — every item exactly once. */
/** `userId` null: the staff preview — graded statelessly, nothing stored. */
export function gradeSort(
  t: BlockState,
  lessonId: string,
  userId: string | null,
  blockId: string,
  placements: unknown,
): Outcome<SortResult> {
  const b = reachable(t, lessonId, userId, blockId);
  if (b?.type !== 'sorting') return { notFound: true };
  const p =
    placements !== null && typeof placements === 'object' && !Array.isArray(placements) ? (placements as Record<string, unknown>) : null;
  const cats = new Set(b.categories.map((c) => c.id));
  const keys = p ? Object.keys(p) : [];
  if (!p || keys.length !== b.items.length || !b.items.every((i) => typeof p[i.id] === 'string' && cats.has(p[i.id] as string)))
    return { invalid: { placements: 'Place every item in a category.' } };
  const results = Object.fromEntries(b.items.map((i) => [i.id, p[i.id] === i.categoryId]));
  const correct = Object.values(results).every(Boolean);
  if (userId) store(t, { userId, lessonId, blockId, kind: 'sort', answer: p, correct, result: { correct, results } });
  return { data: { correct, results } };
}

/** `POST …/blocks/{blockId}/continue` — 422 while a required check since the previous gate has no answer. */
export function passGate(t: BlockState, lessonId: string, userId: string, blockId: string): Outcome<{ passed: true }> | { required: true } {
  const v = visible(t, lessonId, userId);
  const at = v?.blocks.findIndex((b) => b.id === blockId) ?? -1;
  if (!v || at < 0 || v.blocks[at]!.type !== 'continue') return { notFound: true };
  if (gatePassed(t, userId, lessonId, blockId)) return { data: { passed: true } };
  let from = at - 1;
  while (from >= 0 && v.blocks[from]!.type !== 'continue') from--;
  const section = v.blocks.slice(from + 1, at);
  if (section.some((b) => b.type === 'check' && b.required && !responseOf(t, userId, lessonId, b.id))) return { required: true };
  gates(t).push({ userId, lessonId, blockId, passedAt: new Date().toISOString() });
  return { data: { passed: true } };
}
