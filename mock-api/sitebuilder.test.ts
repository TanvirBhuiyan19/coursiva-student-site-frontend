/**
 * Contract tests for the site builder's storefront output (docs/api/pages.md, docs/api/tenant.md), run against the
 * mock — which ports Laravel's SitePages / SiteChrome / SiteAccess, so these describe what Laravel returns.
 */
import { app } from './app';
import { allTenants, reset } from './lib/db';
import { parseVideo } from './lib/sitebuilder';

type Json = Record<string, any>;

/** A cookie-jar client scoped to one tenant, like a browser on that tenant's domain. */
function browser(tenant: string) {
  const jar = new Map<string, string>();
  const send = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'X-Tenant': tenant, Accept: 'application/json' };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && jar.has('XSRF-TOKEN')) headers['X-XSRF-TOKEN'] = decodeURIComponent(jar.get('XSRF-TOKEN')!);
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair!.split('=');
      if (/Max-Age=0/i.test(c) || v === '') jar.delete(k!);
      else jar.set(k!, v!);
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? (JSON.parse(text) as Json) : null };
  };
  return {
    get: (p: string) => send('GET', p),
    post: async (p: string, b: unknown = {}) => {
      if (!jar.has('XSRF-TOKEN')) await send('GET', '/sanctum/csrf-cookie');
      return send('POST', p, b);
    },
    async signIn(email = 'jordan.tate@gmail.com', password = 'password') {
      await send('GET', '/sanctum/csrf-cookie');
      return send('POST', '/api/v1/auth/login', { email, password, remember: false });
    },
  };
}

const tenant = (slug: string) => allTenants().find((x) => x.site.slug === slug)!;

beforeEach(() => reset());

