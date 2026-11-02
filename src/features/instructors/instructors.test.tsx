// @vitest-environment jsdom
// Instructor profiles (docs/api/instructors.md): the profile page, the index grid, course cards/pages linking to the
// profile, and the profile's structured data.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { CourseCard } from '@/features/catalog/components/CourseCard';
import { CourseDetailView } from '@/features/catalog/components/CourseDetailView';
import { CourseRow } from '@/features/catalog/components/CourseRow';
import type { CourseDetail, CourseSummary } from '@/features/catalog/types';
import { instructorProfileJsonLd } from '@/lib/seo';
import { InstructorGrid } from './components/InstructorGrid';
import { InstructorProfileView, safeExternalUrl } from './components/InstructorProfileView';
import type { InstructorDetail, InstructorSummary } from './types';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useAppPathname: () => '/',
}));
vi.mock('@/features/learning/api', () => ({ useEnrollmentFor: () => null }));
// The course page's client islands (purchase card, preview, review form) are covered elsewhere.
vi.mock('@/features/catalog/components/CourseDetailClient', () => ({
  ExpandAll: () => null,
  MobileBuyBar: () => null,
  PurchaseCard: () => null,
  SectionNav: () => null,
  WriteReview: () => null,
  PreviewButton: () => null,
}));

const course = (over: Partial<CourseSummary> = {}): CourseSummary => ({
  id: 'c1',
  slug: 'funnels',
  title: 'Funnels 101',
  excerpt: 'Build a funnel.',
  category: { slug: 'marketing', name: 'Marketing' },
  cover: { url: null, color: '#123', alt: '' },
  level: 'beginner',
  instructor: { name: 'Maya Reyes', initials: 'MR', avatarUrl: null, color: '#333', slug: null },
  rating: 4.2,
  reviewCount: 10,
  studentCount: 50,
  lessonCount: 3,
  durationMinutes: 40,
  price: { amount: 4900, currency: 'USD' },
  pricing: { model: 'one_time', interval: null, minimumPrice: null },
  paymentPlan: null,
  featured: false,
  updatedAt: '2026-10-06T00:00:00Z',
  ...over,
});

const summary = (over: Partial<InstructorSummary> = {}): InstructorSummary => ({
  slug: 'maya-reyes',
  name: 'Maya Reyes',
  initials: 'MR',
  color: 'oklch(0.5 0.1 275)',
  avatarUrl: null,
  headline: 'Funnel strategist',
  expertise: ['Funnels', 'Email'],
  stats: { learnerCount: 1284, courseCount: 2, rating: 4.8, reviewCount: 120 },
  ...over,
});

