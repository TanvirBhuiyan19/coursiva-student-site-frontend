// @vitest-environment jsdom
// School-written Markdown on the learner pages: the assignment brief and the instructor's feedback, and the product
// description on its sales page (rendered), in its JSON-LD (plain).
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { ProductView } from '@/features/commerce/components/ProductView';
import type { ProductPage } from '@/features/commerce/types';
import type { Site } from '@/features/tenant/types';
import { productJsonLd } from '@/lib/seo';
import AssignmentView from './components/AssignmentView';
import type { AssignmentBlock, Lesson } from './types';

vi.mock('@/components/toast/Toaster', () => ({ useToast: () => vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const withIntl = (ui: ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const assignment = (over: Partial<AssignmentBlock> = {}): AssignmentBlock => ({
  id: 'as_1',
  title: 'Landing page',
  brief: '## What to hand in\n\nA **one-page** draft.\nKeep it short.',
  points: 10,
  dueAt: null,
  dueKind: null,
  dueWeekday: null,
  reviewMode: 'instructor',
  peerReview: null,
  latePolicy: 'accepted',
  attempts: null,
  fileTypes: [],
  maxFileMb: 10,
  maxFiles: 1,
  gatesNextModule: false,
  rubric: [],
  submission: null,
  canSubmit: false,
  ...over,
});

const lesson = (a: AssignmentBlock) => ({ id: 'l1', courseSlug: 'c', description: 'Lesson text', assignment: a }) as unknown as Lesson;

describe('assignment brief and feedback', () => {
  it('renders the brief as Markdown, its heading under the section’s h2, newlines kept', () => {
    const { container } = render(withIntl(<AssignmentView lesson={lesson(assignment())} />));
    expect(screen.getByRole('heading', { level: 3, name: 'What to hand in' })).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('one-page');
    expect(container.innerHTML).toContain('<strong>one-page</strong> draft.<br>Keep it short.');
    expect(container.textContent).not.toContain('**');
  });

  it('renders the grade feedback and a resubmission request as Markdown', () => {
    const submission = {
      id: 's1',
      status: 'resubmit' as const,
      attempt: 1,
      submittedAt: '2026-10-01T10:00:00Z',
      lateByDays: 0,
      text: 'My **work**',
      files: [],
      grade: { points: 6, maxPoints: 10, percent: 60, feedback: 'Good start.\n- Fix the *headline*', gradedAt: '2026-10-02T10:00:00Z' },
      resubmitFeedback: 'Please add a [pricing table](https://example.com/help).',
      peerFeedback: [],
    };
    const { container } = render(withIntl(<AssignmentView lesson={lesson(assignment({ brief: '', submission }))} />));
    expect(container.querySelector('li em')?.textContent).toBe('headline');
    expect(screen.getByRole('link', { name: 'pricing table' }).getAttribute('href')).toBe('https://example.com/help');
    expect(screen.getByText('Your instructor asked for changes:')).toBeTruthy();
    // The learner's own submission text stays as typed.
    expect(screen.getByText('My **work**')).toBeTruthy();
  });
});

describe('product description', () => {
  const product: ProductPage = {
    slug: 'swipe-file',
    kind: 'download',
    title: 'Swipe file',
    description: '## Inside\n\nFifty **proven** emails ![x](https://media.example.com/x.png)',
    thumbnailUrl: null,
    price: { amount: 1900, currency: 'USD' },
    compareAtPrice: null,
    file: null,
    delivery: null,
    courses: [],
    service: null,
  };

  it('renders on the sales page (top heading an h2 under the title, no images) and is plain in JSON-LD', () => {
    const { container } = render(withIntl(<ProductView product={product} />));
    expect(screen.getByRole('heading', { level: 2, name: 'Inside' })).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('proven');
    expect(container.querySelector('img')).toBeNull();
    expect(productJsonLd({ name: 'Amplify' } as Site, 'https://amplify.example.com', product).description).toBe(
      'Inside\nFifty proven emails x',
    );
  });
});
