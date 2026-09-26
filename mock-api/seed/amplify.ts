/** Seed for "Amplify Coaching" — the tenant the design is drawn with. Copy comes from designs/Student Site.dc.html. */
import type { CourseRow, TenantData } from '../lib/records';
import { funnelQuiz, lessonIds, modules, P, Q, V } from './build';

const now = new Date();
const iso = (s: string) => new Date(s).toISOString();

/** Next Thursday, 2pm US Pacific (21:00 UTC during daylight time). */
function nextThursdayAt14() {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + ((4 - d.getUTCDay() + 7) % 7 || 7));
  d.setUTCHours(21, 0, 0, 0);
  return d.toISOString();
}

const standardFaqs = [
  { question: 'How long do I have access?', answer: 'Forever. One payment covers the course, every worksheet and all future updates.' },
  {
    question: 'Is the course live or self-paced?',
    answer: 'Self-paced. Live Q&A sessions run weekly and recordings are posted to the community.',
  },
  { question: 'What if it isn’t for me?', answer: 'Email us within 30 days for a full refund — no questions, no forms.' },
];

const course = (c: Omit<CourseRow, 'faqs' | 'publishedAt' | 'updatedAt' | 'featured'> & { featured?: boolean }): CourseRow => ({
  featured: false,
  faqs: standardFaqs,
  publishedAt: iso('2025-11-03T09:00:00Z'),
  updatedAt: iso('2026-08-20T09:00:00Z'),
  ...c,
});