describe('builder pages', () => {
  it('serve the home page with the common frame on every section; app-screen and hidden sections are omitted', async () => {
    const res = await browser('amplify').get('/api/v1/pages/home');
    expect(res.status).toBe(200);
    const page = res.json!.data;
    expect(Object.keys(page).sort()).toEqual(['sections', 'seo', 'slug', 'title', 'updated_at']);
    expect(page.seo).toEqual({
      title: null,
      description: null,
      og_image_url: 'https://cdn.coursiva.app/amplify/share.png',
      noindex: false,
    });
    for (const s of page.sections)
      for (const k of ['id', 'kind', 'anchor', 'style', 'visibility', 'animation']) expect(s).toHaveProperty(k);
    expect((page.sections as Json[]).map((s: Json) => s.kind)).toEqual([
      'hero',
      'featured_courses',
      'topics',
      'instructor',
      'membership_plans',
      'testimonials',
      'value_props',
      'newsletter',
    ]);
    const [hero, featured, , bio, plans, testimonials, values, newsletter] = page.sections;
    expect(hero.style).toEqual({ bg: 'tint', pad: 'l', align: 'left', width: 'contained', divider: false, variant: 'course' });
    expect(hero).toMatchObject({ side: 'card', compact: false, video: null, primary_cta: { label: 'Browse courses', href: '/courses' } });
    // A legacy link (the editor used to store labels) resolves leniently.
    expect(hero.secondary_cta).toEqual({ label: 'My learning', href: '/learning' });
    expect(hero.spotlight.slug).toBeTruthy();
    expect(featured).toMatchObject({
      link: { label: 'See all →', href: '/courses' },
      show_price: true,
      show_rating: true,
      variant: 'course',
    });
    // What the school typed wins over computed data; a real video URL becomes a privacy-enhanced embed.
    expect(bio.stats[0]).toEqual({ value: '1,284', label: 'students taught' });
    expect(bio.video).toMatchObject({
      provider: 'youtube',
      embed_url: 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ',
      title: 'Welcome to Amplify Coaching',
      duration_seconds: 124,
    });
    expect(plans).toMatchObject({ annual_toggle: true, static_plans: [] });
    expect(plans.plans.length).toBeGreaterThan(0);
    // No school quotes → featured learner feedback, with ratings.
    expect(testimonials.items[0].rating).toBe(5);
    expect(values.items[0]).toEqual({ icon: 'check', glyph: '✓', title: '30-day guarantee', body: expect.any(String) });
    expect(newsletter).toMatchObject({ placeholder: 'you@email.com', button_label: 'Subscribe', style: { bg: 'dark' } });
  });

  it('resolve every other kind, anchors, per-device visibility, animations and drop unsafe content', async () => {
    const res = await browser('amplify').get('/api/v1/pages/about');
    expect(res.status).toBe(200);
    const s = Object.fromEntries((res.json!.data.sections as Json[]).map((x: Json) => [x.id, x])) as Record<string, Json>;
    expect(res.json!.data.seo).toMatchObject({ title: 'About Amplify Coaching', noindex: false });
    expect(s.ab_hero).toMatchObject({ compact: true, side: 'none', title: 'About Amplify Coaching', primary_cta: { href: '#contact' } });
    expect(s.ab_story).toMatchObject({ kind: 'text', anchor: 'story', animation: 'fade_up' });
    expect(s.ab_stats).toMatchObject({ kind: 'stats', style: { bg: 'brand', align: 'center', width: 'full' }, animation: 'zoom' });
    expect(s.ab_features!.items[1]).toMatchObject({ glyph: '', icon: 'check' });
    expect(s.ab_faq!.items).toHaveLength(2);
    expect(s.ab_logos!.items[1]).toEqual({ name: 'Creator Daily', image_url: null }); // only https images
    expect(s.ab_video!.video).toEqual({
      url: 'https://vimeo.com/76979871',
      provider: 'vimeo',
      embed_url: 'https://player.vimeo.com/video/76979871',
    });
    expect(s.ab_unsafe_video).toBeUndefined();
    expect(s.ab_testimonials!.items[0].rating).toBeNull();
    expect(s.ab_compare).toMatchObject({ columns: ['Single course', 'Membership', 'Coaching'], highlight: 1 });
    expect(s.ab_compare!.rows[2].values).toEqual(['—', '—', 'Monthly']);
    expect(s.ab_quote).toMatchObject({ kind: 'quote', name: 'Maya Reyes', author: { initials: 'MR' }, style: { divider: true } });
    expect(s.ab_cta).toMatchObject({ kind: 'cta', button: { label: 'Browse courses', href: '/courses' } });
    expect(s.ab_banner!.button).toEqual({ label: 'Get the bundle', href: '/checkout' });
    expect(s.ab_form).toMatchObject({
      action: '/api/v1/pages/about/forms/ab_form',
      captcha: true,
      save: true,
      submit_label: 'Send message',
    });
    expect((s.ab_form!.fields as Json[]).map((f: Json) => [f.id, f.type, f.required])).toEqual([
      ['f1', 'text', true],
      ['f2', 'email', true],
      ['f3', 'phone', false],
      ['f4', 'choice', false],
      ['f5', 'long_text', true],
      ['f6', 'checkbox', true],
    ]);
    expect(s.ab_form!.fields[3].options).toEqual(['Courses', 'Membership', 'Something else']);
    expect(s.ab_desktop!.visibility).toEqual({ desktop: true, mobile: false });
    expect(s.ab_mobile!.visibility).toEqual({ desktop: false, mobile: true });
    expect(s.ab_nowhere).toBeUndefined();
  });

  it('accept multi-segment slugs and refuse anything outside the slug grammar', async () => {
    expect((await browser('amplify').get('/api/v1/pages/about/team')).json!.data.slug).toBe('about/team');
    for (const bad of ['nope', 'About', 'about_us', 'courses/:slug']) {
      const r = await browser('amplify').get(`/api/v1/pages/${bad}`);
      expect(r.status, bad).toBe(404);
      expect(r.json!.code).toBe('not_found');
    }
  });

  it('serve the starter site before the first publish', async () => {
    tenant('northwind').builder.live = null;
    const home = (await browser('northwind').get('/api/v1/pages/home')).json!.data;
    expect((home.sections as Json[]).map((s: Json) => s.kind)).toEqual(['hero', 'featured_courses', 'topics', 'value_props']);
    expect(home.sections[0]).toMatchObject({ title: 'Learn with Northwind Yoga', eyebrow: 'Now enrolling', side: 'card' });
    expect(home.sections[0].stats[0]).toMatchObject({ label: expect.stringMatching(/courses?/) });
    const site = (await browser('northwind').get('/api/v1/site')).json!.data;
    expect(site.navigation.header.items).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Courses', href: '/courses' },
      { label: 'My learning', href: '/learning' },
    ]);
    // The starter has the credit on, even on a white-label plan.
    expect(site.navigation.footer.show_powered).toBe(true);
    expect(site.screens.auth).toMatchObject({ title: 'Welcome back', signup: true, google: true, forgot: true, quote: null });
  });
});

