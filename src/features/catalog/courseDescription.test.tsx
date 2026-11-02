// @vitest-environment jsdom
// The course description is Markdown from the dashboard's rich text editor: formatted on the course page, plain in
// its JSON-LD; an older plain-text description reads as before.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import type { Site } from '@/features/tenant/types';
import { courseJsonLd } from '@/lib/seo';
import { CourseDetailView } from './components/CourseDetailView';
import type { CourseDetail } from './types';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useAppPathname: () => '/',
}));
vi.mock('@/features/learning/api', () => ({ useEnrollmentFor: () => null }));
vi.mock('./components/CourseDetailClient', () => ({
  ExpandAll: () => null,
  MobileBuyBar: () => null,
  PurchaseCard: () => null,
  SectionNav: () => null,
  WriteReview: () => null,
  PreviewButton: () => null,
}));

const course = (over: Partial<CourseDetail> = {}): CourseDetail => ({
  id: 'c1',
  slug: 'funnels',
  title: 'Funnels 101',
  excerpt: 'Who it is for Busy founders.',
  category: null,
  cover: { url: null, color: '#123', alt: '' },
  level: 'beginner',
  instructor: { name: 'Maya Reyes', initials: 'MR', avatarUrl: null, color: '#333', slug: null },
  rating: 0,
  reviewCount: 0,
  studentCount: 5,
  lessonCount: 3,
  durationMinutes: 40,
  price: { amount: 4900, currency: 'USD' },
  pricing: { model: 'one_time', interval: null, minimumPrice: null },
  paymentPlan: null,
  featured: false,
  updatedAt: '2026-10-06T00:00:00Z',
  description: '## Who it is for\n\nBusy **founders** who want [a plan](https://example.com/plan).\n\n- Pricing\n- Launch',
  outcomes: [],
  requirements: [],
  audience: [],
  faqs: [],
  modules: [],
  instructorProfile: {
    role: 'Instructor',
    bio: '',
    studentCount: 0,
    slug: null,
    headline: '',
    courseCount: 0,
    rating: null,
    reviewCount: 0,
  },
  guaranteeDays: 0,
  certificate: false,
  community: false,
  preview: null,
  reviews: [],
  ratingDistribution: [],
  includedInPlan: null,
  related: [],
  language: 'en',
  publishedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

describe('course description', () => {
  it('renders the Markdown on the course page, its top heading an h3 under the Overview h2', () => {
    wrap(<CourseDetailView course={course()} />);
    const overview = document.getElementById('overview')!;
    expect(overview.querySelector('h3')?.textContent).toBe('Who it is for');
    expect(screen.getByText('founders').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'a plan' })).toHaveAttribute('href', 'https://example.com/plan');
    expect(overview.querySelectorAll('li')).toHaveLength(2);
    expect(overview.textContent).not.toContain('**');
  });

  it('renders the editor’s ## / ### headings and quotes below the Overview h2', () => {
    wrap(<CourseDetailView course={course({ description: '## Format\n\nWeekly calls.\n\n### Cohorts\n\n> Best course I took.' })} />);
    const overview = document.getElementById('overview')!;
    expect(overview.querySelector('.rich-text h3')?.textContent).toBe('Format');
    expect(overview.querySelector('.rich-text h4')?.textContent).toBe('Cohorts');
    expect(overview.querySelector('.rich-text blockquote')?.textContent).toBe('Best course I took.');
    expect(overview.textContent).not.toMatch(/[#>]/);
  });

  it('keeps a plain-text description’s line breaks and hides one that only repeats the excerpt', () => {
    const { unmount } = wrap(<CourseDetailView course={course({ description: 'Line one\nLine two', excerpt: 'Short pitch' })} />);
    expect(document.getElementById('overview')!.querySelector('br')).not.toBeNull();
    unmount();
    wrap(<CourseDetailView course={course({ description: 'Short **pitch**', excerpt: 'Short pitch' })} />);
    expect(document.getElementById('overview')!.querySelector('strong')).toBeNull();
  });

  it('gives JSON-LD the plain text', () => {
    const site = { name: 'Amplify' } as Site;
    expect(courseJsonLd(site, 'https://amplify.example.com', 'en', course()).description).toBe(
      'Who it is for\nBusy founders who want a plan.\nPricing\nLaunch',
    );
    expect(courseJsonLd(site, 'https://amplify.example.com', 'en', course({ description: '' })).description).toBe(
      'Who it is for Busy founders.',
    );
  });
});

describe('lesson summary in the course outline', () => {
  const withSummaries = (summary: string | null) =>
    course({
      modules: [
        {
          id: 'm1',
          title: 'Start here',
          lessons: [
            { id: 'l1', title: 'Intro', type: 'video', durationSeconds: 60, questionCount: null, freePreview: false, summary },
            { id: 'l2', title: 'Notes', type: 'text', durationSeconds: null, questionCount: null, freePreview: false, summary: null },
          ],
        },
      ],
    });

  it('renders a bold / list / link summary as formatted rich text inside the expandable row', () => {
    wrap(
      <CourseDetailView
        course={withSummaries('**Why** funnels work:\n\n- stages\n- numbers\n\nSee [the kit](https://example.com/kit). <b>raw</b>')}
      />,
    );
    const row = screen.getByText('Intro').closest('li')!;
    const body = row.querySelector('details .rich-text')!;
    expect(body).not.toBeNull();
    expect(body.querySelector('strong')?.textContent).toBe('Why');
    expect(body.querySelectorAll('ul > li')).toHaveLength(2);
    const link = body.querySelector('a')!;
    expect(link).toHaveAttribute('href', 'https://example.com/kit');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    expect(link.getAttribute('rel')).toContain('nofollow');
    // Raw HTML never becomes markup: it would be text at most (the API strips it on save).
    expect(body.querySelector('b')).toBeNull();
    expect(body.textContent).not.toContain('**');
  });

  it('shows a lesson without a summary as a plain row (no expander)', () => {
    wrap(<CourseDetailView course={withSummaries(null)} />);
    expect(screen.getByText('Notes').closest('li')!.querySelector('details')).toBeNull();
    expect(screen.getByText('Intro').closest('li')!.querySelector('details')).toBeNull();
  });
});
