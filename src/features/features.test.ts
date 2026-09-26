import { filterCourses } from './catalog/components/CatalogBrowser';
import type { CourseSummary } from './catalog/types';
import { createCardToken, formatCardNumber, formatExpiry } from './commerce/payments';
import { eventIcs } from './learning/calendar';

const course = (slug: string, cat: string, students: number, rating: number, price: number): CourseSummary =>
  ({
    id: slug,
    slug,
    title: slug.replace(/-/g, ' '),
    category: { slug: cat, name: cat[0]!.toUpperCase() + cat.slice(1) },
    studentCount: students,
    rating,
    price: { amount: price, currency: 'USD' },
  }) as CourseSummary;

describe('catalogue filtering', () => {
  const courses = [
    course('funnel-blueprint', 'marketing', 486, 4.9, 24900),
    course('pricing', 'sales', 54, 4.7, 9900),
    course('email', 'marketing', 342, 4.8, 19900),
  ];
  it('filters by category and search, then sorts', () => {
    expect(filterCourses(courses, { q: '', category: 'marketing', sort: 'popular' }).map((c) => c.slug)).toEqual([
      'funnel-blueprint',
      'email',
    ]);
    expect(filterCourses(courses, { q: 'SALES', category: '', sort: 'popular' }).map((c) => c.slug)).toEqual(['pricing']);
    expect(filterCourses(courses, { q: '', category: '', sort: 'price_asc' }).map((c) => c.slug)).toEqual([
      'pricing',
      'email',
      'funnel-blueprint',
    ]);
  });
});

describe('payment boundary (mock tokenisation)', () => {
  it('validates card details and returns Stripe test tokens', () => {
    expect(createCardToken({ number: '4242 4242 4242 4242', expiry: '04/28', cvc: '123' })).toEqual({ token: 'tok_visa' });
    expect(createCardToken({ number: '4000 0000 0000 0002', expiry: '04/28', cvc: '123' })).toEqual({ token: 'tok_chargeDeclined' });
    expect(createCardToken({ number: '4242', expiry: '04/28', cvc: '123' })).toEqual({ error: 'number' });
    expect(createCardToken({ number: '4242424242424242', expiry: '13/28', cvc: '123' })).toEqual({ error: 'expiry' });
    expect(createCardToken({ number: '4242424242424242', expiry: '04/28', cvc: '1' })).toEqual({ error: 'cvc' });
  });
  it('formats input as the learner types', () => {
    expect(formatCardNumber('4242424242424242999')).toBe('4242 4242 4242 4242');
    expect(formatExpiry('0428')).toBe('04/28');
  });
});

describe('calendar invite', () => {
  it('produces a valid VEVENT with join link and reminder', () => {
    const ics = eventIcs(
      {
        id: 'evt_1',
        title: 'Live Q&A, with Maya',
        startsAt: '2026-10-01T21:00:00.000Z',
        provider: 'zoom',
        attendees: 1,
        going: true,
        joinUrl: 'https://zoom.us/j/1',
      },
      'Amplify',
    );
    expect(ics).toContain('DTSTART:20261001T210000Z');
    expect(ics).toContain('DTEND:20261001T220000Z');
    expect(ics).toContain('SUMMARY:Live Q&A\\, with Maya');
    expect(ics).toContain('URL:https://zoom.us/j/1');
    expect(ics).toContain('TRIGGER:-PT15M');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});