describe('GET /site builder output', () => {
  it('adds navigation, theme, announcement, favicon, head code, cookie banner, lock state and screens', async () => {
    const site = (await browser('amplify').get('/api/v1/site')).json!.data;
    expect(site.navigation.header).toMatchObject({
      logo_text: 'Amplify Coaching',
      cta: { label: 'Browse courses', href: '/courses' },
      sticky: true,
      show_cart: true,
      show_notifications: true,
    });
    // Header links that are on, then pages shown in navigation; the switched-off link is left out.
    expect((site.navigation.header.items as Json[]).map((i: Json) => i.href)).toEqual([
      '/',
      '/courses',
      '/membership',
      '/community',
      '/learning',
      '/about',
    ]);
    expect((site.navigation.footer.columns as Json[]).map((c: Json) => c.title)).toEqual(['Learn', 'Company', 'Support']);
    expect(site.navigation.footer.columns[1].links).toEqual([
      { label: 'About us', href: '/about' },
      { label: 'Our team', href: '/about/team' },
    ]);
    expect(site.navigation.footer.copyright).toBe(`© ${new Date().getFullYear()} Amplify Coaching. All rights reserved.`);
    expect(site.navigation.footer.show_powered).toBe(true); // forced on: not white-label
    expect(site.theme).toEqual({ font: 'bricolage_instrument', radius: 'soft', buttons: 'filled', density: 'comfortable' });
    expect(site.announcement).toEqual({ text: 'New: the Launch Lab cohort starts 1 November.' });
    expect(site.favicon_url).toBe('/api/v1/site/assets/ast_favicon');
    // Branding's logo and square icon sit next to it (the icon is the favicon fallback); none uploaded in the seed.
    expect(site).toMatchObject({ logo_url: null, icon_url: null });
    expect(site.head_code).toContain('amplify-verification');
    expect(site.cookie_banner).toBe(false);
    expect(site.site_lock).toEqual({ enabled: false, unlocked: true, password: false });
    expect(site.screens.legal.privacy).toMatchObject({ title: 'Privacy policy', updated: 'Last updated 1 August 2026' });
    expect(site.screens.legal.terms).toBeNull();
    expect(site.screens.auth).toMatchObject({
      tagline: 'Marketing skills that grow your business',
      quote: { author: 'Priya Nair · student' },
    });
    const icon = await app.request('/api/v1/site/assets/ast_favicon', { headers: { 'X-Tenant': 'amplify' } });
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toBe('image/png');
    expect((await browser('amplify').get('/api/v1/site/assets/ast_other')).status).toBe(404);
  });

  it('serves the draft for a valid preview token, uncached and without head code', async () => {
    const b = browser('amplify');
    const res = await b.get('/api/v1/site?preview=preview-demo-token');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.json!.data.head_code).toBeNull();
    expect(res.json!.data.announcement.text).toContain('Draft');
    const draft = await b.get('/api/v1/pages/home?preview=preview-demo-token');
    expect(draft.headers.get('cache-control')).toBe('private, no-store');
    expect(draft.json!.data.sections[0].title).toBe('Draft: a brand-new homepage');
    expect((await b.get('/api/v1/pages/home?preview=wrong')).json!.data.sections[0].title).toBe('Marketing skills that grow your business');
    expect((await b.get('/api/v1/pages/home')).headers.get('cache-control')).toBeNull();
  });
});

