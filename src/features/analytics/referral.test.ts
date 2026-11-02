// @vitest-environment jsdom
// Partner-link attribution (docs/consent.md, docs/api/commerce.md → ref, ref_click): the click id is kept only once
// the API records the click, for the school's window and by its first/last-click rule.
import { resetConsentForTests, saveChoice } from '@/features/consent/store';
import { checkoutAttribution, configureConsent, resetTrackingForTests } from '@/features/consent/tracking';
import { type AffiliateClick, captureReferral, keepClick, referral, referralFrom, refToReport } from './referral';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 9, 1);
const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
};
const click = (clickId: string, cookieDays = 30, attribution: AffiliateClick['attribution'] = 'last_click'): AffiliateClick => ({
  clickId,
  cookieDays,
  attribution,
});

describe('keeping a partner click', () => {
  it('reports a partner once per session, per partner, and ignores bad slugs', () => {
    const session = memory();
    expect(refToReport(session, 'https://learn.example.com/?ref=Maya-K')).toBe('maya-k');
    expect(refToReport(session, 'https://learn.example.com/courses?ref=maya-k')).toBeNull();
    expect(refToReport(session, 'https://learn.example.com/?ref=sam')).toBe('sam');
    expect(refToReport(session, 'https://learn.example.com/?ref=sam')).toBeNull();
    expect(refToReport(session, 'https://learn.example.com/?ref=%3Cscript%3E')).toBeNull();
    expect(refToReport(session, 'https://learn.example.com/')).toBeNull();
  });

  it('expires after the school’s window; 0 days never expires', () => {
    const local = memory();
    keepClick(local, 'maya', click('afc_1', 7), t0);
    expect(referralFrom(local, t0 + 6 * DAY)).toMatchObject({ ref: 'maya', refClick: 'afc_1' });
    expect(referralFrom(local, t0 + 8 * DAY)).toMatchObject({ ref: null, refClick: null });
    expect(local.m.has('coursiva:ref')).toBe(false); // dropped on read

    keepClick(local, 'maya', click('afc_2', 0), t0);
    expect(referralFrom(local, t0 + 5000 * DAY)).toMatchObject({ ref: 'maya', refClick: 'afc_2' });
  });

  it('last click replaces; first click keeps an unexpired earlier partner', () => {
    const local = memory();
    keepClick(local, 'maya', click('afc_1'), t0);
    expect(keepClick(local, 'sam', click('afc_2'), t0 + DAY)).toBe(true);
    expect(referralFrom(local, t0 + DAY)).toMatchObject({ ref: 'sam', refClick: 'afc_2' });

    const first = memory();
    keepClick(first, 'maya', click('afc_1', 30, 'first_click'), t0);
    expect(keepClick(first, 'sam', click('afc_2', 30, 'first_click'), t0 + DAY)).toBe(false);
    expect(referralFrom(first, t0 + DAY)).toMatchObject({ ref: 'maya', refClick: 'afc_1' });
    // Once the earlier one has expired, a new first click is kept.
    expect(keepClick(first, 'sam', click('afc_3', 30, 'first_click'), t0 + 31 * DAY)).toBe(true);
    expect(referralFrom(first, t0 + 31 * DAY)).toMatchObject({ ref: 'sam', refClick: 'afc_3' });
  });

  it('drops entries without a click id (older site versions) and malformed ones', () => {
    const local = memory();
    local.setItem('coursiva:ref', JSON.stringify({ value: 'maya', at: t0 }));
    expect(referralFrom(local, t0).ref).toBeNull();
    expect(local.m.has('coursiva:ref')).toBe(false);
    local.setItem('coursiva:ref', 'not json');
    expect(referralFrom(local, t0).ref).toBeNull();
    expect(keepClick(local, 'maya', click('bad id!'), t0)).toBe(false);
    expect(keepClick(local, 'maya', click('afc_1', -1), t0)).toBe(false);
  });
});

describe('in the browser', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps the click only once the API answers; a failed report stores nothing', async () => {
    await captureReferral(() => Promise.resolve(null), 'https://learn.example.com/?ref=maya');
    expect(localStorage.getItem('coursiva:ref')).toBeNull();
    expect(referral().ref).toBeNull();

    const report = vi.fn(() => Promise.resolve(click('afc_9', 30)));
    await captureReferral(report, 'https://learn.example.com/?ref=sam');
    await captureReferral(report, 'https://learn.example.com/?ref=sam');
    expect(report).toHaveBeenCalledTimes(1);
    expect(referral()).toMatchObject({ ref: 'sam', refClick: 'afc_9' });
    expect(JSON.parse(localStorage.getItem('coursiva:ref') ?? '{}')).toMatchObject({ value: 'sam', click: 'afc_9', days: 30 });
  });

  it('sends ref + ref_click only with marketing, and withdrawing marketing forgets them', async () => {
    resetConsentForTests();
    resetTrackingForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) =>
        Promise.resolve(
          input.toString().includes('/affiliates/')
            ? Response.json({ data: { click_id: 'afc_7', cookie_days: 30, attribution: 'last_click' } }, { status: 201 })
            : new Response(null, { status: 204 }),
        ),
      ),
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    window.history.replaceState(null, '', '/?ref=maya');
    configureConsent({ required: true });
    expect(checkoutAttribution()).toMatchObject({ ref: null, refClick: null });

    saveChoice({ analytics: false, marketing: true });
    await vi.waitFor(() => expect(checkoutAttribution()).toMatchObject({ ref: 'maya', refClick: 'afc_7' }));

    saveChoice({ analytics: false, marketing: false });
    expect(localStorage.getItem('coursiva:ref')).toBeNull();
    expect(checkoutAttribution()).toMatchObject({ ref: null, refClick: null });
  });
});
