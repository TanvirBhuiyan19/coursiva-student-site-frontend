// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { checkField } from './components/BuilderForm';
import { Sections } from './components/Sections';
import { autoplayUrl } from './components/VideoEmbed';
import type { FormSection, Section, SectionFrame } from './types';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useAppPathname: () => '/about',
}));

const frame = (id: string, extra: Partial<SectionFrame> = {}): SectionFrame => ({
  id,
  anchor: null,
  style: { bg: 'white', pad: 'm', align: 'left', width: 'contained', divider: false, variant: 'course' },
  visibility: { desktop: true, mobile: true },
  animation: null,
  ...extra,
});

const form: FormSection = {
  ...frame('form', { anchor: 'contact' }),
  kind: 'form',
  title: 'Talk to us',
  subtitle: '',
  fields: [
    { id: 'f1', label: 'Your name', type: 'text', required: true, options: [] },
    { id: 'f2', label: 'Email', type: 'email', required: true, options: [] },
    { id: 'f3', label: 'Topic', type: 'choice', required: false, options: ['Courses', 'Other'] },
    { id: 'f4', label: 'I agree', type: 'checkbox', required: true, options: [] },
  ],
  submitLabel: '',
  note: 'We never share your details.',
  captcha: true,
  save: true,
  action: '/api/v1/pages/about/forms/form',
};

const person = { name: 'Maya Reyes', initials: 'MR', avatarUrl: null, color: 'oklch(0.5 0.1 275)' };

const sections: Section[] = [
  {
    ...frame('t1', { anchor: 'story', animation: 'fade_up' }),
    kind: 'text',
    title: 'Our story',
    body: 'Line one\nLine two\n\nSecond paragraph',
  },
  { ...frame('s1', { visibility: { desktop: false, mobile: true } }), kind: 'stats', items: [{ value: '40', label: 'countries' }] },
  { ...frame('q1'), kind: 'faq', title: 'Questions', items: [{ question: 'Lifetime?', answer: 'Yes.' }] },
  {
    ...frame('l1'),
    kind: 'logos',
    title: 'As featured in',
    items: [
      { name: 'Daily', imageUrl: null },
      { name: 'Weekly', imageUrl: 'https://cdn.example/w.png' },
    ],
  },
  {
    ...frame('v1'),
    kind: 'video',
    caption: 'Inside a live Q&A',
    video: { url: 'https://vimeo.com/1', provider: 'vimeo', embedUrl: 'https://player.vimeo.com/video/1' },
  },
  {
    ...frame('c1', { style: { ...frame('x').style, bg: 'brand' } }),
    kind: 'cta',
    title: 'Ready?',
    body: '',
    button: { label: 'Go', href: 'https://example.com/x' },
  },
  { ...frame('b1'), kind: 'banner', title: 'Bundle and save', button: { label: 'Get it', href: '#contact' } },
  {
    ...frame('cmp'),
    kind: 'compare',
    title: 'Pick',
    columns: ['A', 'B', 'C'],
    highlight: 1,
    rows: [{ feature: 'Community', values: ['—', '✓', 'Monthly'] }],
  },
  { ...frame('qt'), kind: 'quote', text: 'Teach what you practise.', name: 'Maya Reyes', meta: 'Founder', author: person },
  {
    ...frame('vp'),
    kind: 'value_props',
    title: '',
    items: [
      { icon: 'check', glyph: '', title: 'One', body: '' },
      { icon: 'check', glyph: '★', title: 'Two', body: 'b' },
    ],
  },
  { ...frame('ts'), kind: 'testimonials', title: 'Words', items: [{ quote: 'Great', rating: null, author: person, context: '' }] },
  form,
  // A kind this client doesn't know yet is skipped.
  { ...frame('future'), kind: 'hologram' } as unknown as Section,
];

