// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';
import { LEAD_EVENT, LeadForm } from './components/LeadForm';
import { postToParent } from './components/EmbedFrame';
import { buildSubmissionBody, checkFile, checkValue, embedContext, normalizeForm, prefillAll, visibleKeys, wireValues } from './logic';
import type { LeadField } from './types';

const f = (key: string, type: LeadField['type'], extra: Partial<LeadField> = {}): LeadField => ({
  key,
  label: key,
  required: false,
  type,
  options: [],
  placeholder: '',
  help: '',
  rules: { min: null, max: null, pattern: null },
  showIf: null,
  prefill: null,
  consent: null,
  file: null,
  ...extra,
});

/** The API's wire shape (snake_case). */
const wireForm = {
  id: 'frm_test',
  name: 'Workshop application',
  title: 'Apply now',
  description: 'Twelve seats.',
  submit_label: 'Send application',
  success_message: 'Thanks! We got your submission.',
  redirect_url: null,
  turnstile_site_key: null,
  double_opt_in: false,
  min_fill_seconds: 3,
  token: 'tok.abc',
  fields: [
    { ...f('name', 'text', { label: 'Your name', required: true, help: 'As on your ID.' }), show_if: null },
    { ...f('email', 'email', { label: 'Email', required: true }), show_if: null },
    { ...f('role', 'choice', { label: 'Role', required: true, options: ['Coach', 'Other'] }), show_if: null },
    { ...f('role_other', 'text', { label: 'Your role', required: true }), show_if: { field: 'role', equals: 'Other' } },
    { ...f('excitement', 'rating', { label: 'Excitement' }), show_if: null },
    {
      ...f('consent', 'consent', { label: 'Privacy', required: true, consent: { text: 'I agree to be contacted.', version: '1' } }),
      show_if: null,
    },
    { ...f('utm_source', 'hidden', { prefill: { source: 'utm_source', param: '' } }), show_if: null },
    { ...f('cid', 'hidden', { prefill: { source: 'query', param: 'cid' } }), show_if: null },
    { ...f('channel', 'hidden', { prefill: { source: 'static', param: '' } }), show_if: null },
  ],
};

type Call = { url: string; method: string; body: any; credentials: RequestCredentials | undefined };

function mockApi(submit: () => { status: number; body: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: init.method ?? 'GET', body, credentials: init.credentials });
      const json = (status: number, b: unknown) =>
        Promise.resolve(new Response(b === null ? null : JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } }));
      if (url === '/api/v1/forms/frm_test' && init.method === 'GET') return json(200, { data: wireForm });
      if (url === '/api/v1/forms/frm_missing') return json(404, { message: 'Form not found.' });
      if (url.endsWith('/views')) return json(204, null);
      if (url.endsWith('/submissions')) {
        const r = submit();
        return json(r.status, r.body);
      }
      return json(500, { message: 'unexpected' });
    }),
  );
  return calls;
}

