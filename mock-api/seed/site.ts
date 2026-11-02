/**
 * Site-builder documents for the seed schools, in the dashboard's own format (lib/sitebuilder.ts). Amplify has a
 * published site that exercises every marketing kind, page visibility, header/footer, theme, head code and a draft
 * for preview links; Northwind publishes the starter site with one change; Hideout is a locked starter site.
 */
import { type BDoc, type BuilderState, page, sec, starter } from '../lib/sitebuilder';

export function builderState(
  live: BDoc | null,
  draft: BDoc = structuredClone(live ?? starter('')),
  previewTokens: string[] = [],
): BuilderState {
  return {
    live,
    draft,
    previewTokens,
    publishedAt: live ? '2026-09-28T09:00:00Z' : null,
    draftUpdatedAt: '2026-10-01T10:00:00Z',
    submissions: [],
    contacts: [],
  };
}

/** Amplify's published site: the home page as before, plus pages that exercise every renderer. */
export function amplifySite(): BuilderState {
  const name = 'Amplify Coaching';
  const base = starter(name);
  const live: BDoc = {
    header: sec(
      'header',
      'header',
      { logo: name, cta: 'Browse courses', cta_to: 'route:catalog' },
      [
        ['Home', 'page:home'],
        ['Courses', 'route:catalog'],
        ['Membership', 'route:membership'],
        ['Community', 'route:community'],
        // A legacy label (the editor used to store titles): resolved leniently.
        ['My learning', ''],
        { a: 'Hidden link', b: '/hidden', c: '', on: false },
      ],
      {},
      { sticky: true, cart: true, notif: true, streak: true },
    ),
    footer: sec(
      'footer',
      'footer',
      { tagline: 'Practical marketing courses from coaches who’ve done it themselves.', copy: '© {year} {tenant}. All rights reserved.' },
      [
        ['All courses', 'Learn', 'route:catalog'],
        ['Membership', 'Learn', 'route:membership'],
        ['My learning', 'Learn', 'route:learning'],
        ['About us', 'Company', 'page:about'],
        ['Our team', 'Company', 'page:team'],
        ['Help centre', 'Support', 'route:help'],
        ['Contact us', 'Support', 'route:contact'],
        ['Refund policy', 'Support', '/refund-policy'],
      ],
      {},
      { social: true, legal: true, powered: false },
    ),
    theme: {
      font: 'Bricolage + Instrument',
      radius: 'Soft',
      buttons: 'Filled',
      density: 'Comfortable',
      announcementOn: true,
      announcementText: 'New: the Launch Lab cohort starts 1 November.',
    },
    settings: {
      ...base.settings,
      headCode:
        '<!-- Amplify verification -->\n<meta name="amplify-verification" content="amp-7f3k">\n<script>window.__amplifyHead = true;</script>',
      social: [
        { network: 'linkedin', url: 'https://www.linkedin.com/company/amplify-coaching' },
        { network: 'instagram', url: 'https://www.instagram.com/amplifycoaching' },
        { network: 'youtube', url: 'https://www.youtube.com/@amplifycoaching' },
      ],
      favicon: { assetId: 'ast_favicon', url: '/api/v1/site/assets/ast_favicon' },
      shareImage: { assetId: 'ast_share', url: 'https://cdn.coursiva.app/amplify/share.png' },
    },
    pages: [
      page(
        'home',
        'Home',
        '/',
        [
          sec(
            'sec_hero',
            'hero',
            {
              badge: 'Trusted by 1,284 students',
              title: 'Marketing skills that grow your business',
              sub: 'Practical courses from coaches who have done it themselves. Learn at your pace, keep lifetime access.',
              btn: 'Browse courses',
              btn_to: 'route:catalog',
              btn2: 'My learning',
              btn2_to: 'My learning',
            },
            [],
            { bg: 'tint', pad: 'L', side: 'card' },
          ),
          sec(
            'sec_featured',
            'grid',
            { title: 'Featured courses', link: 'See all →', link_to: 'route:catalog' },
            [],
            {},
            { src: 'Featured courses' },
          ),
          sec('sec_topics', 'topics', { title: 'Browse by topic' }),
          sec(
            'sec_instructor',
            'bio',
            {
              eyebrow: 'Meet your instructor',
              title: 'Learn from someone who’s done it',
              name: 'Maya Reyes',
              role: 'Founder, Amplify Coaching',
              text: 'Ten years building funnels for coaches and creators — now distilled into courses with worksheets, live Q&A every week, and a community that answers fast.',
              video_url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
              caption: 'Welcome to Amplify Coaching · 2:04',
            },
            [
              ['1,284', 'students taught'],
              ['4.9★', 'avg course rating'],
              ['139', 'certificates issued'],
            ],
          ),
          sec(
            'sec_membership',
            'pricing',
            {
              title: 'Or join the membership',
              sub: 'Every course, the community and weekly live Q&A — one subscription.',
              btn_to: 'route:membership',
            },
            [
              ['Starter', '$29/mo', 'One course a month'],
              ['Pro', '$59/mo', 'Every course + community'],
            ],
            {},
            { annual: true },
          ),
          sec('sec_testimonials', 'testimonial', { title: '' }, [], { al: 'center' }),
          sec('sec_values', 'features', { title: '' }, [
            ['30-day guarantee', 'Full refund inside 30 days if a course isn’t right for you.', '✓'],
            ['Lifetime access', 'Pay once and keep every lesson, worksheet and future update.', '∞'],
            ['Verified certificates', 'Finish a course and share a credential anyone can verify.', '✦'],
          ]),
          sec(
            'sec_newsletter',
            'cta',
            {
              title: 'Get one free lesson every Friday',
              sub: 'A full lesson from one of the courses, in your inbox. Unsubscribe anytime.',
              ph: 'you@email.com',
              btn: 'Subscribe',
            },
            [],
            { bg: 'dark', al: 'center' },
          ),
          // App-screen kinds and hidden sections never reach a page.
          sec('sec_cart', 'cart', { title: 'Your cart' }),
          { ...sec('sec_hidden', 'text', { title: 'Hidden draft note', body: 'Not on the site.' }), hide: true },
        ],
        { seoTitle: '', seoDescription: '' },
      ),
      page(
        'about',
        'About',
        '/about',
        [
          sec(
            'ab_hero',
            'hero',
            {
              badge: 'Since 2016',
              title: 'About {tenant}',
              sub: 'Coaches who teach what they practise.',
              btn: 'Talk to us',
              btn_to: '#contact',
            },
            [
              ['10 yrs', 'coaching'],
              ['1,284', 'students'],
            ],
            { pad: 'S', al: 'center' },
            { compact: true },
          ),
          sec(
            'ab_story',
            'text',
            {
              title: 'Our story',
              body: 'Amplify started as a weekly workshop in a borrowed office.\nTen people came.\n\nToday {tenant} teaches coaches and creators in 40 countries.',
            },
            [],
            {},
            {},
            { anchor: 'story', anim: 'Fade up' },
          ),
          sec(
            'ab_stats',
            'stats',
            {},
            [
              ['1,284', 'students'],
              ['4.9', 'average rating'],
              ['40', 'countries'],
            ],
            { bg: 'brand', al: 'center', w: 'full' },
            {},
            { anim: 'Zoom' },
          ),
          sec(
            'ab_features',
            'features',
            { title: 'Why learners stay' },
            [
              ['Live Q&A', 'Every week, with Maya.', '★'],
              ['Worksheets', 'Templates you can use today.', ''],
            ],
            { bg: 'gray' },
            {},
            { anim: 'Slide in' },
          ),
          sec(
            'ab_faq',
            'faq',
            { title: 'Questions, answered' },
            [
              ['Do I get lifetime access?', 'Yes — pay once and keep every lesson and update.'],
              ['Is there a guarantee?', 'Thirty days, no questions asked.'],
            ],
            {},
            {},
            { anchor: 'faq' },
          ),
          sec('ab_logos', 'logos', { title: 'As featured in' }, [
            ['Marketing Weekly', ''],
            ['Creator Daily', 'http://insecure.example/logo.png'],
            ['Growth Lab', ''],
          ]),
          sec('ab_video', 'video', { url: 'https://vimeo.com/76979871', caption: 'A minute inside a live Q&A' }),
          sec('ab_unsafe_video', 'video', { url: 'https://evil.example/embed/123', caption: 'Dropped: not allow-listed' }),
          sec(
            'ab_testimonials',
            'testimonial',
            { title: 'In their words' },
            [
              ['The pricing lesson paid for the course forty times over.', 'Priya Nair', 'Coach'],
              ['Clear, practical and kind.', 'Tom Okafor', ''],
            ],
            { bg: 'gray' },
          ),
          sec(
            'ab_quote',
            'quote',
            { text: 'Teach what you practise, and practise what you teach.', name: 'Maya Reyes', meta: 'Founder' },
            [],
            { div: true },
          ),
          sec('ab_compare', 'compare', { title: 'Pick your path', c1: 'Single course', c2: 'Membership', c3: 'Coaching' }, [
            ['Lifetime access', '✓|✓|✓'],
            ['Community', '—|✓|✓'],
            ['1:1 calls', '—|—|Monthly'],
          ]),
          sec(
            'ab_cta',
            'cta',
            { title: 'Ready when you are', sub: 'Start with one course.', btn: 'Browse courses', btn_to: 'route:catalog' },
            [],
            { bg: 'brand' },
          ),
          sec('ab_banner', 'banner', { title: 'Bundle all six courses and save 30%', btn: 'Get the bundle' }, [], { bg: 'tint' }),
          sec(
            'ab_form',
            'form',
            { title: 'Talk to us', sub: 'We answer within a day.', btn: 'Send message', note: 'We never share your details.' },
            [
              ['Your name*', 'text'],
              ['Email*', 'email'],
              ['Phone', 'phone'],
              ['Topic', 'choice', 'Courses|Membership|Something else'],
              ['Message*', 'long text'],
              ['I agree to be contacted*', 'checkbox'],
              ['Continue with Google', ''],
            ],
            {},
            { captcha: true, save: true },
            { anchor: 'contact' },
          ),
          sec('ab_desktop', 'text', { title: 'Desktop only', body: 'Shown on wide screens.' }, [], { pad: 'S' }, {}, { mob: false }),
          sec('ab_mobile', 'text', { title: 'Mobile only', body: 'Shown on phones.' }, [], { pad: 'S' }, {}, { desk: false }),
          sec('ab_nowhere', 'text', { title: 'Nowhere', body: 'Off on every device.' }, [], {}, {}, { desk: false, mob: false }),
        ],
        { showInNav: true, seoTitle: 'About {tenant}', seoDescription: 'Who we are, how we teach and how to reach us.' },
      ),
      page('team', 'Our team', '/about/team', [
        sec('tm_text', 'text', { title: 'The team', body: 'Four coaches, one support desk.' }),
        sec('tm_quote', 'quote', { text: 'We answer every question within a day.', name: 'Lena Fischer', meta: 'Head of support' }),
        // A form section set to a lead form (Forms & leads → Waitlist): the storefront renders the lead form inline.
        sec(
          'tm_lead',
          'form',
          { title: 'Join the waitlist', sub: 'We’ll email you when the next cohort opens.' },
          [],
          {},
          { lead_form: 'frm_01jd8x7k3q9w2e5r6t7y8z9qck' },
        ),
      ]),
      page(
        'members',
        'Members lounge',
        '/members',
        [sec('mb_text', 'text', { title: 'Members lounge', body: 'Recordings of every live Q&A.' })],
        {
          visibility: 'Members only',
        },
      ),
      page('vip', 'VIP workshop', '/vip', [sec('vip_text', 'text', { title: 'VIP workshop', body: 'The replay and slides.' })], {
        visibility: 'Password',
        password: 'open-sesame',
      }),
      page(
        'login',
        'Sign in',
        '/login',
        [
          sec(
            'auth',
            'auth',
            {
              title: 'Welcome back',
              sub: 'Sign in to continue learning.',
              btn: 'Sign in',
              tagline: 'Marketing skills that grow your business',
              quote: 'First $1k week since joining. The pricing lesson paid for the course forty times over.',
              quote_by: 'Priya Nair · student',
            },
            ['6 courses · quizzes, worksheets & certificates', 'Weekly live Q&A with Maya', 'Community of 1,284 students'],
            { pad: 'L' },
            { signup: true, google: true, forgot: true },
          ),
        ],
        { group: 'Account & legal' },
      ),
      page(
        'privacy',
        'Privacy',
        '/privacy',
        [
          sec(
            'legal_privacy',
            'legal',
            {
              title: 'Privacy policy',
              date: 'Last updated 1 August 2026',
              back: '',
              foot: 'Questions? Write to help@amplifycoaching.com.',
            },
            [
              ['What we collect', 'Your name, email and course progress.'],
              ['How we use it', 'To run your courses and send receipts.'],
            ],
          ),
        ],
        { group: 'Account & legal' },
      ),
    ],
  };
  const draft = structuredClone(live);
  const hero = draft.pages[0]!.sections[0]!;
  hero.txt.title = 'Draft: a brand-new homepage';
  draft.theme.announcementText = 'Draft announcement — not live yet.';
  return builderState(live, draft, ['preview-demo-token']);
}

/** Northwind published the starter site with the "Powered by" credit switched off (it's on a white-label plan). */
export function northwindSite(): BuilderState {
  const live = starter('Northwind Yoga');
  live.footer.opt.powered = false;
  // Its cookie banner is on (privacy seed): these wait for consent (e2e/consent.spec.ts, docs/consent.md).
  live.settings.headCode = [
    '<meta name="northwind-verification" content="nw-1">',
    '<script data-consent="analytics">window.__northwindAnalytics = true;</script>',
    '<script>window.__northwindPixel = true; document.cookie = "_fbp=fb.1.test; path=/";</script>',
  ].join('\n');
  return builderState(live);
}

/** Hideout is still building its site: the starter, locked behind a site password. */
export function hideoutSite(): BuilderState {
  const live = starter('Hideout Studio');
  live.settings.siteLock = true;
  live.settings.sitePassword = 'letmein';
  return builderState(live, structuredClone(live), ['hideout-preview']);
}