describe('page access', () => {
  it('password pages answer 401 until unlocked with the page password', async () => {
    const guest = browser('amplify');
    const locked = await guest.get('/api/v1/pages/vip');
    expect(locked.status).toBe(401);
    expect(locked.json).toMatchObject({ code: 'page_password_required', title: 'VIP workshop' });
    expect((await guest.post('/api/v1/pages/vip/unlock', { password: 'nope' })).json!.errors).toEqual({
      password: ['That password isn’t right.'],
    });
    expect((await guest.post('/api/v1/pages/vip/unlock', { password: 'open-sesame' })).json).toEqual({ data: { unlocked: true } });
    const open = await guest.get('/api/v1/pages/vip');
    expect(open.status).toBe(200);
    expect(open.headers.get('cache-control')).toBe('private, no-store');
    expect(open.json!.data.seo.noindex).toBe(true);
    expect((await guest.post('/api/v1/pages/about/unlock', { password: 'x' })).status).toBe(404);
  });

  it('members-only pages: 401 signed out, 200 for members, 403 for other learners', async () => {
    const guest = await browser('amplify').get('/api/v1/pages/members');
    expect(guest.status).toBe(401);
    expect(guest.json!.code).toBe('members_only');
    const member = browser('amplify');
    await member.signIn();
    expect((await member.get('/api/v1/pages/members')).status).toBe(200);
    const t = tenant('amplify');
    t.enrollments = [];
    for (const u of t.users) u.membershipPlanId = null;
    const outsider = await member.get('/api/v1/pages/members');
    expect(outsider.status).toBe(403);
    expect(outsider.json!.code).toBe('members_only');
  });

  it('a locked site answers 401 site_locked until the visitor unlocks it; a preview always opens it', async () => {
    const b = browser('hideout');
    const site = await b.get('/api/v1/site');
    expect(site.headers.get('cache-control')).toBe('private, no-store');
    expect(site.json!.data.site_lock).toEqual({ enabled: true, unlocked: false, password: true });
    expect(site.json!.data.seo.indexable).toBe(false);
    for (const path of [
      '/api/v1/pages/home',
      '/api/v1/courses',
      '/api/v1/courses/yoga-foundations',
      '/api/v1/courses/yoga-foundations/preview',
    ]) {
      const r = await b.get(path);
      expect(r.status, path).toBe(401);
      expect(r.json!.code).toBe('site_locked');
    }
    expect((await b.get('/api/v1/pages/home?preview=hideout-preview')).status).toBe(200);
    expect((await b.post('/api/v1/site/unlock', { password: 'wrong' })).status).toBe(422);
    expect((await b.post('/api/v1/site/unlock', { password: 'letmein' })).status).toBe(200);
    expect((await b.get('/api/v1/site')).json!.data.site_lock.unlocked).toBe(true);
    expect((await b.get('/api/v1/pages/home')).status).toBe(200);
    expect((await b.get('/api/v1/courses')).status).toBe(200);
    // Unlocked, the preview answers as usual (404 here: the seeded preview has no playable media).
    expect((await b.get('/api/v1/courses/yoga-foundations/preview')).json!.message).toBe('This course has no preview.');
    expect((await browser('amplify').post('/api/v1/site/unlock', { password: 'x' })).status).toBe(404);
  });
});