function renderForm(id = 'frm_test', props: Partial<Parameters<typeof LeadForm>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <LeadForm formId={id} variant="page" {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const ok201 = () => ({
  status: 201,
  body: {
    data: {
      received: true,
      confirmation_required: false,
      submission_id: 'fsb_1',
      success_message: 'Thanks! See you soon.',
      redirect_url: null,
    },
  },
});

async function fillValid() {
  fireEvent.change(await screen.findByLabelText(/Your name/), { target: { value: 'Jordan Tate' } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'jordan@example.com' } });
  fireEvent.change(screen.getByLabelText(/^Role/), { target: { value: 'Coach' } });
  fireEvent.click(screen.getByLabelText(/I agree to be contacted/));
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('lead form rules', () => {
  const fields = normalizeForm({
    ...wireForm,
    fields: wireForm.fields.map((x) => ({ ...x, showIf: x.show_if })),
  }).fields;

  it('shows a conditional field only while its condition holds, and skips it everywhere else', () => {
    expect(visibleKeys(fields, { role: 'Coach' }).has('role_other')).toBe(false);
    expect(visibleKeys(fields, { role: 'Other' }).has('role_other')).toBe(true);
    const wire = wireValues(fields, { role: 'Coach', role_other: 'stale', consent: true, excitement: '4' });
    expect(wire.role_other).toBeNull();
    expect(wire.consent).toBe(true);
    expect(wire.excitement).toBe(4);
    const checkbox = f('agree', 'checkbox');
    const dependent = f('why', 'text', { showIf: { field: 'agree', equals: 'true' } });
    expect(visibleKeys([checkbox, dependent], { agree: true }).has('why')).toBe(true);
    expect(visibleKeys([checkbox, dependent], {}).has('why')).toBe(false);
  });

  it('compares conditions as the API does: numbers as numbers, email lower-cased', () => {
    const qty = f('qty', 'number');
    const seats = f('seats', 'text', { showIf: { field: 'qty', equals: '5' } });
    expect(visibleKeys([qty, seats], { qty: '05' }).has('seats')).toBe(true);
    expect(visibleKeys([qty, seats], { qty: '5.0' }).has('seats')).toBe(true);
    expect(visibleKeys([qty, seats], { qty: 'five' }).has('seats')).toBe(false);
    const email = f('email', 'email');
    const vip = f('vip', 'text', { showIf: { field: 'email', equals: 'ceo@acme.test' } });
    expect(visibleKeys([email, vip], { email: ' CEO@Acme.test ' }).has('vip')).toBe(true);
  });

  it('checks values like the API, with its messages', () => {
    const msg = (field: LeadField, v: string | boolean | undefined) => checkValue(field, v);
    expect(msg(f('n', 'text', { required: true }), '  ')).toEqual({ code: 'required' });
    expect(msg(f('c', 'consent', { required: true }), false)).toEqual({ code: 'consentRequired' });
    expect(msg(f('e', 'email'), 'nope')).toEqual({ code: 'email' });
    expect(msg(f('p', 'phone'), '(12)')).toEqual({ code: 'phone' });
    expect(msg(f('u', 'url'), 'example.com')).toEqual({ code: 'url' });
    expect(msg(f('d', 'date'), '2026-02-30')).toEqual({ code: 'date' });
    expect(msg(f('d', 'date'), '2028-02-29')).toBeNull();
    expect(msg(f('x', 'number', { rules: { min: 2.5, max: 10, pattern: null } }), '2')).toEqual({
      code: 'numberMin',
      params: { min: '2.5' },
    });
    expect(msg(f('x', 'number'), '1e3')).toEqual({ code: 'number' });
    expect(msg(f('t', 'text', { rules: { min: 3, max: null, pattern: null } }), 'ab')).toEqual({ code: 'minChars', params: { min: '3' } });
    expect(msg(f('t', 'long_text'), 'x'.repeat(5001))).toEqual({ code: 'maxChars', params: { n: '5000' } });
    expect(msg(f('t', 'text', { rules: { min: null, max: null, pattern: 'letters' } }), 'Zoë O’Neil-Smith')).toBeNull();
    expect(msg(f('t', 'text', { rules: { min: null, max: null, pattern: 'no_links' } }), 'see WWW.x.com')).toEqual({ code: 'noLinks' });
    expect(msg(f('r', 'rating'), '6')).toEqual({ code: 'rating' });
    const file = f('cv', 'file', { file: { accept: ['pdf'], maxMb: 1 } });
    expect(checkFile(file, { name: 'cv.PDF', size: 10 })).toBeNull();
    expect(checkFile(file, { name: 'cv.exe', size: 10 })).toEqual({ code: 'fileType' });
    expect(checkFile(file, { name: 'cv.pdf', size: 1024 * 1024 + 1 })).toEqual({ code: 'fileSize', params: { max_mb: '1' } });
    // Every code has a message.
    for (const code of [
      'required',
      'consentRequired',
      'maxChars',
      'minChars',
      'email',
      'phone',
      'url',
      'letters',
      'digits',
      'alphanumeric',
      'noLinks',
      'number',
      'numberMin',
      'numberMax',
      'date',
      'choice',
      'rating',
      'fileType',
      'fileSize',
      'turnstile',
    ])
      expect((messages.forms.errors as Record<string, string>)[code], code).toBeTruthy();
  });

  it('prefills hidden fields from the page (or the embedding page) and never sends static values', () => {
    const ctx = embedContext(
      `?origin=${encodeURIComponent('https://partner.example')}&page=${encodeURIComponent('https://partner.example/p?cid=42&utm_source=old')}&referrer=${encodeURIComponent('https://google.com/')}&utm_source=news`,
    );
    expect(ctx.origin).toBe('https://partner.example');
    const hidden = prefillAll(
      [
        ...fields,
        f('page', 'hidden', { prefill: { source: 'page_url', param: '' } }),
        f('from', 'hidden', { prefill: { source: 'referrer', param: '' } }),
      ],
      ctx,
    );
    expect(hidden).toEqual({
      utm_source: 'news',
      cid: '42',
      channel: '',
      page: 'https://partner.example/p?cid=42&utm_source=old',
      from: 'https://google.com/',
    });
    for (const bad of ['*', 'null', 'javascript:alert(1)', 'https://a.example/path', 'https://a.example; x'])
      expect(embedContext(`?origin=${encodeURIComponent(bad)}`).origin, bad).toBeNull();
    expect(embedContext('?page=javascript%3Aalert(1)').pageUrl).toBe('');
  });

  it('builds the submission body in one place, with field keys untouched', () => {
    expect(
      buildSubmissionBody({
        token: 't',
        values: { first_name: 'A', utmSource: 'x' },
        website: '',
        turnstileToken: null,
        pageUrl: 'https://a/',
        referrer: '',
      }),
    ).toEqual({ token: 't', values: { first_name: 'A', utmSource: 'x' }, website: '', page_url: 'https://a/', referrer: '' });
    expect(
      buildSubmissionBody({ token: 't', values: {}, website: '', turnstileToken: 'cf', pageUrl: '', referrer: '' }).turnstile_token,
    ).toBe('cf');
  });
});

describe('<LeadForm>', () => {
  it('loads the form anonymously, counts one view and hides the honeypot from people', async () => {
    const calls = mockApi(ok201);
    const { container } = renderForm();
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply now' })).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/views'))).toHaveLength(1));
    expect(calls.find((c) => c.url.endsWith('/views'))!.body).toEqual({ token: 'tok.abc' });
    expect(calls.every((c) => c.credentials === 'omit')).toBe(true);
    const honeypot = container.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(honeypot).toHaveAttribute('tabindex', '-1');
    expect(honeypot).toHaveAttribute('autocomplete', 'off');
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByLabelText(/Your name/)).toHaveAccessibleDescription('As on your ID.');
    // Hidden fields are never inputs people see.
    expect(container.querySelector('input[name="values[utm_source]"]')).toBeNull();
  });

  it('shows the conditional field live and requires it only while shown', async () => {
    mockApi(ok201);
    renderForm();
    const role = await screen.findByLabelText(/^Role/);
    expect(screen.queryByLabelText(/Your role/)).toBeNull();
    fireEvent.change(role, { target: { value: 'Other' } });
    expect(screen.getByLabelText(/Your role/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    expect(await screen.findAllByText('This field is required.')).not.toHaveLength(0);
    expect(screen.getByLabelText(/Your role/)).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(role, { target: { value: 'Coach' } });
    expect(screen.queryByLabelText(/Your role/)).toBeNull();
  });

  it('checks answers before sending and focuses the first problem', async () => {
    const calls = mockApi(ok201);
    renderForm();
    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    const name = screen.getByLabelText(/Your name/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveFocus();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('You must agree to continue.')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/submissions'))).toBe(false);
  });

  it('submits the prefilled hidden values, shows the success message and announces the lead', async () => {
    window.history.replaceState(null, '', '/forms/frm_test?utm_source=newsletter&cid=42');
    const calls = mockApi(ok201);
    const leads: unknown[] = [];
    const onLead = (e: Event) => leads.push((e as CustomEvent).detail);
    window.addEventListener(LEAD_EVENT, onLead);
    renderForm();
    await fillValid();
    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Thanks! See you soon.');
    const body = calls.find((c) => c.url.endsWith('/submissions'))!.body;
    expect(body).toEqual({
      token: 'tok.abc',
      website: '',
      page_url: 'http://localhost:3000/forms/frm_test?utm_source=newsletter&cid=42',
      referrer: '',
      values: {
        name: 'Jordan Tate',
        email: 'jordan@example.com',
        role: 'Coach',
        role_other: null,
        excitement: 4,
        consent: true,
        utm_source: 'newsletter',
        cid: '42',
        channel: null,
      },
    });
    expect(leads).toEqual([{ form_id: 'frm_test', submission_id: 'fsb_1' }]);
    window.removeEventListener(LEAD_EVENT, onLead);
  });

  it('maps the API’s 422 errors to their fields and the form', async () => {
    let answer = {
      status: 422,
      body: {
        message: 'Enter a valid email address.',
        errors: { 'values.email': ['Enter a valid email address.'], token: ['That was quick! Please wait a moment and submit again.'] },
      },
    };
    mockApi(() => answer);
    renderForm();
    await fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That was quick! Please wait a moment and submit again.');
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Email/)).toHaveAccessibleDescription('Enter a valid email address.');
    // The server's field error survives the next frames (focus stays on the field: no blur re-check clears it).
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByLabelText(/^Email/)).toHaveFocus();
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
    answer = { status: 429, body: { message: 'Too Many Attempts.', errors: {} } as never };
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many tries in a row.'));
  });

  it('does not announce a lead for a honeypot answer and follows only http(s) redirects', async () => {
    const leads: unknown[] = [];
    const onLead = () => leads.push(1);
    window.addEventListener(LEAD_EVENT, onLead);
    mockApi(() => ({
      status: 201,
      body: {
        data: {
          received: true,
          confirmation_required: false,
          submission_id: null,
          success_message: 'Thanks!',
          redirect_url: 'javascript:alert(1)',
        },
      },
    }));
    const redirect = vi.fn();
    renderForm('frm_test', { redirect });
    await fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Thanks!');
    expect(leads).toHaveLength(0);
    expect(redirect).not.toHaveBeenCalled();
    window.removeEventListener(LEAD_EVENT, onLead);
  });

  it('does not announce a lead held for double opt-in (the server sends it once the contact confirms)', async () => {
    const leads: unknown[] = [];
    const onLead = () => leads.push(1);
    window.addEventListener(LEAD_EVENT, onLead);
    mockApi(() => ({
      status: 201,
      body: {
        data: {
          received: true,
          confirmation_required: true,
          submission_id: 'fsb_held',
          success_message: 'Thanks! Check your inbox to confirm your subscription.',
          redirect_url: null,
        },
      },
    }));
    renderForm();
    await fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Check your inbox');
    expect(leads).toHaveLength(0);
    window.removeEventListener(LEAD_EVENT, onLead);
  });

  it('says so when the form is gone', async () => {
    mockApi(ok201);
    renderForm('frm_missing');
    expect(await screen.findByRole('alert')).toHaveTextContent('This form isn’t available.');
    expect(within(document.body).queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('embed frame → parent messages', () => {
  it('posts only to a valid origin, and only when framed', () => {
    const post = vi.fn();
    const realParent = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage: post } });
    try {
      act(() => {
        expect(postToParent('frm_x', { type: 'resize', height: 300 }, '?origin=https%3A%2F%2Fpartner.example')).toBe(true);
      });
      expect(post).toHaveBeenCalledWith(
        { source: 'coursiva-form', v: 1, form: 'frm_x', type: 'resize', height: 300 },
        'https://partner.example',
      );
      expect(postToParent('frm_x', { type: 'submitted', submission: 'fsb_1' }, '?origin=*')).toBe(false);
      expect(postToParent('frm_x', { type: 'submitted', submission: 'fsb_1' }, '')).toBe(false);
      expect(post).toHaveBeenCalledTimes(1);
    } finally {
      if (realParent) Object.defineProperty(window, 'parent', realParent);
    }
  });
});

describe('site-builder lead_form sections', () => {
  it('normalise with the common frame and their form id', async () => {
    const { normalizePage } = await import('@/features/pages/normalize');
    const page = normalizePage({
      slug: 'about/team',
      sections: [{ id: 'tm_lead', kind: 'lead_form', formId: 'frm_x', title: 'Join' }],
    });
    expect(page.sections[0]).toMatchObject({ kind: 'lead_form', formId: 'frm_x', title: 'Join', subtitle: '', anchor: null });
  });
});