const courses: CourseRow[] = [
  course({
    id: 'crs_f',
    slug: 'the-funnel-blueprint',
    title: 'The Funnel Blueprint',
    categorySlug: 'marketing',
    coverColor: 'oklch(0.55 0.17 275)',
    level: 'intermediate',
    price: 24900,
    rating: 4.9,
    reviewCount: 128,
    studentCount: 486,
    durationMinutes: 400,
    featured: true,
    excerpt:
      'Build a complete sales funnel from cold traffic to paying student — offer, landing page, emails and launch, with worksheets at every step.',
    description:
      'Build a complete sales funnel from cold traffic to paying student — offer, landing page, emails and launch, with worksheets at every step.',
    outcomes: [
      'Map a funnel that fits your offer',
      'Write a landing page that converts',
      'Price with confidence',
      'Set up a launch email sequence',
      'Read your funnel analytics',
      'Fix the step that leaks',
    ],
    requirements: [
      'A product or service you want to sell — an idea is enough',
      'A free account with any email tool — templates provided',
      '2–3 hours a week while the course runs',
    ],
    audience: [
      'Coaches and consultants launching a first course',
      'Creators with an audience but no funnel',
      'Anyone whose landing page isn’t converting',
    ],
    modules: modules('f', [
      [
        'Module 1 · Foundations',
        [
          V('Welcome & how this course works', '4:12'),
          V('The anatomy of a funnel', '16:40'),
          P('Funnel mapping worksheet'),
          Q('Foundations check', funnelQuiz()),
        ],
      ],
      [
        'Module 2 · Your offer',
        [V('Positioning your offer', '21:08'), V('Pricing psychology', '18:33'), Q('Offer clarity quiz', funnelQuiz())],
      ],
      [
        'Module 3 · Landing pages',
        [V('Writing your landing page', '24:51'), V('Design that converts', '19:14'), P('Swipe file: 12 high-converting pages')],
      ],
      [
        'Module 4 · Launch & optimize',
        [
          V('Your launch sequence', '22:47'),
          V('Reading your analytics', '15:22'),
          V('Fixing the leaks', '13:05'),
          Q('Final assessment', funnelQuiz()),
        ],
      ],
    ]),
  }),
  course({
    id: 'crs_e',
    slug: 'email-marketing-mastery',
    title: 'Email Marketing Mastery',
    categorySlug: 'marketing',
    coverColor: 'oklch(0.52 0.13 240)',
    level: 'beginner',
    price: 19900,
    rating: 4.8,
    reviewCount: 84,
    studentCount: 342,
    durationMinutes: 490,
    excerpt: 'Turn a small list into steady revenue with welcome sequences, weekly sends and automations that run while you sleep.',
    description: 'Turn a small list into steady revenue with welcome sequences, weekly sends and automations that run while you sleep.',
    outcomes: [
      'Write a welcome sequence that sells',
      'Plan a weekly send you can sustain',
      'Segment without overcomplicating',
      'Automate re-engagement',
      'Improve deliverability',
      'Measure what matters',
    ],
    requirements: ['An email tool of any kind — free plans work', 'Something to offer: a course, service or product'],
    audience: ['Creators with a list they rarely email', 'Coaches who want sales without social media'],
    modules: modules('e', [
      [
        'Module 1 · List foundations',
        [V('Why email still wins', '9:02'), V('Your lead magnet', '17:26'), V('Landing your first 100 subscribers', '14:11')],
      ],
      ['Module 2 · Sequences', [V('The welcome sequence', '22:40'), P('Sequence templates'), Q('Sequence check', funnelQuiz())]],
      [
        'Module 3 · Automation',
        [V('Abandoned checkout flows', '18:52'), V('Re-engagement campaigns', '16:20'), Q('Automation quiz', funnelQuiz())],
      ],
    ]),
  }),
  course({
    id: 'crs_b',
    slug: 'brand-storytelling-lab',
    title: 'Brand Storytelling Lab',
    categorySlug: 'branding',
    coverColor: 'oklch(0.52 0.15 300)',
    level: 'beginner',
    price: 17900,
    rating: 4.7,
    reviewCount: 61,
    studentCount: 268,
    durationMinutes: 320,
    excerpt: 'Find the story only you can tell and use it consistently across your site, emails and social presence.',
    description: 'Find the story only you can tell and use it consistently across your site, emails and social presence.',
    outcomes: [
      'Define your origin story',
      'Build a message hierarchy',
      'Write your about page',
      'Keep voice consistent',
      'Story-driven social posts',
      'Pitch yourself for podcasts',
    ],
    requirements: ['No writing experience needed', 'About two hours a week'],
    audience: ['Founders whose brand feels generic', 'Coaches rewriting their about page'],
    modules: modules('b', [
      ['Module 1 · Your story', [V('Story beats formula', '12:30'), V('Finding your angle', '15:44'), P('Story worksheet')]],
      [
        'Module 2 · Message hierarchy',
        [V('One message, many formats', '14:02'), V('Voice and tone rules', '11:37'), Q('Message check', funnelQuiz())],
      ],
      ['Module 3 · Publishing', [V('Your about page', '13:25'), V('Story-driven emails', '12:48'), V('Wrap-up & next steps', '6:10')]],
    ]),
  }),
  course({
    id: 'crs_c',
    slug: 'client-acquisition-sprint',
    title: 'Client Acquisition Sprint',
    categorySlug: 'sales',
    coverColor: 'oklch(0.68 0.13 210)',
    level: 'intermediate',
    price: 14900,
    rating: 4.8,
    reviewCount: 39,
    studentCount: 121,
    durationMinutes: 270,
    excerpt: 'A two-week sprint to land your next three clients: outreach scripts, discovery calls and proposals that close.',
    description: 'A two-week sprint to land your next three clients: outreach scripts, discovery calls and proposals that close.',
    outcomes: [
      'Build a 50-lead list',
      'Outreach that gets replies',
      'Run a discovery call',
      'Write a one-page proposal',
      'Handle objections',
      'Follow up without nagging',
    ],
    requirements: ['A service you can sell today', 'Two focused weeks'],
    audience: ['Consultants with an empty pipeline', 'Coaches moving from referrals to outreach'],
    modules: modules('c', [
      ['Module 1 · Pipeline', [V('Sprint kickoff', '8:15'), V('Building your lead list', '16:30'), P('Outreach scripts')]],
      ['Module 2 · Closing', [V('Discovery calls', '19:40'), V('Proposals that close', '14:55'), Q('Sprint check', funnelQuiz())]],
    ]),
  }),
  course({
    id: 'crs_p',
    slug: 'podcast-launchpad',
    title: 'Podcast Launchpad',
    categorySlug: 'content',
    coverColor: 'oklch(0.72 0.13 75)',
    level: 'beginner',
    price: 12900,
    rating: 4.6,
    reviewCount: 22,
    studentCount: 67,
    durationMinutes: 230,
    excerpt: 'Plan, record and launch a podcast that feeds your course business — on a realistic weekly schedule.',
    description: 'Plan, record and launch a podcast that feeds your course business — on a realistic weekly schedule.',
    outcomes: [
      'Pick a format you can sustain',
      'Record with gear you own',
      'Edit in under an hour',
      'Launch with 3 episodes',
      'Grow through guesting',
      'Repurpose into email & social',
    ],
    requirements: ['A laptop and a USB microphone (or your phone)'],
    audience: ['Coaches who explain better out loud', 'Course creators looking for a top-of-funnel channel'],
    modules: modules('p', [
      ['Module 1 · Plan', [V('Show positioning', '11:20'), V('Episode formats', '13:05'), P('Launch checklist')]],
      ['Module 2 · Ship', [V('Recording & editing', '21:15'), V('Launch week', '12:40'), Q('Launch quiz', funnelQuiz())]],
    ]),
  }),
  course({
    id: 'crs_w',
    slug: 'pricing-with-confidence',
    title: 'Pricing with Confidence',
    categorySlug: 'sales',
    coverColor: 'oklch(0.5 0.1 180)',
    level: 'all_levels',
    price: 9900,
    rating: 4.7,
    reviewCount: 18,
    studentCount: 54,
    durationMinutes: 160,
    excerpt: 'Stop guessing at prices. A short, practical course on value-based pricing for coaches and creators.',
    description: 'Stop guessing at prices. A short, practical course on value-based pricing for coaches and creators.',
    outcomes: [
      'Price from value, not hours',
      'Present three tiers',
      'Raise prices with existing clients',
      'Handle "too expensive"',
      'Discount without eroding trust',
      'Test a price change safely',
    ],
    requirements: ['An offer with a current price'],
    audience: ['Anyone who dreads the pricing conversation'],
    modules: modules('w', [
      [
        'Module 1 · Foundations',
        [V('Why hourly pricing fails', '10:05'), V('Value conversations', '15:30'), Q('Pricing check', funnelQuiz())],
      ],
      ['Module 2 · In practice', [V('Three-tier offers', '13:20'), V('Raising your rates', '11:45'), P('Pricing scripts')]],
    ]),
  }),
];

