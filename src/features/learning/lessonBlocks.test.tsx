// @vitest-environment jsdom
// Lesson content blocks (course builder v2, docs/api/learning.md → `blocks`): every block type renders accessibly,
// only `text`/`callout` html is inserted as HTML, unknown types are skipped, and lessons without blocks keep bodyHtml.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { camelize } from '@/lib/api/case';
import { LessonBlocks } from './components/LessonBlocks';
import { Player } from './components/Player';
import type { LearnerBlock, Lesson, PlayerCourse } from './types';

const player: { lesson: Lesson | null } = { lesson: null };
const course: PlayerCourse = {
  courseId: 'c1',
  slug: 'funnels',
  title: 'Funnels',
  progress: { completed: 0, total: 1, percent: 0 },
  modules: [{ id: 'm1', title: 'Start', lessons: [] }],
  communitySpace: null,
};
vi.mock('./api', () => ({
  useApplyTimeBeat: () => vi.fn(),
  usePlaybackCompletion: () => vi.fn(),
  useAskQuestion: () => ({ mutate: vi.fn(), isPending: false }),
  useCheckBlock: () => ({ mutate: vi.fn(), isPending: false }),
  useContinueBlock: () => ({ mutate: vi.fn(), isPending: false }),
  useSortBlock: () => ({ mutate: vi.fn(), isPending: false }),
  useLesson: () => ({ data: player.lesson, isPending: false }),
  usePlayerCourse: () => ({ data: course }),
  useSaveNote: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitQuiz: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleComplete: () => ({ mutate: vi.fn(), isPending: false }),
  useTutor: () => ({}),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/toast/Toaster', () => ({ useToast: () => vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalizedRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const withIntl = (ui: ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);
const renderBlocks = (blocks: LearnerBlock[], embedded = false) =>
  render(withIntl(<LessonBlocks blocks={blocks} lessonTitle="Funnels 101" embedded={embedded} />));

afterEach(cleanup);

const SIGNED = (name: string) => `https://media.test/${name}?token=signed`;

/** The learner `blocks` array as the API sends it (snake_case), through the client's case conversion. */
const wire = [
  { id: 'blk_a', type: 'heading', text: 'Big idea', level: 2 },
  { id: 'blk_b', type: 'heading', text: 'Detail', level: 3 },
  { id: 'blk_c', type: 'text', html: '<p>Hello <strong>world</strong></p>' },
  { id: 'blk_d', type: 'callout', tone: 'warning', html: '<p>Careful <em>now</em></p>' },
  { id: 'blk_e', type: 'quote', text: 'Less is more.', cite: 'Mies', style: 'large' },
  { id: 'blk_f', type: 'list', style: 'numbered', items: ['One', 'Two'] },
  { id: 'blk_g', type: 'list', style: 'check', items: ['Done'] },
  { id: 'blk_h', type: 'divider' },
  { id: 'blk_i', type: 'code', language: 'js', code: 'const x = "<b>1</b>";' },
  { id: 'blk_j', type: 'button', label: 'Workbook', url: 'https://example.com/wb', style: 'primary' },
  {
    id: 'blk_k',
    type: 'table',
    header: true,
    rows: [
      ['Stage', 'Metric'],
      ['Attract', 'Visits'],
    ],
  },
  { id: 'blk_l', type: 'image', url: SIGNED('i.png'), alt: 'A funnel', caption: 'The funnel', width: 'wide' },
  {
    id: 'blk_m',
    type: 'gallery',
    items: [
      { url: SIGNED('g1.png'), alt: 'First', caption: 'One' },
      { url: SIGNED('g2.png'), alt: 'Second', caption: null },
      { url: SIGNED('g3.png'), alt: 'Third', caption: null },
    ],
  },
  {
    id: 'blk_n',
    type: 'video',
    hls_url: null,
    poster_url: null,
    captions: [],
    drm: null,
    url: null,
    embed_url: 'https://www.youtube-nocookie.com/embed/x',
    watermark: null,
  },
  { id: 'blk_o', type: 'audio', url: SIGNED('a.mp3'), name: 'Interview.mp3' },
  { id: 'blk_p', type: 'pdf', url: SIGNED('w.pdf'), size_bytes: 2048, name: 'Worksheet.pdf' },
  { id: 'blk_q', type: 'file', url: SIGNED('t.xlsx'), name: 'Template.xlsx', size_bytes: 1_048_576, label: 'Budget template' },
  { id: 'blk_r', type: 'embed', src: 'https://www.figma.com/embed?embed_host=coursiva&url=x', height: 520, provider: 'Figma' },
  { id: 'blk_s', type: 'hologram', data: { html: '<img src=x onerror=alert(1)>' } },
];
const blocks = camelize<LearnerBlock[]>(wire);

describe('LessonBlocks', () => {
  it('renders headings under the lesson title (h2/h3), one level down when embedded', () => {
    renderBlocks(blocks);
    expect(screen.getByRole('heading', { level: 2, name: 'Big idea' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Detail' })).toBeTruthy();
    cleanup();
    renderBlocks(blocks.slice(0, 2), true);
    expect(screen.getByRole('heading', { level: 3, name: 'Big idea' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'Detail' })).toBeTruthy();
  });

  it('inserts the API’s html for text and callouts only; other strings are escaped', () => {
    const { container } = renderBlocks(blocks);
    expect(container.querySelector('strong')?.textContent).toBe('world');
    const note = screen.getByRole('note', { name: 'Warning' });
    expect(note.querySelector('em')?.textContent).toBe('now');
    // Code is text: its markup shows as typed.
    expect(container.querySelector('pre code')?.textContent).toBe('const x = "<b>1</b>";');
    expect(container.querySelector('pre b')).toBeNull();
  });

  it('skips unknown block types silently', () => {
    const { container } = renderBlocks(blocks);
    expect(container.innerHTML).not.toContain('onerror');
    expect(container.querySelectorAll('img[src="x"]')).toHaveLength(0);
    const { container: only } = renderBlocks([blocks.at(-1)!]);
    expect(only.querySelector('div')?.childElementCount).toBe(0);
  });

  it('renders quotes, lists and dividers', () => {
    const { container } = renderBlocks(blocks);
    const quote = container.querySelector('figure[data-style="large"]')!;
    expect(quote.querySelector('blockquote')?.textContent).toBe('Less is more.');
    expect(quote.querySelector('figcaption')?.textContent).toContain('Mies');
    expect(
      within(container.querySelector('ol')!)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['One', 'Two']);
    expect(container.querySelector('ul[data-style="check"] li')?.textContent).toBe('Done');
    expect(container.querySelector('hr')).toBeTruthy();
  });

  it('labels code as a scrollable region and copies it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderBlocks(blocks);
    const region = screen.getByRole('region', { name: 'Code (js)' });
    expect(region.tabIndex).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith('const x = "<b>1</b>";');
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('opens external buttons in a new tab, safely', () => {
    renderBlocks(blocks);
    const link = screen.getByRole('link', { name: /Workbook/ });
    expect(link.getAttribute('href')).toBe('https://example.com/wb');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.className).toContain('btn-primary');
  });

  it('renders tables with a header row (th) or without one', () => {
    renderBlocks(blocks);
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Stage', 'Metric']);
    expect(
      within(table)
        .getAllByRole('cell')
        .map((td) => td.textContent),
    ).toEqual(['Attract', 'Visits']);
    expect(screen.getByRole('region', { name: 'Table' }).tabIndex).toBe(0);
    cleanup();
    renderBlocks([{ id: 'blk_t', type: 'table', header: false, rows: [['a', 'b']] }]);
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
    expect(screen.getAllByRole('cell')).toHaveLength(2);
  });

  it('renders images as lazy plain <img> with alt and a figcaption; decorative images have empty alt', () => {
    const { container } = renderBlocks(blocks);
    const img = screen.getByRole('img', { name: 'A funnel' });
    expect(img.getAttribute('src')).toBe(SIGNED('i.png'));
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.closest('figure')?.getAttribute('data-width')).toBe('wide');
    expect(img.closest('figure')?.querySelector('figcaption')?.textContent).toBe('The funnel');
    cleanup();
    const { container: deco } = renderBlocks([{ id: 'blk_u', type: 'image', url: SIGNED('d.png'), alt: '', caption: null, width: 'full' }]);
    expect(deco.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(deco.querySelector('figcaption')).toBeNull();
    expect(container).toBeTruthy();
  });

  it('shows a gallery as a carousel driven by buttons and arrow keys', () => {
    renderBlocks(blocks);
    const gallery = screen.getByRole('region', { name: 'Image gallery' });
    expect(within(gallery).getByRole('img', { name: 'First' })).toBeTruthy();
    expect(within(gallery).getByText('Image 1 of 3')).toBeTruthy();
    fireEvent.click(within(gallery).getByRole('button', { name: 'Next image' }));
    expect(within(gallery).getByRole('img', { name: 'Second' })).toBeTruthy();
    const thumb2 = within(gallery).getByRole('button', { name: 'Show image 2' });
    expect(thumb2.getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(thumb2, { key: 'ArrowRight' });
    expect(within(gallery).getByRole('img', { name: 'Third' })).toBeTruthy();
    expect(document.activeElement).toBe(within(gallery).getByRole('button', { name: 'Show image 3' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(within(gallery).getByText('Image 1 of 3')).toBeTruthy();
    fireEvent.click(within(gallery).getByRole('button', { name: 'Previous image' }));
    expect(within(gallery).getByText('Image 3 of 3')).toBeTruthy();
  });

  it('plays a video block in the lesson video player (no playback reports)', () => {
    renderBlocks(blocks);
    fireEvent.click(screen.getByRole('button', { name: /Video: Funnels 101/ }));
    const frame = screen.getByTitle('Video: Funnels 101');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/x');
  });

  it('renders audio, the inline PDF viewer with its link, and the file download card', () => {
    const { container } = renderBlocks(blocks);
    const audio = container.querySelector('audio')!;
    expect(audio.getAttribute('src')).toBe(SIGNED('a.mp3'));
    expect(audio.hasAttribute('controls')).toBe(true);

    // An iframe: the site's CSP (`object-src 'none'`) blocks <object>/<embed>.
    expect(container.querySelector('object, embed')).toBeNull();
    const pdf = container.querySelector('iframe')!;
    expect(pdf.getAttribute('src')).toBe(SIGNED('w.pdf'));
    const open = screen.getByRole('link', { name: /Open PDF/ });
    expect(open.getAttribute('href')).toBe(SIGNED('w.pdf'));
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('PDF · 2 KB')).toBeTruthy();

    const download = screen.getByRole('link', { name: 'Download Budget template' });
    expect(download.getAttribute('href')).toBe(SIGNED('t.xlsx'));
    expect(download.hasAttribute('download')).toBe(true);
    expect(screen.getByText('Budget template')).toBeTruthy();
    expect(screen.getByText(/Template\.xlsx · 1 MB/)).toBeTruthy();
  });

  it('sandboxes embeds', () => {
    renderBlocks(blocks);
    const frame = screen.getByTitle('Figma embed');
    expect(frame.getAttribute('src')).toBe('https://www.figma.com/embed?embed_host=coursiva&url=x');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-popups allow-forms allow-presentation');
    expect(frame.getAttribute('allow')).toBe('fullscreen; picture-in-picture');
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(frame.getAttribute('loading')).toBe('lazy');
    expect(frame.getAttribute('height')).toBe('520');
  });

  it('drops embeds and buttons whose URL isn’t https', () => {
    const { container } = renderBlocks([
      { id: 'blk_v', type: 'embed', src: 'javascript:alert(1)', height: 480, provider: 'X' },
      { id: 'blk_w', type: 'button', label: 'Bad', url: 'javascript:alert(1)', style: 'primary' },
    ]);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });
});

/** Interactive blocks (O3) as the API sends them (snake_case). */
const interactiveWire = [
  {
    id: 'blk_ac',
    type: 'accordion',
    items: [
      { title: 'What is a lead magnet?', html: '<p>A <strong>free</strong> resource.</p>' },
      { title: 'How long?', html: '<p>Three emails.</p>' },
    ],
  },
  {
    id: 'blk_tb',
    type: 'tabs',
    items: [
      { title: 'Page', html: '<p>One promise.</p>' },
      { title: 'Magnet', html: '<p>A checklist.</p>' },
      { title: 'Emails', html: '<p>Deliver, teach, invite.</p>' },
    ],
  },
  {
    id: 'blk_pr',
    type: 'process',
    items: [
      { title: 'Pick an audience', html: '<p>Who is it for?</p>' },
      { title: 'Write the promise', html: '<p>One sentence.</p>' },
      { title: 'Build the page', html: '<p>Headline and form.</p>' },
    ],
  },
  {
    id: 'blk_tl',
    type: 'timeline',
    items: [
      { date: 'Week 1', title: 'Offer', html: '<p>Draft it.</p>' },
      { date: 'Week 2', title: 'Magnet', html: '<p>Make it.</p>' },
    ],
  },
  {
    id: 'blk_fg',
    type: 'flashcards',
    style: 'grid',
    cards: [
      { front: 'Opt-in rate', back: 'Sign-ups ÷ visitors.', image_url: SIGNED('card.png') },
      { front: 'Nurture', back: 'Emails that build trust.', image_url: null },
    ],
  },
  {
    id: 'blk_fs',
    type: 'flashcards',
    style: 'stack',
    cards: [
      { front: 'CTA', back: 'Call to action.', image_url: null },
      { front: 'Fold', back: 'What shows before scrolling.', image_url: null },
    ],
  },
  {
    id: 'blk_hs',
    type: 'hotspots',
    url: SIGNED('wire.png'),
    alt: 'A landing page wireframe',
    spots: [
      { x: 30, y: 33.5, title: 'Headline', html: '<p>Under <em>ten</em> words.</p>' },
      { x: 120, y: -5, title: 'Proof', html: '<p>A result.</p>' },
    ],
  },
];
const interactive = camelize<LearnerBlock[]>(interactiveWire);

const check = (over: Record<string, unknown> = {}) =>
  camelize<LearnerBlock>({
    id: 'blk_ck',
    type: 'check',
    kind: 'single',
    question_html: '<p>Which stage turns visitors into <strong>leads</strong>?</p>',
    options: [
      { id: 'a', text: 'Attract' },
      { id: 'b', text: 'Convert' },
    ],
    required: true,
    state: null,
    ...over,
  });
const snakeSorting = {
  id: 'blk_so',
  type: 'sorting',
  prompt: 'Sort each item.',
  categories: [
    { id: 'attract', label: 'Attract' },
    { id: 'convert', label: 'Convert' },
  ],
  items: [
    { id: 'ads', text: 'Social ads' },
    { id: 'form', text: 'Opt-in form' },
  ],
  state: null,
};
const sorting = camelize<LearnerBlock>(snakeSorting);
const gate = camelize<LearnerBlock>({ id: 'blk_go', type: 'continue', label: 'Continue', passed: false });

describe('interactive blocks', () => {
  it('renders accordions as native disclosures with the API’s html', () => {
    const { container } = renderBlocks(interactive);
    const details = container.querySelectorAll('details');
    const summaries = [...container.querySelectorAll('details > summary')].map((x) => x.textContent);
    expect(summaries.slice(0, 2)).toEqual(['What is a lead magnet?', 'How long?']);
    expect(details[0]!.open).toBe(false);
    expect(details[0]!.querySelector('strong')?.textContent).toBe('free');
  });

  it('follows the WAI-ARIA tabs pattern with arrow keys, Home and End', () => {
    renderBlocks(interactive);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((x) => x.textContent)).toEqual(['Page', 'Magnet', 'Emails']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs.map((x) => x.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.getByRole('tabpanel', { name: 'Page' }).textContent).toBe('One promise.');
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Magnet' }).textContent).toBe('A checklist.');
    expect(screen.queryByRole('tabpanel', { name: 'Page' })).toBeNull();
    fireEvent.keyDown(tabs[1]!, { key: 'End' });
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2]!, { key: 'Home' });
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]!.getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id);
  });

  it('shows a process one step at a time with an indicator and Previous/Next', () => {
    renderBlocks(interactive);
    const steps = screen.getByRole('region', { name: 'Steps' });
    expect(within(steps).getByText('Step 1 of 3')).toBeTruthy();
    expect(within(steps).getByText('Pick an audience')).toBeTruthy();
    expect(within(steps).getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(within(steps).getByRole('button', { name: 'Next' }));
    expect(within(steps).getByText('Step 2 of 3')).toBeTruthy();
    expect(within(steps).getByText('One sentence.')).toBeTruthy();
    expect(within(steps).getByRole('button', { name: 'Step 2: Write the promise' }).getAttribute('aria-current')).toBe('step');
    fireEvent.click(within(steps).getByRole('button', { name: 'Step 3: Build the page' }));
    expect(within(steps).getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('renders a timeline as an ordered list of dated entries', () => {
    const { container } = renderBlocks(interactive);
    const items = [...container.querySelectorAll('ol li')].filter((li) => li.textContent.includes('Week'));
    expect(items.map((li) => li.textContent)).toEqual(['Week 1OfferDraft it.', 'Week 2MagnetMake it.']);
  });

  it('flips grid flashcards with click, Enter and Space; the name says which side shows', async () => {
    const user = userEvent.setup();
    renderBlocks(interactive);
    const grid = screen.getAllByRole('list', { name: 'Flashcards' })[0]!;
    const card = within(grid).getByRole('button', { name: /Front: Opt-in rate/ });
    expect(card.querySelector('img')?.getAttribute('src')).toBe(SIGNED('card.png'));
    card.focus();
    await user.keyboard('{Enter}');
    expect(card).toHaveAccessibleName(/^Back: Sign-ups ÷ visitors\./);
    await user.keyboard(' ');
    expect(card).toHaveAccessibleName(/^Front: Opt-in rate/);
    await user.click(card);
    expect(card.hasAttribute('data-flipped')).toBe(true);
  });

  it('steps through a flashcard stack with a counter; a new card shows its front', async () => {
    const user = userEvent.setup();
    renderBlocks(interactive);
    const stack = screen.getByRole('region', { name: 'Flashcards' });
    expect(within(stack).getByText('Card 1 of 2')).toBeTruthy();
    await user.click(within(stack).getByRole('button', { name: /Front: CTA/ }));
    expect(within(stack).getByRole('button', { name: /Back: Call to action/ })).toBeTruthy();
    await user.click(within(stack).getByRole('button', { name: 'Next card' }));
    expect(within(stack).getByText('Card 2 of 2')).toBeTruthy();
    expect(within(stack).getByRole('button', { name: /Front: Fold/ })).toBeTruthy();
    expect(within(stack).getByRole('button', { name: 'Next card' })).toBeDisabled();
  });

  it('places hotspots by percent, opens their panel, closes it with Escape and lists them', async () => {
    const user = userEvent.setup();
    const { container } = renderBlocks(interactive);
    expect(screen.getByRole('img', { name: 'A landing page wireframe' }).getAttribute('src')).toBe(SIGNED('wire.png'));
    const spot = screen.getByRole('button', { name: 'Headline' });
    expect(spot.style.left).toBe('30%');
    expect(spot.style.top).toBe('33.5%');
    // Out-of-range coordinates are clamped to the image.
    const proof = screen.getByRole('button', { name: 'Proof' });
    expect([proof.style.left, proof.style.top]).toEqual(['100%', '0%']);
    expect(spot.getAttribute('aria-expanded')).toBe('false');
    await user.click(spot);
    expect(spot.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('region', { name: 'Headline' });
    expect(panel.id).toBe(spot.getAttribute('aria-controls'));
    expect(panel.querySelector('em')?.textContent).toBe('ten');
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(spot.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(spot);
    await user.keyboard('{Enter}');
    expect(spot.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    expect(spot.getAttribute('aria-expanded')).toBe('false');
    const list = [...container.querySelectorAll('details')].find(
      (d) => d.querySelector('summary')?.textContent === 'All 2 points as a list',
    )!;
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['HeadlineUnder ten words.', 'ProofA result.']);
  });

  it('in the guest preview, checks and sorting say to sign in instead of offering Check, and a gate ends the content', () => {
    const after = camelize<LearnerBlock>({ id: 'blk_af', type: 'text', html: '<p>Behind the gate</p>' });
    const { container } = render(
      withIntl(<LessonBlocks blocks={[check(), sorting, gate, after]} lessonTitle="L" blocksLocked={3} embedded />),
    );
    expect(screen.getAllByText('Sign in and enrol to check your answer.')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Check' })).toBeNull();
    expect(screen.getByText('Enrol to see the rest of this lesson.')).toBeTruthy();
    expect(screen.getByText('4 more blocks after you continue')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(container.textContent).not.toContain('Behind the gate');
    // The answers can still be tried.
    fireEvent.click(screen.getByRole('radio', { name: 'Convert' }));
    expect(screen.getByRole('radio', { name: 'Convert' })).toBeChecked();
  });

  it('labels each check by its question and each sorting item’s menu by the item', () => {
    render(withIntl(<LessonBlocks blocks={[check(), sorting, gate]} lessonTitle="L" lessonId="l1" blocksLocked={1} />));
    const form = screen.getByRole('form', { name: 'Which stage turns visitors into leads?' });
    expect(within(form).getByRole('group', { name: 'Which stage turns visitors into leads?' })).toBeTruthy();
    expect(within(form).getByText('Required')).toBeTruthy();
    expect(within(form).getByRole('button', { name: 'Check' })).toBeTruthy();
    const menu = screen.getByRole('combobox', { name: 'Category for Social ads' });
    expect([...menu.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Choose a category…', 'Attract', 'Convert']);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.getByText('1 more block after you continue')).toBeTruthy();
  });

  it('shows a check’s stored answer and verdict, marking the correct option', () => {
    render(
      withIntl(
        <LessonBlocks
          blocks={[
            check({
              state: { answer: { option_ids: ['a'] }, correct: false, correct_option_ids: ['b'], feedback: 'Converting makes leads.' },
            }),
          ]}
          lessonTitle="L"
          lessonId="l1"
        />,
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Not quite.Converting makes leads.');
    expect(screen.getByRole('radio', { name: /Attract/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Attract/ })).toBeDisabled();
    expect(screen.getByText('Correct answer').closest('label')?.textContent).toContain('Convert');
    expect(screen.getByText('Incorrect').closest('label')?.textContent).toContain('Attract');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('restores a sorting board from the last attempt’s placements, with each item’s verdict', () => {
    const answered = camelize<LearnerBlock>({
      ...snakeSorting,
      state: { correct: false, results: { ads: true, form: false }, answer: { placements: { ads: 'attract', form: 'attract' } } },
    });
    render(withIntl(<LessonBlocks blocks={[answered]} lessonTitle="L" lessonId="l1" />));
    expect(screen.getByRole('combobox', { name: 'Category for Social ads' })).toHaveValue('attract');
    expect(screen.getByRole('combobox', { name: 'Category for Opt-in form' })).toHaveValue('attract');
    expect(screen.getByRole('combobox', { name: 'Category for Opt-in form' })).toBeDisabled();
    expect(screen.queryByText('To sort')).toBeNull();
    expect(screen.getByText('Opt-in form').closest('li')?.getAttribute('data-result')).toBe('incorrect');
    expect(screen.getByText('Social ads').closest('li')?.getAttribute('data-result')).toBe('correct');
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 in the right place.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('hides passed gates', () => {
    const { container } = renderBlocks([camelize<LearnerBlock>({ id: 'blk_p', type: 'continue', label: 'Continue', passed: true })]);
    expect(container.querySelector('div')?.childElementCount).toBe(0);
  });
});

describe('the player’s lesson body', () => {
  const lesson = (over: Partial<Lesson>): Lesson => ({
    id: 'l1',
    title: 'Welcome',
    type: 'text',
    durationSeconds: null,
    questionCount: null,
    moduleTitle: 'Start',
    courseSlug: 'funnels',
    description: 'Plain description',
    bodyHtml: '<p>Legacy <em>body</em></p>',
    blocks: null,
    link: null,
    completed: false,
    video: null,
    pdf: null,
    quiz: null,
    scorm: null,
    assignment: null,
    resources: [],
    note: '',
    questions: [],
    nextLessonId: null,
    ...over,
  });
  const renderPlayer = (l: Lesson) => {
    player.lesson = l;
    return render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Player courseSlug="funnels" lessonId="l1" />
      </NextIntlClientProvider>,
    );
  };

  it('renders the blocks instead of bodyHtml when the lesson has a body', () => {
    const { container } = renderPlayer(lesson({ blocks: [{ id: 'blk_x', type: 'text', html: '<p>Block <strong>text</strong></p>' }] }));
    expect(container.querySelector('strong')?.textContent).toBe('text');
    expect(container.textContent).not.toContain('Legacy');
    expect(container.textContent).not.toContain('Plain description');
  });

  it('falls back to bodyHtml, then the description, when blocks is null', () => {
    const { container } = renderPlayer(lesson({}));
    expect(container.querySelector('em')?.textContent).toBe('body');
    cleanup();
    renderPlayer(lesson({ bodyHtml: null }));
    expect(screen.getByText('Plain description')).toBeTruthy();
  });

  it('shows the blocks under the lesson’s activity', () => {
    const { container } = renderPlayer(
      lesson({
        type: 'pdf',
        pdf: { url: SIGNED('l.pdf'), sizeBytes: 10 },
        blocks: [{ id: 'blk_y', type: 'heading', text: 'After the PDF', level: 2 }],
      }),
    );
    const h1 = screen.getByRole('heading', { level: 1, name: 'Welcome' });
    const h2 = screen.getByRole('heading', { level: 2, name: 'After the PDF' });
    expect(h1.compareDocumentPosition(h2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('a[download]')!.compareDocumentPosition(h2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
