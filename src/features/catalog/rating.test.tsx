// @vitest-environment jsdom
// Courses without reviews show no "★ 0.0" (home grid, hero card, catalogue) — the site builder canvas matches.
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { Sections } from '../pages/components/Sections';
import type { Section } from '../pages/types';
import { CourseCard } from './components/CourseCard';
import type { CourseSummary } from './types';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useAppPathname: () => '/',
}));
vi.mock('@/features/learning/api', () => ({ useEnrollmentFor: () => null }));

const course = (over: Partial<CourseSummary> = {}): CourseSummary => ({
  id: 'c1',
  slug: 'funnels',
  title: 'Funnels 101',
  excerpt: '',
  category: { slug: 'marketing', name: 'Marketing' },
  cover: { url: null, color: '#123', alt: '' },
  level: 'beginner',
  instructor: { name: 'Maya', initials: 'M', avatarUrl: null, color: '#000', slug: null },
  rating: 0,
  reviewCount: 0,
  studentCount: 0,
  lessonCount: 1,
  durationMinutes: 10,
  price: { amount: 4900, currency: 'USD' },
  pricing: { model: 'one_time', interval: null, minimumPrice: null },
  paymentPlan: null,
  featured: false,
  updatedAt: '2026-10-06T00:00:00Z',
  ...over,
});

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );

describe('course ratings', () => {
  it('hides the rating on a card until the course has reviews', () => {
    const { container, rerender } = wrap(<CourseCard course={course()} variant="featured" />);
    expect(container.textContent).not.toContain('0.0');
    expect(container.querySelector('.stars')).toBeNull();
    expect(screen.getByText(/0 students/)).toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <CourseCard course={course({ rating: 4.6, reviewCount: 3 })} variant="featured" />
      </NextIntlClientProvider>,
    );
    expect(container.textContent).toContain('4.6');
  });

  it('hides the hero card’s stars and rating for an unreviewed course', () => {
    const hero = {
      id: 'h',
      kind: 'hero',
      anchor: null,
      style: { bg: 'white', pad: 'm', align: 'left', width: 'contained', divider: false, variant: 'course' },
      visibility: { desktop: true, mobile: true },
      animation: null,
      eyebrow: '',
      title: 'Hi',
      subtitle: '',
      primaryCta: { label: 'Go', href: '/courses' },
      secondaryCta: null,
      stats: [],
      spotlight: course(),
      compact: false,
      side: 'card',
      video: null,
    } satisfies Section;
    const { container } = wrap(<Sections sections={[hero]} title="Home" />);
    expect(container.querySelector('article .stars')).toBeNull();
    expect(container.textContent).not.toContain('0.0');
  });
});

describe('free courses', () => {
  it('read "Free" on course cards instead of $0', () => {
    const { container } = wrap(<CourseCard course={course({ price: { amount: 0, currency: 'USD' } })} variant="featured" />);
    expect(container.textContent).toContain('Free');
    expect(container.textContent).not.toContain('$0');
  });

  it('render a course card without a category', () => {
    const { container } = wrap(<CourseCard course={course({ category: null })} variant="featured" />);
    expect(container.querySelector('.eyebrow-brand')).toBeNull();
    expect(container.textContent).toContain('Funnels 101');
  });

  it('read "Free" on the hero’s course card', () => {
    const hero = {
      id: 'h',
      kind: 'hero',
      anchor: null,
      style: { bg: 'white', pad: 'm', align: 'left', width: 'contained', divider: false, variant: 'course' },
      visibility: { desktop: true, mobile: true },
      animation: null,
      eyebrow: '',
      title: 'Hi',
      subtitle: '',
      primaryCta: { label: 'Go', href: '/courses' },
      secondaryCta: null,
      stats: [],
      spotlight: course({ price: { amount: 0, currency: 'USD' } }),
      compact: false,
      side: 'card',
      video: null,
    } satisfies Section;
    const { container } = wrap(<Sections sections={[hero]} title="Home" />);
    expect(container.querySelector('article')?.textContent).toContain('Free');
  });
});
