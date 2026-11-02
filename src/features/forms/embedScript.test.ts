// @vitest-environment jsdom
import { EMBED_SCRIPT } from './embedScript';

/**
 * Runs `/embed/forms.js` in jsdom on a page at https://partner.example, with a stand-in `window` whose `location` can
 * be observed (jsdom's own can't be stubbed). Events still go through the real window.
 */
function runScript(search = '?utm_source=news&ref=maya&other=1') {
  const assign = vi.fn();
  const w = {
    location: { origin: 'https://partner.example', href: `https://partner.example/landing${search}`, search, assign },
    addEventListener: (type: string, fn: EventListener) => window.addEventListener(type, fn),
  } as unknown as Window & { __coursivaForms?: { frames: unknown[] } };
  // The script is a string by design (served as-is); compiling it here is the point of the test.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const script = new Function('window', 'document', EMBED_SCRIPT) as (w: Window, d: Document) => void;
  const run = () => script(w, document);
  run();
  return { w, assign, run };
}

function addScript(attrs: Record<string, string>, src = 'https://amplify.coursiva.example/embed/forms.js') {
  const s = document.createElement('script');
  s.setAttribute('type', 'text/plain'); // jsdom never runs it: the test runs the source itself
  s.setAttribute('src', src);
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.body.appendChild(s);
  return s;
}

const message = (iframe: HTMLIFrameElement | null, data: unknown, origin = 'https://amplify.coursiva.example', source?: unknown) =>
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: (source ?? iframe?.contentWindow ?? null) as Window | null }));

let listeners: EventListener[] = [];
const realAdd = window.addEventListener.bind(window);
beforeEach(() => {
  document.body.innerHTML = '';
  listeners = [];
  vi.spyOn(window, 'addEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject) => {
    if (type === 'message') listeners.push(fn as EventListener);
    realAdd(type, fn);
  });
});
afterEach(() => {
  for (const l of listeners) window.removeEventListener('message', l);
  vi.restoreAllMocks();
});

describe('/embed/forms.js', () => {
  it('adds a sandboxed iframe of the embed frame on the script’s own origin, forwarding the page and campaign', () => {
    const s = addScript({ 'data-form': 'frm_abc', 'data-title': 'Apply' });
    runScript();
    const f = s.nextElementSibling as HTMLIFrameElement;
    expect(f.tagName).toBe('IFRAME');
    expect(f.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    expect(f.title).toBe('Apply');
    expect(f.getAttribute('loading')).toBe('lazy');
    const src = new URL(f.src);
    expect(src.origin).toBe('https://amplify.coursiva.example');
    expect(src.pathname).toBe('/embed/forms/frm_abc');
    expect(src.searchParams.get('origin')).toBe('https://partner.example');
    expect(src.searchParams.get('page')).toBe('https://partner.example/landing?utm_source=news&ref=maya&other=1');
    expect(src.searchParams.get('utm_source')).toBe('news');
    expect(src.searchParams.get('ref')).toBe('maya');
    expect(src.searchParams.has('other')).toBe(false);
  });

  it('supports data-target, several forms, repeated loads, and ignores other scripts and bad ids', () => {
    const box = document.createElement('div');
    box.id = 'here';
    document.body.appendChild(box);
    addScript({ 'data-form': 'frm_one', 'data-target': 'here' });
    addScript({ 'data-form': 'frm_two' });
    addScript({ 'data-form': 'frm_x' }, 'https://cdn.example/other.js');
    addScript({ 'data-form': '"><img src=x>' });
    const { run } = runScript();
    run(); // a second copy of the script on the same page
    expect(box.querySelectorAll('iframe')).toHaveLength(1);
    expect(document.querySelectorAll('iframe')).toHaveLength(2);
    expect(listeners).toHaveLength(1);
  });

  it('pins the frame’s origin from its first message, so a school that moved to a new domain keeps working', () => {
    const s = addScript({ 'data-form': 'frm_moved' });
    runScript();
    const f = s.nextElementSibling as HTMLIFrameElement;
    const resize = (h: number) => ({ source: 'coursiva-form', v: 1, form: 'frm_moved', type: 'resize', height: h });

    // The script came from the old host; its frame was redirected to the school's custom domain.
    message(f, resize(500), 'https://learn.school.example');
    expect(f.style.height).toBe('500px');
    message(f, resize(700), 'https://learn.school.example');
    expect(f.style.height).toBe('700px');
    message(f, resize(300), 'https://evil.example'); // navigated elsewhere since
    expect(f.style.height).toBe('700px');
  });

  it('trusts only messages from its own frame and origin, for its form', () => {
    const s = addScript({ 'data-form': 'frm_abc' });
    const { assign } = runScript();
    const f = s.nextElementSibling as HTMLIFrameElement;
    const resize = (h: unknown) => ({ source: 'coursiva-form', v: 1, form: 'frm_abc', type: 'resize', height: h });

    message(f, resize(640));
    expect(f.style.height).toBe('640px');
    message(f, resize(5)); // clamped
    expect(f.style.height).toBe('50px');
    message(f, resize(1e9));
    expect(f.style.height).toBe('10000px');
    message(f, resize(300), 'https://evil.example'); // wrong origin
    message(f, resize(300), undefined, window); // wrong window
    message(f, { ...resize(300), form: 'frm_other' }); // another form
    message(f, { ...resize(300), source: 'something-else' });
    message(f, resize('300px; display:none'));
    expect(f.style.height).toBe('10000px');

    const seen: unknown[] = [];
    document.addEventListener('coursiva:form-submitted', (e) => seen.push((e as CustomEvent).detail));
    message(f, { source: 'coursiva-form', v: 1, form: 'frm_abc', type: 'submitted', submission: 'fsb_1' });
    expect(seen).toEqual([{ form: 'frm_abc', submission: 'fsb_1' }]);

    message(f, { source: 'coursiva-form', v: 1, form: 'frm_abc', type: 'redirect', url: 'javascript:alert(1)' });
    message(f, { source: 'coursiva-form', v: 1, form: 'frm_abc', type: 'redirect', url: 'https://evil.example/' }, 'https://evil.example');
    expect(assign).not.toHaveBeenCalled();
    message(f, { source: 'coursiva-form', v: 1, form: 'frm_abc', type: 'redirect', url: 'https://school.example/thanks' });
    expect(assign).toHaveBeenCalledWith('https://school.example/thanks');
  });
});
