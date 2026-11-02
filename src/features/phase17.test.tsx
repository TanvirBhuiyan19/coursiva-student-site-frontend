// @vitest-environment jsdom
// Phase 17 (deploy readiness): the payment boundary, the safe Markdown renderer and the new links' helpers.
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import messages from '../../messages/en.json';
import { initialsOf } from '@/components/layout/UserAvatar';
import { Markdown, safeHref } from '@/lib/markdown';
import { isCodeFreePath, isNoindexPath, isPrivatePath, isReservedRedirectPath, routes } from '@/lib/routes';
import { sourceLabel } from './blog/components/BlogPostClient';
import { PaymentFields } from './commerce/components/PaymentFields';
import { ProductView } from './commerce/components/ProductView';
import type { PaymentHandle, PaymentSetup } from './commerce/payments';

const withIntl = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);
const amount = { mode: 'payment' as const, amount: 4900, currency: 'usd', saveCard: false };

describe('payment fields (no card data ever)', () => {
  it('with the fake gateway, offers Stripe test cards and hands back their tokens', async () => {
    const ref = createRef<PaymentHandle>();
    const setup: PaymentSetup = { provider: 'test', publishableKey: null, stripeAccount: null, methods: ['card'] };
    render(withIntl(<PaymentFields setup={setup} amount={amount} ref={ref} />));
    expect(screen.queryByLabelText(/card number/i)).toBeNull();
    expect(await ref.current!.collect({ name: 'A', email: 'a@example.com' })).toEqual({ token: 'tok_visa' });
    await userEvent.click(screen.getByLabelText(/3-D Secure/));
    await act(async () => {
      expect(await ref.current!.collect({ name: 'A', email: 'a@example.com' })).toEqual({ token: 'tok_threeDSecure' });
    });
    expect(await ref.current!.authenticate('pi_secret')).toEqual({ ok: true });
  });
  it('says the school can’t take payments until Stripe and the school are connected', () => {
    const setup: PaymentSetup = { provider: 'stripe', publishableKey: null, stripeAccount: null, methods: ['card'] };
    render(withIntl(<PaymentFields setup={setup} amount={amount} ref={createRef()} />));
    expect(screen.getByRole('alert').textContent).toMatch(/can’t take card payments yet/);
  });
});

describe('school-written Markdown', () => {
  it('renders structure and drops unsafe links and images', () => {
    const html = renderToStaticMarkup(
      <Markdown
        source={
          '# Title\n\nHello **bold** [ok](https://example.com) [bad](javascript:alert(1)) ![x](data:image/png;base64,AA)\n\n- one\n- two'
        }
      />,
    );
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(safeHref('/courses/x')).toBe('/courses/x');
    expect(safeHref('//evil.example')).toBeNull();
  });
});

describe('links the backend e-mails', () => {
  it('keeps account pages private and auth links out of the index', () => {
    expect(isPrivatePath(routes.claim('abc').split('?')[0]!)).toBe(true);
    expect(isPrivatePath(routes.liveRoom('evt_1'))).toBe(true);
    expect(isPrivatePath(routes.order('ord_1'))).toBe(true);
    expect(isNoindexPath(routes.resetPassword)).toBe(true);
    expect(isNoindexPath(routes.join('team-a'))).toBe(true);
    expect(isPrivatePath(routes.verifyCertificate('AC-2026-0001'))).toBe(false);
    expect(routes.survey('sr_1')).toBe('/account?survey=sr_1');
  });
  it('keeps the school’s custom code and redirects off auth, token, checkout and account pages', () => {
    for (const path of [
      routes.signIn(),
      routes.signUp(),
      routes.forgotPassword,
      routes.resetPassword,
      routes.verifyEmail,
      routes.subscribeConfirm,
      '/claim',
      routes.join('team-a'),
      '/webinars/join',
      '/checkout',
      routes.orderSuccess('ord_1').split('?')[0]!,
      routes.accountBilling,
      routes.order('ord_1'),
    ]) {
      expect(isCodeFreePath(path)).toBe(true);
      expect(isReservedRedirectPath(path)).toBe(true);
    }
    expect(isCodeFreePath('/accounting')).toBe(false);
    expect(isCodeFreePath(routes.courses)).toBe(false);
    for (const path of ['/es/reset-password', '/PT-BR/Sign-In', '/l/abc12345', '/embed/forms/f1', '/preview/tok', '/api/v1/x'])
      expect(isReservedRedirectPath(path)).toBe(true);
    for (const path of ['/accounting', '/learning-paths', '/es/old', '/webinars/my-talk', '/old-page'])
      expect(isReservedRedirectPath(path)).toBe(false);
  });
  it('labels blog reads by source and falls back to initials from the name', () => {
    expect(sourceLabel('https://www.google.com/search?q=x', 'learn.example.com')).toBe('Google');
    expect(sourceLabel('https://learn.example.com/blog', 'learn.example.com')).toBe('Direct');
    expect(sourceLabel('', 'learn.example.com')).toBe('Direct');
    expect(initialsOf('Jordan Tate')).toBe('JT');
    expect(initialsOf('cher')).toBe('C');
  });
});

describe('product sales page (17b)', () => {
  const base = {
    slug: 'launch-kit',
    title: 'Launch kit',
    description: 'Templates',
    thumbnailUrl: null,
    price: { amount: 1900, currency: 'USD' },
    compareAtPrice: null,
    courses: [],
    service: null,
  };
  it('sells a download through ?product= and states how it is delivered', () => {
    render(
      withIntl(
        <ProductView
          product={{
            ...base,
            kind: 'download',
            file: { name: 'launch-kit.zip', sizeMb: 4.5 },
            delivery: { linkExpiryDays: 7, downloadLimit: 5 },
          }}
        />,
      ),
    );
    expect(screen.getByRole('link', { name: /Buy now/ }).getAttribute('href')).toContain('/checkout?product=launch-kit');
    expect(screen.getByText(/7 days after you buy — up to 5 times/)).toBeTruthy();
  });
  it('sends a bundle to the bundle checkout and lists its courses', () => {
    render(
      withIntl(
        <ProductView
          product={{ ...base, slug: 'pair', kind: 'bundle', file: null, delivery: null, courses: [{ slug: 'a', title: 'Course A' }] }}
        />,
      ),
    );
    expect(screen.getByRole('link', { name: /Buy now/ }).getAttribute('href')).toContain('/checkout?bundle=pair');
    expect(screen.getByRole('link', { name: 'Course A' })).toBeTruthy();
  });
});
