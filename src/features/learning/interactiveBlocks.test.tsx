// @vitest-environment jsdom
// Interactive lesson blocks against the mock API (docs/api/learning.md → interactive blocks): the browser's fetch is
// routed to the mock app with a signed-in learner, so checks, sorting and continue gates run end to end — grading in
// the API, the lesson reloaded after a gate.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { app } from '../../../mock-api/app';
import { reset } from '../../../mock-api/lib/db';
import messages from '../../../messages/en.json';
import { useLesson } from './api';
import { LessonBlocks } from './components/LessonBlocks';

vi.mock('@/features/auth/api', () => ({ useSession: () => ({ user: null, isSignedIn: true }) }));

const LESSON_ID = 'les_f_0_0';
const calls: { method: string; url: string; body: string | null }[] = [];

/** Signs Jordan in on the mock and routes same-origin `/api/v1` calls to it with the session cookies. */
async function signIn() {
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair!.split('=');
      if (k && v) jar.set(k, v);
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  keep(await app.request('/sanctum/csrf-cookie', { headers: { 'X-Tenant': 'amplify' } }));
  keep(
    await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'X-Tenant': 'amplify',
        'Content-Type': 'application/json',
        Cookie: cookie(),
        'X-XSRF-TOKEN': decodeURIComponent(jar.get('XSRF-TOKEN')!),
      },
      body: JSON.stringify({ email: 'jordan.tate@gmail.com', password: 'password', remember: false }),
    }),
  );
  // The client echoes this cookie as X-XSRF-TOKEN.
  document.cookie = `XSRF-TOKEN=${jar.get('XSRF-TOKEN')!}; path=/`;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const body = typeof init.body === 'string' ? init.body : null;
      calls.push({ method: init.method ?? 'GET', url, body });
      const headers = new Headers(init.headers);
      headers.set('X-Tenant', 'amplify');
      headers.set('Cookie', cookie());
      const res = await app.request(url, { method: init.method ?? 'GET', headers, body });
      keep(res);
      return res;
    }),
  );
}

function Lesson() {
  const { data } = useLesson(LESSON_ID);
  if (!data?.blocks) return null;
  return <LessonBlocks blocks={data.blocks} lessonTitle={data.title} lessonId={data.id} blocksLocked={data.blocksLocked ?? 0} />;
}

async function renderLesson() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <Lesson />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Continue' });
}

const checkForm = (name: string | RegExp) => screen.getByRole('form', { name });

beforeEach(async () => {
  reset();
  calls.length = 0;
  await signIn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/';
});