const byId = Object.fromEntries(courses.map((c) => [c.id, c]));
const ids = (key: string) => lessonIds(byId[`crs_${key}`]!.modules);

const JORDAN = 'usr_jordan';

export function amplify(): TenantData {
  const eDone = ids('e').slice(0, 4);
  return {
    resolution: { tenant: 'amplify', primaryHost: 'amplify.localhost', status: 'active', indexable: true },
    site: {
      slug: 'amplify',
      name: 'Amplify Coaching',
      legalName: 'Amplify Coaching',
      tagline: 'Practical marketing courses from coaches who’ve done it themselves.',
      logoUrl: null,
      whiteLabel: false,
      brand: { hue: 275, chroma: 0.2 },
      locale: 'en-US',
      currency: 'USD',
      primaryHost: 'amplify.localhost',
      supportEmail: 'help@amplifycoaching.com',
      social: [
        { network: 'linkedin', url: 'https://www.linkedin.com/company/amplify-coaching' },
        { network: 'instagram', url: 'https://www.instagram.com/amplifycoaching' },
        { network: 'youtube', url: 'https://www.youtube.com/@amplifycoaching' },
      ],
      seo: {
        title: 'Amplify Coaching — Marketing courses that grow your business',
        description:
          'Practical marketing courses from coaches who have done it themselves. Funnels, email, branding and sales — learn at your pace, keep lifetime access.',
        indexable: true,
        ogImageUrl: null,
        twitterHandle: null,
      },
      authPitch: {
        title: 'Marketing skills that grow your business',
        bullets: ['6 courses · quizzes, worksheets & certificates', 'Weekly live Q&A with Maya', 'Community of 1,284 students'],
        quote: {
          text: 'First $1k week since joining. The pricing lesson paid for the course forty times over.',
          author: 'Priya Nair · student',
          rating: 5,
        },
      },
      oauthProviders: ['google'],
      features: { membership: true, community: true, certificates: true, streaks: true },
    },
    instructor: {
      name: 'Maya Reyes',
      initials: 'MR',
      color: 'oklch(0.52 0.16 275)',
      role: 'Founder, Amplify Coaching',
      bio: 'Ten years building funnels for coaches and creators — now distilled into courses with worksheets, live Q&A every week, and a community that answers fast.',
      studentCount: 1284,
    },
    categories: [
      { slug: 'marketing', name: 'Marketing', color: 'oklch(0.55 0.17 275)' },
      { slug: 'branding', name: 'Branding', color: 'oklch(0.52 0.15 300)' },
      { slug: 'sales', name: 'Sales', color: 'oklch(0.52 0.13 240)' },
      { slug: 'content', name: 'Content', color: 'oklch(0.72 0.13 75)' },
    ],
    courses,
    orderBump: {
      title: 'Add the Swipe File Vault',
      description: '120+ proven emails, landing pages and ads. One-time offer at checkout.',
      price: 2900,
    },
    orderPrefix: 'AMP',
    bundles: [
      {
        slug: 'funnel-email-bundle',
        title: 'Funnel Blueprint + Email Mastery',
        description: 'Our two flagship courses together — build the funnel, then fill it with email.',
        courseSlugs: ['the-funnel-blueprint', 'email-marketing-mastery'],
        price: 39900,
      },
    ],
    membership: {
      title: 'Membership',
      subtitle: 'Every course, the community and weekly live Q&A — one subscription. Cancel anytime.',
      annualDiscountPercent: 20,
      guaranteeDays: 30,
      plans: [
        {
          id: 'plan_starter',
          name: 'Starter',
          summary: '2 starter courses + community',
          features: ['2 starter courses', 'Community access', 'Monthly group call'],
          popular: false,
          monthly: 2900,
        },
        {
          id: 'plan_pro',
          name: 'Pro',
          summary: 'All 6 courses + live Q&A + certificates',
          features: ['All 6 courses', 'Weekly live Q&A', 'Certificates & worksheets', 'Community access'],
          popular: true,
          monthly: 5900,
        },
        {
          id: 'plan_inner',
          name: 'Inner Circle',
          summary: 'Everything + monthly 1:1 coaching call',
          features: ['Everything in Pro', 'Monthly 1:1 coaching call', 'Landing page reviews'],
          popular: false,
          monthly: 14900,
        },
      ],
      comparison: [
        { label: 'Courses included', values: ['2 starter', 'All 6', 'All 6'] },
        { label: 'Community access', values: [true, true, true] },
        { label: 'Weekly live Q&A', values: [false, true, true] },
        { label: 'Certificates', values: [false, true, true] },
        { label: 'Worksheets & templates', values: [false, true, true] },
        { label: 'Monthly 1:1 coaching call', values: [false, false, true] },
        { label: 'Landing page reviews', values: [false, false, true] },
      ],
      testimonial: {
        quote: 'Pro paid for itself in the first month — the weekly Q&A alone is worth it. I stopped buying courses one at a time.',
        author: 'Tom Okafor',
        context: 'Pro member since March',
        initials: 'TO',
        color: 'oklch(0.52 0.12 240)',
        rating: 5,
      },
      faqs: [
        {
          question: 'Can I switch or cancel anytime?',
          answer:
            'Yes. Upgrade, downgrade or cancel in two clicks from your account. Changes prorate automatically and cancelling never deletes your progress or certificates.',
        },
        {
          question: 'Do I keep access to courses I finished?',
          answer:
            'While your membership is active you have access to everything. If you cancel, certificates you earned stay valid and downloadable forever.',
        },
        {
          question: 'How is this different from buying a course?',
          answer:
            'Buying a course is one-time with lifetime access. Membership covers all six courses plus the live Q&A and community for as long as you subscribe — cheaper if you plan to take two or more.',
        },
        {
          question: 'Is there a free trial?',
          answer: 'No trial, but every plan has a 30-day money-back guarantee — full refund, no questions, no forms.',
        },
      ],
    },
    home: {
      hero: {
        eyebrow: 'Trusted by 1,284 students',
        title: 'Marketing skills that grow your business',
        subtitle: 'Practical courses from coaches who have done it themselves. Learn at your pace, keep lifetime access.',
      },
      instructorVideo: { title: 'Welcome to Amplify Coaching', durationSeconds: 124 },
      testimonials: [
        {
          quote:
            'I doubled my landing page conversion within a month of finishing Module 3. Every lesson ends with something you actually go do.',
          rating: 5,
          name: 'Priya Nair',
          color: 'oklch(0.52 0.16 275)',
          courseSlug: 'the-funnel-blueprint',
        },
        {
          quote: 'The quizzes keep you honest, and questions in the community get answered fast — usually by Maya herself.',
          rating: 5,
          name: 'Tom Okafor',
          color: 'oklch(0.52 0.12 240)',
          courseSlug: 'email-marketing-mastery',
        },
        {
          quote: 'Worth it for the templates alone. I studied on my commute and still finished with the certificate.',
          rating: 5,
          name: 'Lena Fischer',
          color: 'oklch(0.52 0.13 300)',
          courseSlug: 'brand-storytelling-lab',
        },
      ],
      valueProps: [
        { icon: 'check', title: '30-day guarantee', body: 'Full refund inside 30 days if a course isn’t right for you.' },
        { icon: 'infinity', title: 'Lifetime access', body: 'Pay once and keep every lesson, worksheet and future update.' },
        { icon: 'sparkle', title: 'Verified certificates', body: 'Finish a course and share a credential anyone can verify.' },
      ],
      newsletter: {
        title: 'Get one free lesson every Friday',
        body: 'A full lesson from one of the courses, in your inbox. Unsubscribe anytime.',
      },
      membership: { title: 'Or join the membership', subtitle: 'Every course, the community and weekly live Q&A — one subscription.' },
    },
    help: [
      {
        title: 'Getting started',
        articles: ['Create your account', 'Buy a course or join membership', 'Watch lessons on any device', 'Reset your password'],
      },
      {
        title: 'Courses & progress',
        articles: ['Resume where you left off', 'Retake a quiz', 'Download lesson resources', 'How progress is tracked'],
      },
      { title: 'Billing & receipts', articles: ['Find your invoice', 'Update your card', 'Apply a coupon', 'Payment plans explained'] },
      { title: 'Membership', articles: ['Switch plans', 'Cancel membership', 'What happens after cancelling'] },
      { title: 'Certificates', articles: ['Download your certificate', 'Verify a credential', 'Fix a name spelling'] },
      { title: 'Community', articles: ['Post in the right space', 'Community guidelines', 'Report a post'] },
    ],
    legal: {
      refund: {
        title: 'Refund policy',
        updatedAt: iso('2026-08-01T00:00:00Z'),
        intro: '',
        sections: [
          {
            heading: 'Courses — 30 days, no questions',
            body: 'Every one-time course purchase carries a 30-day money-back guarantee. Email us or open a support ticket within 30 days of purchase and we refund the full amount to your original payment method — no forms, no calls, no conditions on how much of the course you watched.',
          },
          {
            heading: 'Memberships',
            body: 'Your first membership payment is covered by the same 30-day guarantee. After that, cancelling stops future renewals immediately; we don’t refund partial months, but you keep access until the end of the paid period. Certificates you earned remain valid and downloadable after cancelling.',
          },
          {
            heading: 'Digital downloads & bundles',
            body: 'Downloads bought on their own are refundable within 30 days. Bundles are refunded in full if requested within 30 days; partial bundle refunds aren’t available.',
          },
          {
            heading: 'How refunds are paid',
            body: 'Refunds go back to the original card or PayPal account and usually appear within 5–10 business days depending on your bank. You’ll get an email confirmation the moment it’s issued.',
          },
        ],
      },
      privacy: {
        title: 'Privacy policy',
        updatedAt: iso('2026-08-01T00:00:00Z'),
        intro: '',
        sections: [
          {
            heading: 'What we collect',
            body: 'Your name and email when you create an account; payment details (handled by Stripe or PayPal — card numbers never touch our servers); course progress, quiz results and notes so learning syncs across devices; and community posts you choose to publish.',
          },
          {
            heading: 'How we use it',
            body: 'To run your account, deliver courses, issue certificates, and send the emails you’ve opted into — lesson updates, community replies and live-session reminders, each with its own toggle in your profile. We never sell your data or share it with advertisers.',
          },
          {
            heading: 'Who can see it',
            body: 'Your name, photo and bio appear on your community profile and posts. Your progress, purchases and notes are private to you and this school’s staff. We use a small set of processors (payments, video hosting, email delivery) bound by data-processing agreements.',
          },
          {
            heading: 'Your rights',
            body: 'Export a copy of your data from your profile at any time, correct anything that’s wrong, or ask us to delete your account entirely — deletion completes within 30 days. Questions go to privacy@amplifycoaching.com.',
          },
          {
            heading: 'Cookies',
            body: 'We use essential cookies to keep you signed in and anonymous analytics to see which lessons need improving. No cross-site tracking.',
          },
        ],
      },
      terms: {
        title: 'Terms of service',
        updatedAt: iso('2026-08-01T00:00:00Z'),
        intro: '',
        sections: [
          {
            heading: 'Your account',
            body: 'You need an account to enroll. Keep your password to yourself — accounts are personal and can’t be shared or resold. You must be 16 or older, or have a guardian’s consent.',
          },
          {
            heading: 'Purchases & access',
            body: 'One-time course purchases include lifetime access to that course and its future updates. Memberships renew automatically until cancelled and cover the content listed on the plan while active. Payment plans are a purchase commitment: all instalments are owed even if you finish early. Refunds follow our 30-day refund policy.',
          },
          {
            heading: 'Content & licence',
            body: 'Courses, worksheets and recordings are for your personal use. You may not re-share, resell, or republish them. Anything you post in the community stays yours — you grant us a licence to display it inside this school.',
          },
          {
            heading: 'Community conduct',
            body: 'Be kind, no spam or self-promotion, no harassment. We may remove posts or suspend accounts that break these rules, with a warning where reasonable.',
          },
          {
            heading: 'No guarantees & liability',
            body: 'Courses teach what worked for us and our students; results depend on your execution and we can’t promise revenue outcomes. The service is provided as-is, and our liability is capped at the amount you paid in the last 12 months.',
          },
          {
            heading: 'Changes',
            body: 'We may update these terms; material changes are announced by email 14 days in advance. Continuing to use the service after that means you accept the new terms.',
          },
        ],
      },
    },
    footerSocial: ['linkedin', 'instagram', 'youtube'],
    users: [
      {
        id: JORDAN,
        name: 'Jordan Tate',
        email: 'jordan.tate@gmail.com',
        password: 'password',
        color: 'oklch(0.52 0.13 240)',
        bio: '',
        timezone: 'America/Los_Angeles',
        website: '',
        createdAt: iso('2026-01-20T10:00:00Z'),
        preferences: { newLessons: true, communityReplies: true, liveReminders: false },
        card: { brand: 'Visa', last4: '4242', expMonth: 4, expYear: 2028 },
        weeklyGoal: 5,
        streakDays: 12,
        weekActivity: [1, 2, 0, 1, 2, 0, 1],
        membershipPlanId: null,
        membershipRenewsAt: null,
      },
    ],
    enrollments: [
      { userId: JORDAN, courseId: 'crs_f', enrolledAt: iso('2026-02-04T12:00:00Z'), orderId: 'ord_1001' },
      { userId: JORDAN, courseId: 'crs_e', enrolledAt: iso('2026-04-18T12:00:00Z'), orderId: 'ord_1002' },
      { userId: JORDAN, courseId: 'crs_b', enrolledAt: iso('2026-06-02T12:00:00Z'), orderId: 'ord_1003' },
    ],
    completions: [...ids('f'), ...eDone, ...ids('b')].map((lessonId) => ({ userId: JORDAN, lessonId, at: iso('2026-08-10T12:00:00Z') })),
    notes: [],
    quizAttempts: [],
    lessonQuestions: [
      {
        id: 'lq_1',
        lessonId: '*',
        userId: null,
        name: 'Maya Reyes',
        color: 'oklch(0.52 0.12 240)',
        isCoach: true,
        body: 'Yes — the sequencing is identical. Swap the channel in the module worksheet and keep the same cadence.',
        createdAt: new Date(now.getTime() - 3 * 86_400_000).toISOString(),
      },
      {
        id: 'lq_0',
        lessonId: '*',
        userId: null,
        name: 'Priya Nair',
        color: 'oklch(0.52 0.16 275)',
        isCoach: false,
        body: 'Does this still apply if my audience lives mostly on LinkedIn rather than email?',
        createdAt: new Date(now.getTime() - 3 * 86_400_000 - 3_600_000).toISOString(),
      },
    ],
    reviews: courses.flatMap((c) => [
      {
        id: `rev_${c.id}_1`,
        courseId: c.id,
        userId: null,
        name: 'Priya Nair',
        color: 'oklch(0.52 0.16 275)',
        rating: 5,
        body: 'I rebuilt my whole funnel following module 3 and my landing page conversion doubled. The worksheets alone are worth the price.',
        createdAt: new Date(now.getTime() - 14 * 86_400_000).toISOString(),
      },
      {
        id: `rev_${c.id}_2`,
        courseId: c.id,
        userId: null,
        name: 'Tom Okafor',
        color: 'oklch(0.52 0.12 240)',
        rating: 5,
        body: 'No fluff. Every lesson ends with something to actually do, and the analytics module finally made my numbers make sense.',
        createdAt: new Date(now.getTime() - 32 * 86_400_000).toISOString(),
      },
      {
        id: `rev_${c.id}_3`,
        courseId: c.id,
        userId: null,
        name: 'Lena Fischer',
        color: 'oklch(0.52 0.13 300)',
        rating: 4,
        body: 'Really strong course. I would love more examples for service businesses, but the launch sequence templates were excellent.',
        createdAt: new Date(now.getTime() - 64 * 86_400_000).toISOString(),
      },
    ]),
    wishlist: [
      { userId: JORDAN, courseId: 'crs_p' },
      { userId: JORDAN, courseId: 'crs_w' },
    ],
    carts: [{ owner: JORDAN, courseIds: ['crs_c'] }],
    orders: [
      ['ord_1001', 'AMP-2026-1001', 'crs_f', '2026-02-04T12:00:00Z'],
      ['ord_1002', 'AMP-2026-1002', 'crs_e', '2026-04-18T12:00:00Z'],
      ['ord_1003', 'AMP-2026-1003', 'crs_b', '2026-06-02T12:00:00Z'],
    ].map(([oid, number, cid, at]) => {
      const c = byId[cid!]!;
      return {
        id: oid!,
        number: number!,
        userId: JORDAN,
        createdAt: iso(at!),
        items: [
          {
            kind: 'course' as const,
            refId: c.id,
            title: c.title,
            coverColor: c.coverColor,
            meta: 'lifetime access',
            unitPrice: c.price,
            quantity: 1,
          },
        ],
        subtotal: c.price,
        discount: 0,
        couponCode: null,
        orderBump: 0,
        tax: 0,
        taxRatePercent: 0,
        total: c.price,
        dueToday: c.price,
        plan: null,
        paymentMethod: 'Visa •••• 4242',
        gift: null,
        seats: null,
        billing: { name: 'Jordan Tate', email: 'jordan.tate@gmail.com', country: 'United States' },
        status: 'paid' as const,
      };
    }),
    spaces: [
      { id: 'sp_all', name: 'All posts', group: 'Start here', access: 'public', courseId: null, description: '' },
      { id: 'sp_intro', name: 'Introductions', group: 'Start here', access: 'public', courseId: null, description: '' },
      { id: 'sp_wins', name: 'Wins', group: 'Start here', access: 'members', courseId: null, description: '' },
      { id: 'sp_q', name: 'Questions', group: 'Start here', access: 'members', courseId: null, description: '' },
      { id: 'sp_f', name: 'The Funnel Blueprint', group: 'Course spaces', access: 'course', courseId: 'crs_f', description: '' },
      { id: 'sp_e', name: 'Email Marketing Mastery', group: 'Course spaces', access: 'course', courseId: 'crs_e', description: '' },
      { id: 'sp_b', name: 'Brand Storytelling Lab', group: 'Course spaces', access: 'course', courseId: 'crs_b', description: '' },
      { id: 'sp_w', name: 'Pricing with Confidence', group: 'Course spaces', access: 'course', courseId: 'crs_w', description: '' },
      { id: 'sp_q3', name: 'Q3 Launch Cohort', group: 'Cohorts', access: 'cohort', courseId: null, description: '' },
      { id: 'sp_inner', name: 'Inner Circle', group: 'Cohorts', access: 'paid', courseId: null, description: '' },
    ],
    posts: [
      {
        id: 'post_1',
        spaceId: 'sp_wins',
        userId: null,
        name: 'Maya Reyes',
        color: 'oklch(0.52 0.16 275)',
        isCoach: true,
        body: 'Huge congrats to everyone who finished Module 3 this week — 14 of you! Drop your landing page below and I’ll review the first five.',
        likes: 32,
        replies: 12,
        createdAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
      },
      {
        id: 'post_2',
        spaceId: 'sp_wins',
        userId: null,
        name: 'Priya Nair',
        color: 'oklch(0.52 0.12 240)',
        isCoach: false,
        body: 'First $1k week since joining. The pricing psychology lesson paid for the course roughly forty times over.',
        likes: 41,
        replies: 9,
        createdAt: new Date(now.getTime() - 5 * 3_600_000).toISOString(),
      },
      {
        id: 'post_3',
        spaceId: 'sp_q',
        userId: null,
        name: 'Marcus Webb',
        color: 'oklch(0.52 0.13 300)',
        isCoach: false,
        body: 'For those running webinar funnels — how long is your replay window? 48 hours feels short but scarcity seems to work.',
        likes: 12,
        replies: 7,
        createdAt: new Date(now.getTime() - 26 * 3_600_000).toISOString(),
      },
      {
        id: 'post_4',
        spaceId: 'sp_intro',
        userId: null,
        name: 'Aki Tanaka',
        color: 'oklch(0.5 0.1 180)',
        isCoach: false,
        body: 'Hi all! Fitness coach from Osaka, just enrolled in The Funnel Blueprint. Aiming to launch my first course by October.',
        likes: 18,
        replies: 6,
        createdAt: new Date(now.getTime() - 50 * 3_600_000).toISOString(),
      },
    ],
    likes: [],
    event: { id: 'evt_1', title: 'Live Q&A with Maya', startsAt: nextThursdayAt14(), provider: 'zoom', attendees: 40 },
    rsvps: [],
    leaderboard: [
      { name: 'Priya Nair', points: 940, color: 'oklch(0.52 0.16 275)' },
      { name: 'Jordan Tate', points: 885, color: 'oklch(0.52 0.13 240)' },
      { name: 'Tom Okafor', points: 810, color: 'oklch(0.52 0.13 300)' },
      { name: 'Lena Fischer', points: 705, color: 'oklch(0.5 0.1 180)' },
      { name: 'Marcus Webb', points: 640, color: 'oklch(0.52 0.16 275)' },
    ],
    notifications: [
      ['ntf_1', 'Maya Reyes replied to your post in Wins', '/community', 2],
      ['ntf_2', 'New lesson added to Email Marketing Mastery', '/learning', 24],
      ['ntf_3', 'Live Q&A with Maya — Thursday 2pm', '/community', 48],
    ].map(([nid, text, href, hours]) => ({
      id: nid as string,
      userId: JORDAN,
      text: text as string,
      href: href as string,
      createdAt: new Date(now.getTime() - (hours as number) * 3_600_000).toISOString(),
      readAt: null,
    })),
    certificates: [
      { id: 'AC-2026-0341', userId: JORDAN, courseId: 'crs_f', issuedAt: iso('2026-08-12T12:00:00Z') },
      { id: 'AC-2026-0342', userId: JORDAN, courseId: 'crs_b', issuedAt: iso('2026-08-12T12:00:00Z') },
    ],
    tickets: [],
    newsletter: [],
    passwordResets: [],
  };
}