const detail = (over: Partial<InstructorDetail> = {}): InstructorDetail => ({
  ...summary(),
  coverUrl: null,
  bioHtml: '<p>Ten years of <strong>funnels</strong>.</p>',
  bioExcerpt: 'Ten years of funnels.',
  credentials: [
    { title: 'Certified Strategist', issuer: 'Funnel Academy', year: 2019 },
    { title: 'BA Marketing', issuer: '', year: null },
  ],
  socialLinks: [
    { platform: 'linkedin', url: 'https://www.linkedin.com/in/maya' },
    { platform: 'github', url: 'https://github.com/maya' },
  ],
  website: 'https://maya.example.com',
  courses: [course({ id: 'c1', slug: 'funnels' }), course({ id: 'c2', slug: 'email', title: 'Email 101' })],
  seo: { title: 'Maya Reyes', description: 'Ten years of funnels.', imageUrl: null },
  updatedAt: '2026-09-14T09:00:00Z',
  ...over,
});

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('instructor profile page', () => {
  it('shows the head, figures, expertise, credentials, bio and their courses', () => {
    const { container } = wrap(<InstructorProfileView instructor={detail()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Maya Reyes' })).toBeInTheDocument();
    expect(screen.getByText('Funnel strategist')).toBeInTheDocument();
    // Initials on the placeholder colour when there is no photo.
    expect(container.querySelector('.avatar')?.textContent).toBe('MR');
    expect(screen.getByText('1,284')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '4.8 out of 5 from 120 reviews' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Expertise' })).toHaveTextContent('FunnelsEmail');
    expect(screen.getByText('Funnel Academy · 2019')).toBeInTheDocument();
    expect(screen.getByText('BA Marketing')).toBeInTheDocument();
    // The API's sanitised bio HTML, inside the prose container.
    expect(screen.getByText('funnels', { selector: 'strong' })).toBeInTheDocument();
    const courses = screen.getByRole('region', { name: 'Courses by Maya Reyes' });
    expect(within(courses).getAllByRole('article')).toHaveLength(2);
    expect(within(courses).getByRole('link', { name: 'Email 101' })).toHaveAttribute('href', '/courses/email');
  });

  it('labels every social link and the website, opening them safely in a new tab', () => {
    wrap(<InstructorProfileView instructor={detail()} />);
    const linkedin = screen.getByRole('link', { name: 'Maya Reyes on LinkedIn' });
    expect(linkedin).toHaveAttribute('href', 'https://www.linkedin.com/in/maya');
    expect(linkedin).toHaveAttribute('target', '_blank');
    expect(linkedin.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('link', { name: 'Maya Reyes on GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Maya Reyes’s website (opens in a new tab)' })).toHaveAttribute(
      'href',
      'https://maya.example.com',
    );
  });

  it('drops anything that is not an https link, and copes with an empty profile', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('http://insecure.example')).toBeNull();
    expect(safeExternalUrl('https://ok.example/x')).toBe('https://ok.example/x');
    wrap(
      <InstructorProfileView
        instructor={detail({
          headline: '',
          bioHtml: '',
          expertise: [],
          credentials: [],
          socialLinks: [{ platform: 'x', url: 'javascript:alert(1)' }],
          website: null,
          courses: [],
          stats: { learnerCount: 0, courseCount: 0, rating: null, reviewCount: 0 },
        })}
      />,
    );
    expect(screen.queryByRole('link', { name: /on X/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'About Maya Reyes' })).toBeNull();
    expect(screen.getByText('No reviews yet')).toBeInTheDocument();
    expect(screen.getByText('Maya Reyes has no published courses yet.')).toBeInTheDocument();
  });

  it('renders the photo and cover when uploaded', () => {
    const { container } = wrap(
      <InstructorProfileView instructor={detail({ avatarUrl: 'https://cdn.test/a.jpg?v=1', coverUrl: 'https://cdn.test/c.jpg?v=1' })} />,
    );
    const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(srcs).toContain('https://cdn.test/a.jpg?v=1');
    expect(srcs).toContain('https://cdn.test/c.jpg?v=1');
  });
});

describe('instructor index', () => {
  const page = (data: InstructorSummary[], currentPage = 1, lastPage = 1) => ({
    data,
    meta: { currentPage, lastPage, perPage: 1, total: lastPage },
  });

  it('shows an empty state without profiles', () => {
    wrap(<InstructorGrid first={page([])} />);
    expect(screen.getByText('No instructor profiles yet — check back soon.')).toBeInTheDocument();
  });

  it('links each card to its profile and loads further pages on demand', async () => {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ ...summary({ slug: 'priya-shah', name: 'Priya Shah', initials: 'PS' }), avatar_url: null }],
            meta: { current_page: 2, last_page: 2, per_page: 1, total: 2 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    wrap(<InstructorGrid first={page([summary()], 1, 2)} />);
    expect(screen.getByRole('link', { name: 'Maya Reyes' })).toHaveAttribute('href', '/instructors/maya-reyes');
    expect(screen.getByText(/2 courses/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show more instructors' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Priya Shah' })).toHaveAttribute('href', '/instructors/priya-shah'));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/instructors?page=2&per_page=1');
    expect(screen.queryByRole('button', { name: 'Show more instructors' })).toBeNull();
  });
});