function renderSections(list: Section[] = sections) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en-US" messages={messages}>
        <Sections sections={list} title="About" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('site-builder sections', () => {
  it('render every kind in its frame: anchor, style, visibility and animation', () => {
    const { container } = renderSections();
    // No hero on the page: a visually hidden page title keeps one <h1>.
    expect(screen.getByRole('heading', { level: 1, name: 'About' })).toHaveClass('sr-only');
    const story = container.querySelector('#story')!;
    expect(story.tagName).toBe('SECTION');
    expect(story).toHaveAttribute('data-anim', 'fade_up');
    expect(story.querySelectorAll('p')).toHaveLength(2);
    expect(story.querySelector('br')).not.toBeNull();
    expect(container.querySelector('[data-kind="stats"]')).toHaveAttribute('data-hide-desktop');
    expect(container.querySelector('[data-kind="cta"]')).toHaveAttribute('data-boxed');
    expect(screen.getByRole('link', { name: 'Go' })).toHaveAttribute('rel', 'noopener');
    expect(screen.getByRole('link', { name: 'Get it' })).toHaveAttribute('href', '#contact');
    expect(screen.getByRole('img', { name: 'Weekly' })).toHaveAttribute('src', 'https://cdn.example/w.png');
    expect(screen.getByText('Daily')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Community' })).toBeInTheDocument();
    expect(within(table).getByText('Included')).toHaveClass('sr-only');
    // Value props without a glyph fall back by position; school glyphs are kept.
    const glyphs = [...container.querySelectorAll('[data-kind="value_props"] li span[aria-hidden]')].map((e) => e.textContent);
    expect(glyphs).toEqual(['✓', '★']);
    // A typed testimonial has no rating: no stars.
    expect(screen.queryByRole('img', { name: /Rated/ })).toBeNull();
    expect(container.querySelector('[data-kind="hologram"]')).toBeNull();
  });

  it('load third-party video only when the visitor presses play, from the API-built embed address', () => {
    const { container } = renderSections();
    expect(container.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play Inside a live Q&A' }));
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('src')).toBe('https://player.vimeo.com/video/1?autoplay=1');
    expect(iframe).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    expect(iframe).toHaveAttribute('loading', 'lazy');
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
    expect(iframe).toHaveAttribute('title', 'Inside a live Q&A');
  });

  it('give each form field a label, a hidden honeypot and per-field errors', () => {
    const { container } = renderSections([form]);
    expect(screen.getByLabelText(/Your name/)).toBeRequired();
    expect(screen.getByLabelText(/Topic/).tagName).toBe('SELECT');
    const honeypot = container.querySelector('input[name="website"]')!;
    expect(honeypot).toHaveAttribute('tabindex', '-1');
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getAllByText('This field is required.')).toHaveLength(2);
    expect(screen.getByText('Tick this box to continue.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Your name/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Protected from spam.')).toBeInTheDocument();
  });
});

describe('rich text sections', () => {
  it('render the builder’s Markdown formatted: text body, instructor bio and FAQ answers', () => {
    const { container } = renderSections([
      {
        ...frame('t2'),
        kind: 'text',
        title: 'Our story',
        body: '## How it began\n\nWe **teach** what we [practise](https://example.com).\n\n- One\n- Two',
      },
      {
        ...frame('i1'),
        kind: 'instructor',
        eyebrow: '',
        title: 'Meet Maya',
        instructor: { ...person, role: 'Founder', bio: 'Ten *years* of funnels.\nStill learning.' },
        stats: [],
        video: null,
      },
      { ...frame('q2'), kind: 'faq', title: 'Questions', items: [{ question: 'Refunds?', answer: 'Yes:\n\n1. Ask `support`\n2. Wait' }] },
    ]);
    const text = container.querySelector('[data-kind="text"]')!;
    // Under the section's h2, the body's top heading is an h3.
    expect(within(text as HTMLElement).getByRole('heading', { level: 3, name: 'How it began' })).toBeInTheDocument();
    expect(within(text as HTMLElement).getByText('teach').tagName).toBe('STRONG');
    expect(within(text as HTMLElement).getByRole('link', { name: 'practise' })).toHaveAttribute('href', 'https://example.com');
    expect(text.querySelectorAll('li')).toHaveLength(2);
    const bio = container.querySelector('[data-kind="instructor"]')!;
    expect(within(bio as HTMLElement).getByText('years').tagName).toBe('EM');
    expect(bio.querySelector('br')).not.toBeNull();
    const faq = container.querySelector('[data-kind="faq"]')!;
    expect(faq.querySelectorAll('ol li')).toHaveLength(2);
    expect(within(faq as HTMLElement).getByText('support').tagName).toBe('CODE');
    expect(container.textContent).not.toContain('**');
  });
});

describe('section helpers', () => {
  it('check form fields like the API does', () => {
    const f = (type: FormSection['fields'][number]['type'], required = false, options: string[] = []) => ({
      id: 'f1',
      label: 'x',
      type,
      required,
      options,
    });
    expect(checkField(f('text', true), ' ')).toBe('required');
    expect(checkField(f('text'), '')).toBeNull();
    expect(checkField(f('email'), 'a@b')).toBe('email');
    expect(checkField(f('phone'), '+44 (20) 7946-0000')).toBeNull();
    expect(checkField(f('phone'), 'call me')).toBe('phone');
    expect(checkField(f('choice', false, ['A']), 'B')).toBe('choice');
    expect(checkField(f('choice'), 'anything')).toBeNull();
    expect(checkField(f('checkbox', true), false)).toBe('checkbox');
    expect(checkField(f('long_text'), 'x'.repeat(5001))).toBe('tooLong');
    expect(checkField(f('text'), 'x'.repeat(501))).toBe('tooLong');
  });
  it('add autoplay to provider embeds without dropping their parameters', () => {
    expect(autoplayUrl('https://player.vimeo.com/video/1?h=abc')).toBe('https://player.vimeo.com/video/1?h=abc&autoplay=1');
  });
});