describe('builder forms', () => {
  const values = { f1: 'Ada Lovelace', f2: 'ADA@example.com', f3: '+44 20 7946 0000', f4: 'Courses', f5: 'Hello!', f6: true };

  it('validate against the published fields with per-field messages', async () => {
    const bad = await browser('amplify').post('/api/v1/pages/about/forms/ab_form', {
      values: { f2: 'nope', f3: 'abc', f4: 'Other' },
      website: '',
    });
    expect(bad.status).toBe(422);
    expect(bad.json!.errors).toEqual({
      'values.f1': ['This field is required.'],
      'values.f2': ['Enter a valid email address.'],
      'values.f3': ['Enter a valid phone number.'],
      'values.f4': ['Choose one of the options.'],
      'values.f5': ['This field is required.'],
      'values.f6': ['Tick this box to continue.'],
    });
    const long = await browser('amplify').post('/api/v1/pages/about/forms/ab_form', { values: { ...values, f1: 'x'.repeat(501) } });
    expect(long.json!.errors).toEqual({ 'values.f1': ['Keep this to 500 characters or fewer.'] });
  });

  it('store a submission and the Forms & leads contact; a filled honeypot is accepted and dropped', async () => {
    const b = browser('amplify');
    expect(await b.post('/api/v1/pages/about/forms/ab_form', { values, website: '' })).toMatchObject({
      status: 201,
      json: { data: { received: true } },
    });
    const t = tenant('amplify');
    expect(t.builder.submissions).toHaveLength(1);
    expect(t.builder.submissions[0]!.values[1]).toEqual({ id: 'f2', label: 'Email', type: 'email', value: 'ada@example.com' });
    expect(t.builder.contacts).toEqual([{ email: 'ada@example.com', name: 'Ada Lovelace', source: 'Website form', tag: 'Lead' }]);
    expect((await b.post('/api/v1/pages/about/forms/ab_form', { values: {}, website: 'http://spam.example' })).status).toBe(201);
    expect(t.builder.submissions).toHaveLength(1);
    expect((await b.post('/api/v1/pages/about/forms/nope', { values })).status).toBe(404);
    expect((await b.post('/api/v1/pages/missing/forms/ab_form', { values })).status).toBe(404);
  });
});

describe('allow-listed videos (SiteVideo)', () => {
  const media = (id: string) => (id === 'vid1' ? `/api/v1/site/assets/${id}` : null);
  it.each([
    ['https://youtu.be/aqz-KE-bpKQ', 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ'],
    ['https://www.youtube.com/shorts/aqz-KE-bpKQ', 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ'],
    ['https://vimeo.com/76979871/abcdef12', 'https://player.vimeo.com/video/76979871?h=abcdef12'],
    ['https://www.loom.com/share/0123456789abcdef0123456789abcdef', 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef'],
    ['https://home.wistia.com/medias/abcde12345', 'https://fast.wistia.net/embed/iframe/abcde12345'],
  ])('%s', (raw, embed) => {
    expect(parseVideo(raw, media)?.embedUrl).toBe(embed);
  });
  it('plays media library videos directly and rejects everything else', () => {
    expect(parseVideo('media:vid1', media)).toEqual({ url: '/api/v1/site/assets/vid1', provider: 'media', embedUrl: null });
    for (const bad of [
      'media:gone',
      'javascript:alert(1)',
      'https://evil.example/x',
      'https://user@youtube.com/watch?v=aqz-KE-bpKQ',
      'https://youtu.be/short',
    ])
      expect(parseVideo(bad, media), bad).toBeNull();
  });
});

describe('header and footer anchor links', () => {
  it('go to the page that has the anchor (home first), and are left out when no page has it', async () => {
    const doc = tenant('amplify').builder.live!;
    const home = doc.pages.find((p) => p.slug === '/')!;
    const other = doc.pages.find((p) => p.slug !== '/' && !p.template && p.sections.length > 0)!;
    other.sections[0]!.set.anchor = 'pricing';
    other.sections[0]!.hide = false;
    home.sections[0]!.set.anchor = 'faq';
    other.sections.at(-1)!.set.anchor = other.sections.length > 1 ? 'faq' : 'pricing';
    doc.header.items = [
      { a: 'FAQ', b: '#faq', c: '', on: true },
      { a: 'Pricing', b: '#pricing', c: '', on: true },
      { a: 'Nope', b: '#nope', c: '', on: true },
    ];
    doc.footer.items = [{ a: 'Questions', b: 'Help', c: '#faq', on: true }];
    const site = (await browser('amplify').get('/api/v1/site')).json!.data;
    const items = site.navigation.header.items as Json[];
    expect(items.slice(0, 2)).toEqual([
      { label: 'FAQ', href: '/#faq' },
      { label: 'Pricing', href: `${other.slug}#pricing` },
    ]);
    expect(items.map((i: Json) => i.label)).not.toContain('Nope');
    expect(site.navigation.footer.columns).toEqual([{ title: 'Help', links: [{ label: 'Questions', href: '/#faq' }] }]);
  });
});