describe('course cards and pages link to the profile', () => {
  it('links the card and row instructor (photo + name) only when the profile is visible', () => {
    const linked = course({
      instructor: { name: 'Maya Reyes', initials: 'MR', avatarUrl: 'https://cdn.test/a.jpg', color: '#333', slug: 'maya-reyes' },
    });
    const { unmount } = wrap(<CourseCard course={linked} />);
    const link = screen.getByRole('link', { name: 'Maya Reyes' });
    expect(link).toHaveAttribute('href', '/instructors/maya-reyes');
    expect(link.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/a.jpg');
    unmount();
    wrap(<CourseRow course={linked} />);
    expect(screen.getByRole('link', { name: 'Maya Reyes' })).toHaveAttribute('href', '/instructors/maya-reyes');
  });

  it('keeps an instructor without a visible profile as plain text', () => {
    wrap(<CourseCard course={course()} />);
    expect(screen.queryByRole('link', { name: 'Maya Reyes' })).toBeNull();
    expect(screen.getByText('Maya Reyes')).toBeInTheDocument();
  });

  const courseDetail = (over: Partial<CourseDetail> = {}): CourseDetail => ({
    ...course({ instructor: { name: 'Maya Reyes', initials: 'MR', avatarUrl: null, color: '#333', slug: 'maya-reyes' } }),
    description: 'Build a funnel.',
    outcomes: [],
    requirements: [],
    audience: [],
    faqs: [],
    modules: [],
    instructorProfile: {
      role: 'Instructor',
      bio: 'Ten years of funnels.',
      studentCount: 1284,
      slug: 'maya-reyes',
      headline: 'Funnel strategist',
      courseCount: 2,
      rating: 4.8,
      reviewCount: 120,
    },
    guaranteeDays: 30,
    certificate: true,
    community: false,
    preview: null,
    reviews: [],
    ratingDistribution: [],
    includedInPlan: null,
    related: [],
    language: 'en',
    publishedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-10-06T00:00:00Z',
    ...over,
  });

  it('links the hero byline and the instructor block, with the profile’s own headline and figures', () => {
    wrap(<CourseDetailView course={courseDetail()} />);
    const links = screen.getAllByRole('link', { name: 'Maya Reyes' });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const l of links) expect(l).toHaveAttribute('href', '/instructors/maya-reyes');
    const block = screen.getByRole('region', { name: 'Your instructor' });
    expect(within(block).getByText('Funnel strategist')).toBeInTheDocument();
    expect(within(block).getByText('2 courses')).toBeInTheDocument();
    // The instructor's own rating, not the course's 4.2.
    expect(within(block).getByText('4.8 instructor rating (120 reviews)')).toBeInTheDocument();
    expect(within(block).getByRole('link', { name: 'View Maya Reyes’s profile' })).toHaveAttribute('href', '/instructors/maya-reyes');
  });

  it('shows the name only without a published profile', () => {
    wrap(
      <CourseDetailView
        course={courseDetail({
          instructor: { name: 'Leo Park', initials: 'LP', avatarUrl: null, color: '#333', slug: null },
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
        })}
      />,
    );
    const block = screen.getByRole('region', { name: 'Your instructor' });
    expect(within(block).getByRole('heading', { name: 'Leo Park' })).toBeInTheDocument();
    expect(within(block).queryByRole('link')).toBeNull();
    expect(within(block).queryByRole('list')).toBeNull();
    expect(screen.getByRole('link', { name: 'Leo Park' })).toHaveAttribute('href', '#instructor');
  });
});

describe('instructor structured data', () => {
  it('describes a ProfilePage whose Person links every external profile', () => {
    const ld = instructorProfileJsonLd('https://school.example', detail({ avatarUrl: 'https://cdn.test/a.jpg' }));
    expect(ld).toMatchObject({
      '@type': 'ProfilePage',
      url: 'https://school.example/instructors/maya-reyes',
      dateModified: '2026-09-14T09:00:00Z',
      mainEntity: {
        '@type': 'Person',
        name: 'Maya Reyes',
        description: 'Funnel strategist',
        jobTitle: 'Funnel strategist',
        image: 'https://cdn.test/a.jpg',
        sameAs: ['https://www.linkedin.com/in/maya', 'https://github.com/maya', 'https://maya.example.com'],
      },
    });
  });
});