describe('interactive blocks with the API', () => {
  it('checks an answer in the API, shows the verdict and feedback, and retries', async () => {
    const user = userEvent.setup();
    await renderLesson();
    const form = checkForm('Which stage turns visitors into leads?');
    await user.click(within(form).getByRole('button', { name: 'Check' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Choose an answer first.');
    expect(calls.some((c) => c.url.endsWith('/check'))).toBe(false);

    await user.click(within(form).getByRole('radio', { name: 'Attract' }));
    await user.click(within(form).getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('Not quite.'));
    expect(within(form).getByRole('status')).toHaveTextContent('converting is where a visitor becomes a lead.');
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      url: `/api/v1/me/lessons/${LESSON_ID}/blocks/blk_demo000000000018/check`,
      body: JSON.stringify({ option_ids: ['a'] }),
    });
    // The correct option (from correct_option_ids) is marked; the inputs are locked until Try again.
    expect(within(form).getByText('Correct answer').closest('label')).toHaveTextContent('Convert');
    expect(within(form).getByRole('radio', { name: /Convert/ })).toBeDisabled();

    await user.click(within(form).getByRole('button', { name: 'Try again' }));
    await user.click(within(form).getByRole('radio', { name: 'Convert' }));
    await user.click(within(form).getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('Correct!Right — the landing page converts.'));
  });

  it('sorts with the item menus (keyboard) and by drag and drop, and shows each item’s result', async () => {
    const user = userEvent.setup();
    await renderLesson();
    const sorting = screen.getByRole('region', { name: 'Sort each item into its funnel stage.' });
    await user.click(within(sorting).getByRole('button', { name: 'Check' }));
    expect(within(sorting).getByRole('alert')).toHaveTextContent('Place every item in a category first.');

    // Without a pointer: each item’s menu picks its category.
    const ads = within(sorting).getByRole('combobox', { name: 'Category for Social ads' });
    ads.focus();
    await user.selectOptions(ads, 'Attract');
    await user.selectOptions(within(sorting).getByRole('combobox', { name: 'Category for Opt-in form' }), 'Convert');
    await user.selectOptions(within(sorting).getByRole('combobox', { name: 'Category for Blog posts' }), 'Convert');
    // Drag and drop: the free checklist onto Convert.
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
      effectAllowed: '',
    };
    const item = within(sorting).getByText('Free checklist').closest('li')!;
    expect(item.getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(item, { dataTransfer });
    const convert = within(sorting).getByText('Convert', { selector: 'p' }).parentElement!;
    fireEvent.dragOver(convert, { dataTransfer });
    fireEvent.drop(convert, { dataTransfer });
    expect(within(sorting).getByRole('combobox', { name: 'Category for Free checklist' })).toHaveValue('convert');
    // Everything is placed: the "To sort" pile is gone.
    expect(within(sorting).queryByText('To sort')).toBeNull();

    await user.click(within(sorting).getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(within(sorting).getByRole('status')).toHaveTextContent('3 of 4 in the right place.'));
    const sent = JSON.parse(calls.at(-1)!.body!) as { placements: Record<string, string> };
    expect(sent).toEqual({ placements: { ads: 'attract', form: 'convert', seo: 'convert', magnet: 'convert' } });
    const blog = within(sorting).getByText('Blog posts').closest('li')!;
    expect(blog.getAttribute('data-result')).toBe('incorrect');
    expect(within(blog).getByText('Incorrect')).toBeTruthy();
    expect(within(sorting).getByText('Social ads').closest('li')!.getAttribute('data-result')).toBe('correct');

    await user.click(within(sorting).getByRole('button', { name: 'Try again' }));
    await user.selectOptions(within(sorting).getByRole('combobox', { name: 'Category for Blog posts' }), 'Attract');
    await user.click(within(sorting).getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(within(sorting).getByRole('status')).toHaveTextContent('All sorted correctly!'));
  });

  it('keeps a gate closed until the required check is answered, then shows the next section', async () => {
    const user = userEvent.setup();
    await renderLesson();
    expect(screen.getByText('4 more blocks after you continue')).toBeTruthy();
    expect(screen.queryByText(/Which belong on a landing page/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const alert = await screen.findByText('Answer the questions above first.');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('aria-describedby')).toBe(alert.id);

    const form = checkForm('Which stage turns visitors into leads?');
    await user.click(within(form).getByRole('radio', { name: 'Nurture' }));
    await user.click(within(form).getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('Not quite.'));

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    // The lesson is fetched again and the next section appears, up to the next gate.
    await screen.findByRole('form', { name: 'Which belong on a landing page? Choose all that apply.' });
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Finish the lesson' })).toBeTruthy();
    expect(screen.getByText('1 more block after you continue')).toBeTruthy();
    expect(calls.filter((c) => c.url === `/api/v1/me/lessons/${LESSON_ID}`)).toHaveLength(2);
    // The first section's answer survived the reload.
    expect(within(checkForm('Which stage turns visitors into leads?')).getByRole('status')).toHaveTextContent('Not quite.');

    // A fill-in check: typed, checked (no options to reveal), then the last gate.
    const fill = checkForm('The page a visitor lands on from an ad is the ___ page.');
    await user.type(within(fill).getByRole('textbox'), ' Landing {Enter}');
    await waitFor(() => expect(within(fill).getByRole('status')).toHaveTextContent('Correct!'));
    await user.click(screen.getByRole('button', { name: 'Finish the lesson' }));
    await screen.findByText('Nice work — you’ve mapped your funnel. On to the next lesson!');
    expect(screen.queryByText(/after you continue/)).toBeNull();
  });
});
