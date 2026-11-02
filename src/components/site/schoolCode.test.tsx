// The school's custom code per path (the layout's `@code` slot, docs/consent.md): code-free pages get none of it on the
// server, so it never reaches their HTML or payload.
import { isValidElement } from 'react';
import SchoolCodeFor from '@/app/[tenant]/[locale]/@code/[...slug]/page';
import { SchoolCode } from './SchoolCode';
import { ConsentScripts } from './ConsentScripts';
import { HeadCode } from './HeadCode';

const site = vi.hoisted(() => ({
  headCode: '<meta name="x-verify" content="1"><script>window.__schoolCode = 1</script>',
  siteLock: { enabled: false, unlocked: false },
}));
vi.mock('@/features/tenant/server', () => ({ getCurrentSite: () => Promise.resolve(site) }));
vi.mock('@/i18n/navigation', () => ({ useAppPathname: () => '/' }));

const slot = (slug: string[]) =>
  SchoolCodeFor({ params: Promise.resolve({ tenant: 'amp', locale: 'en', slug }), searchParams: Promise.resolve({}) });

/** The component types a server element tree renders (its fragments and `HideOnPaths` unwrapped). */
function typesOf(node: unknown): unknown[] {
  if (Array.isArray(node)) return node.flatMap(typesOf);
  if (!isValidElement(node)) return [];
  const { children } = node.props as { children?: unknown };
  return [node.type, ...typesOf(children)];
}

describe('school code per path', () => {
  it('gives code-free pages nothing and every other page the code', async () => {
    for (const slug of [
      ['sign-in'],
      ['checkout', 'funnel'],
      ['account', 'billing'],
      ['orders', 'ord_1'],
      ['webinars', 'join'],
      ['forgot-password'],
    ])
      expect(await slot(slug)).toBeNull();
    // A malformed escape can't be checked: no code.
    expect(await slot(['%E0%A4%A'])).toBeNull();
    for (const slug of [['courses'], ['blog', 'post'], ['live', 'lv_1'], ['courses', 'funnel']]) {
      const el = await slot(slug);
      expect(isValidElement(el) && el.type).toBe(SchoolCode);
    }
  });

  it('renders the passive tags always, and the consent-gated ones only on an open site', async () => {
    expect(typesOf(await SchoolCode())).toEqual(expect.arrayContaining([HeadCode, ConsentScripts]));
    site.siteLock = { enabled: true, unlocked: false };
    const locked = typesOf(await SchoolCode());
    expect(locked).toContain(HeadCode);
    expect(locked).not.toContain(ConsentScripts);
    site.siteLock = { enabled: false, unlocked: false };
    site.headCode = '';
    expect(await SchoolCode()).toBeNull();
  });
});
