import { useTranslations } from 'next-intl';
import { Fragment, type ReactNode } from 'react';
import { CourseCard } from '@/features/catalog/components/CourseCard';
import { CourseCover } from '@/features/catalog/components/CourseCover';
import { LeadForm } from '@/features/forms/components/LeadForm';
import { Link } from '@/i18n/navigation';
import { stars } from '@/lib/format';
import { Markdown } from '@/lib/markdown';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import type {
  BannerSection,
  CompareSection,
  CtaSection,
  FaqSection,
  FeaturedCoursesSection,
  HeroSection,
  InstructorSection,
  LogosSection,
  NewsletterSection,
  QuoteSection,
  Section,
  StatsSection,
  TestimonialsSection,
  TextSection,
  TopicsSection,
  ValuePropsSection,
  VideoSection,
} from '../types';
import { BuilderForm } from './BuilderForm';
import { MembershipPlans } from './MembershipPlans';
import { NewsletterForm } from './NewsletterForm';
import { SiteLink } from './SiteLink';
import { VideoEmbed } from './VideoEmbed';
import styles from './Sections.module.css';

/** Kinds drawn as a rounded box in the section's colour (the canvas's `data-boxed`). */
const BOXED = new Set<Section['kind']>(['testimonials', 'cta', 'banner', 'newsletter']);
const GLYPHS = ['✓', '∞', '✦', '★', '◆', '●'];

/**
 * Renders a page's site-builder sections in order, each in its frame. Unknown kinds are skipped, so new kinds can
 * ship in the API first. The page's first hero carries the `<h1>`; a page without one gets a visually hidden title
 * (`title`). Works on the server (cached pages) and in the browser (password / members-only pages).
 */
export function Sections({ sections, title }: { sections: Section[]; title: string }) {
  const h1Hero = sections.find((s) => s.kind === 'hero')?.id;
  return (
    <>
      {!h1Hero && <h1 className="sr-only">{title}</h1>}
      {sections.map((s) => (
        <Fragment key={s.id}>{renderSection(s, s.id === h1Hero)}</Fragment>
      ))}
    </>
  );
}

function renderSection(s: Section, h1: boolean): ReactNode {
  switch (s.kind) {
    case 'hero':
      return <Hero s={s} h1={h1} />;
    case 'featured_courses':
      return <Featured s={s} />;
    case 'topics':
      return <Topics s={s} />;
    case 'instructor':
      return <Instructor s={s} />;
    case 'membership_plans':
      return (
        <Frame s={s} labelled={s.title !== ''}>
          <MembershipPlans s={s} headingId={headingId(s)} />
        </Frame>
      );
    case 'testimonials':
      return <Testimonials s={s} />;
    case 'value_props':
      return <ValueProps s={s} />;
    case 'newsletter':
      return <Newsletter s={s} />;
    case 'text':
      return <Text s={s} />;
    case 'stats':
      return <Stats s={s} />;
    case 'faq':
      return <Faq s={s} />;
    case 'logos':
      return <Logos s={s} />;
    case 'video':
      return <VideoBlock s={s} />;
    case 'cta':
      return <Cta s={s} />;
    case 'banner':
      return <Banner s={s} />;
    case 'form':
      return (
        <Frame s={s} labelled={s.title !== ''}>
          <BuilderForm s={s} headingId={headingId(s)} />
        </Frame>
      );
    case 'lead_form':
      // The lead form labels itself with its heading (an id of its own), so the frame isn't labelled here.
      return s.formId === '' ? null : (
        <Frame s={s}>
          <LeadForm formId={s.formId} variant="section" align={s.style.align} heading={{ title: s.title, subtitle: s.subtitle }} />
        </Frame>
      );
    case 'compare':
      return <Compare s={s} />;
    case 'quote':
      return <Quote s={s} />;
    default:
      return null;
  }
}

const headingId = (s: Section) => `${s.id}-title`;
const onColour = (s: Section) => s.style.bg === 'brand' || s.style.bg === 'dark';

/** The common frame: anchor, background, spacing, alignment, width, divider, per-device visibility, animation. */
function Frame({ s, labelled = false, children }: { s: Section; labelled?: boolean; children: ReactNode }) {
  return (
    <section
      id={s.anchor ?? undefined}
      className={styles.frame}
      data-kind={s.kind}
      data-bg={s.style.bg}
      data-pad={s.style.pad}
      data-align={s.style.align}
      data-width={s.style.width}
      data-divider={s.style.divider || undefined}
      data-boxed={BOXED.has(s.kind) || undefined}
      data-hide-desktop={!s.visibility.desktop || undefined}
      data-hide-mobile={!s.visibility.mobile || undefined}
      data-anim={s.animation ?? undefined}
      aria-labelledby={labelled ? headingId(s) : undefined}
    >
      <div className="container">{children}</div>
    </section>
  );
}

/** Primary button that stays readable on brand / dark bands. */
const primaryBtn = (s: Section, size = 'btn-lg') => `btn ${size} ${onColour(s) ? styles.btnOnColour : 'btn-primary'}`;

function Hero({ s, h1 }: { s: HeroSection; h1: boolean }) {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const tp = useTranslations('pages');
  const f = useFormat();
  const H = h1 ? 'h1' : 'h2';
  const side = s.compact ? 'none' : s.side;
  const c = side === 'card' ? s.spotlight : null;
  return (
    <Frame s={s} labelled>
      <div className={styles.heroGrid} data-side={side}>
        <div>
          {s.eyebrow !== '' && <span className={styles.eyebrowPill}>{s.eyebrow}</span>}
          <H id={headingId(s)} className={`display ${styles.heroTitle} ${styles.heading}`} data-compact={s.compact || undefined}>
            {s.title}
          </H>
          {s.subtitle !== '' && (
            <p className={styles.heroSub} data-compact={s.compact || undefined}>
              {s.subtitle}
            </p>
          )}
          <div className={styles.ctas}>
            <SiteLink href={s.primaryCta.href} className={primaryBtn(s)}>
              {s.primaryCta.label}
            </SiteLink>
            {s.secondaryCta && (
              <SiteLink href={s.secondaryCta.href} className="btn btn-outline btn-lg">
                {s.secondaryCta.label}
              </SiteLink>
            )}
          </div>
          {s.stats.length > 0 && (
            <dl className={styles.stats}>
              {s.stats.map((st, i) => (
                <div key={i}>
                  <dt>{st.label}</dt>
                  <dd className="num">{st.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {c && (
          <article className={styles.spotlight}>
            <p className="eyebrow">{t('mostPopular')}</p>
            <CourseCover cover={c.cover} height={130} radius={12} priority className={styles.spotCover}>
              <span className={styles.spotChip}>
                {tc('lessons', { count: c.lessonCount })} · {f.duration(c.durationMinutes)}
              </span>
            </CourseCover>
            <h2 className={styles.spotTitle}>{c.title}</h2>
            <p className={styles.spotMeta}>
              {/* No reviews yet: no empty stars and "0.0" (the canvas draws the card the same way). */}
              {c.reviewCount > 0 && (
                <>
                  <span className="stars" aria-hidden="true">
                    {stars(c.rating)}
                  </span>
                  <span className="sr-only">{tc('ratingLabel', { rating: c.rating })}</span>
                  <span aria-hidden="true">{c.rating.toFixed(1)}</span> ·{' '}
                </>
              )}
              {tc('students', { count: c.studentCount })}
            </p>
            <div className={styles.spotFoot}>
              <span className={`num ${styles.spotPrice}`}>{f.coursePrice(c.price, c.pricing)}</span>
              <Link href={routes.course(c.slug)} className={styles.spotLink} aria-label={t('viewCourseNamed', { title: c.title })}>
                {t('viewCourse')}
              </Link>
            </div>
          </article>
        )}
        {side === 'video' && s.video && <VideoEmbed video={s.video} title={tp('heroVideo', { title: s.title })} />}
      </div>
    </Frame>
  );
}

function Featured({ s }: { s: FeaturedCoursesSection }) {
  return (
    <Frame s={s} labelled>
      <div className={styles.head}>
        <h2 id={headingId(s)} className={`h2-lg ${styles.heading}`}>
          {s.title}
        </h2>
        {s.link && (
          <SiteLink href={s.link.href} className={styles.headLink}>
            {s.link.label}
          </SiteLink>
        )}
      </div>
      <ul className={`grid-3 ${styles.gridTop}`} data-variant={s.variant}>
        {s.courses.map((c) => (
          <li key={c.id}>
            <CourseCard course={c} variant="featured" showPrice={s.showPrice} showRating={s.showRating} />
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function Topics({ s }: { s: TopicsSection }) {
  const tc = useTranslations('common');
  return (
    <Frame s={s} labelled>
      <h2 id={headingId(s)} className={`h2 ${styles.heading}`}>
        {s.title}
      </h2>
      <ul className={styles.topics}>
        {s.categories.map((cat) => (
          <li key={cat.slug}>
            <Link href={routes.category(cat.slug)} className={styles.topic}>
              <span className={styles.topicDot} style={{ background: cat.color }} aria-hidden="true" />
              <span className={styles.topicName}>{cat.name}</span>
              <span className={styles.topicCount}>{tc('courses', { count: cat.courseCount })}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function Instructor({ s }: { s: InstructorSection }) {
  const t = useTranslations('home');
  const tp = useTranslations('pages');
  const f = useFormat();
  const p = s.instructor;
  const v = s.video;
  return (
    <Frame s={s} labelled>
      <div className={styles.instructor} data-video={v !== null}>
        {v && (
          <VideoEmbed
            video={v}
            title={v.title !== '' ? v.title : tp('instructorVideo', { name: p.name })}
            caption={v.title !== '' ? [v.title, v.durationSeconds > 0 ? f.clock(v.durationSeconds) : ''].filter(Boolean).join(' · ') : ''}
          />
        )}
        <div>
          {s.eyebrow !== '' && <p className={styles.eyebrow}>{s.eyebrow}</p>}
          <h2 id={headingId(s)} className={`h2 ${styles.instructorTitle} ${styles.heading}`}>
            {s.title !== '' ? s.title : p.name}
          </h2>
          <div className={styles.person}>
            <span
              className="avatar"
              style={{ width: 52, height: 52, fontSize: 17, fontWeight: 800, background: p.color }}
              aria-hidden="true"
            >
              {p.initials}
            </span>
            <div>
              <p className={styles.personName}>{p.name}</p>
              {p.role !== '' && <p className={styles.personRole}>{p.role}</p>}
            </div>
          </div>
          {p.bio !== '' && <Markdown source={p.bio} breaks images={false} headingLevel={3} className={`rich-text ${styles.bio}`} />}
          {s.stats.length > 0 && (
            <dl className={`${styles.stats} ${styles.statsSm}`} aria-label={t('instructorStats')}>
              {s.stats.map((st, i) => (
                <div key={i}>
                  <dt>{st.label}</dt>
                  <dd className="num">{st.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </Frame>
  );
}

function Testimonials({ s }: { s: TestimonialsSection }) {
  const tc = useTranslations('common');
  return (
    <Frame s={s} labelled>
      <div className={styles.box}>
        <h2 id={headingId(s)} className={`h2 ${styles.heading}`} style={{ textAlign: 'center' }}>
          {s.title}
        </h2>
        <ul className={`grid-3 ${styles.gridTop}`}>
          {s.items.map((q, i) => (
            <li key={i} className={styles.quote}>
              <figure>
                {q.rating !== null && (
                  <p className={`stars ${styles.quoteStars}`} role="img" aria-label={tc('ratingLabel', { rating: q.rating })}>
                    {stars(q.rating)}
                  </p>
                )}
                <blockquote>
                  <p>{q.quote}</p>
                </blockquote>
                <figcaption className={styles.quoteBy}>
                  <span className="avatar" style={{ width: 32, height: 32, fontSize: 11.5, background: q.author.color }} aria-hidden="true">
                    {q.author.initials}
                  </span>
                  <span>
                    <strong>{q.author.name}</strong>
                    {q.context !== '' && <span>{q.context}</span>}
                  </span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

function ValueProps({ s }: { s: ValuePropsSection }) {
  const titled = s.title !== '';
  const H = titled ? 'h3' : 'h2';
  return (
    <Frame s={s} labelled={titled}>
      {titled && (
        <h2 id={headingId(s)} className={`h2 ${styles.heading} ${styles.headingGap}`}>
          {s.title}
        </h2>
      )}
      <ul className="grid-3">
        {s.items.map((v, i) => (
          <li key={i} className={styles.value}>
            <span className={styles.valueIcon} aria-hidden="true">
              {v.glyph !== '' ? v.glyph : GLYPHS[i % GLYPHS.length]}
            </span>
            <div>
              <H className={styles.valueTitle}>{v.title}</H>
              {v.body !== '' && <p>{v.body}</p>}
            </div>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function Newsletter({ s }: { s: NewsletterSection }) {
  return (
    <Frame s={s} labelled={s.title !== ''}>
      <div className={`${styles.box} ${styles.cta}`}>
        {s.title !== '' && (
          <h2 id={headingId(s)} className={`h2 ${styles.heading}`} style={{ fontSize: 28 }}>
            {s.title}
          </h2>
        )}
        {s.body !== '' && <p className={styles.ctaBody}>{s.body}</p>}
        <NewsletterForm placeholder={s.placeholder} buttonLabel={s.buttonLabel} onColour={onColour(s)} />
      </div>
    </Frame>
  );
}

function Text({ s }: { s: TextSection }) {
  return (
    <Frame s={s} labelled={s.title !== ''}>
      <div className={styles.text}>
        {s.title !== '' && (
          <h2 id={headingId(s)} className={`h2 ${styles.heading}`}>
            {s.title}
          </h2>
        )}
        {/* The builder's rich text (Markdown); `breaks` keeps older plain text's line breaks. */}
        {s.body !== '' && (
          <Markdown
            source={s.body}
            breaks
            images={false}
            headingLevel={s.title !== '' ? 3 : 2}
            className={`rich-text ${styles.textBody}`}
          />
        )}
      </div>
    </Frame>
  );
}

function Stats({ s }: { s: StatsSection }) {
  return (
    <Frame s={s}>
      <dl className={styles.statsBand}>
        {s.items.map((st, i) => (
          <div key={i}>
            <dt>{st.label}</dt>
            <dd className="num">{st.value}</dd>
          </div>
        ))}
      </dl>
    </Frame>
  );
}

function Faq({ s }: { s: FaqSection }) {
  return (
    <Frame s={s} labelled={s.title !== ''}>
      {s.title !== '' && (
        <h2 id={headingId(s)} className={`h2 ${styles.heading}`} style={{ textAlign: 'center' }}>
          {s.title}
        </h2>
      )}
      <div className={`accordion ${styles.faq}`}>
        {s.items.map((q, i) => (
          <details key={i} open={i === 0}>
            <summary>{q.question}</summary>
            <Markdown source={q.answer} breaks images={false} headingLevel={3} className="accordion-body rich-text" />
          </details>
        ))}
      </div>
    </Frame>
  );
}

function Logos({ s }: { s: LogosSection }) {
  return (
    <Frame s={s} labelled={s.title !== ''}>
      {s.title !== '' && (
        <h2 id={headingId(s)} className={styles.logosLabel}>
          {s.title}
        </h2>
      )}
      <ul className={styles.logos}>
        {s.items.map((l, i) => (
          <li key={i}>
            {l.imageUrl ? (
              // The school's own logo files (any https host): next/image would need every host allow-listed.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.imageUrl} alt={l.name} loading="lazy" decoding="async" />
            ) : (
              l.name
            )}
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function VideoBlock({ s }: { s: VideoSection }) {
  const tp = useTranslations('pages');
  return (
    <Frame s={s}>
      <VideoEmbed video={s.video} title={s.caption !== '' ? s.caption : tp('video')} wide />
      {s.caption !== '' && <p className={styles.videoNote}>{s.caption}</p>}
    </Frame>
  );
}

function Cta({ s }: { s: CtaSection }) {
  return (
    <Frame s={s} labelled={s.title !== ''}>
      <div className={`${styles.box} ${styles.cta}`}>
        {s.title !== '' && (
          <h2 id={headingId(s)} className={`h2 ${styles.heading}`} style={{ fontSize: 28 }}>
            {s.title}
          </h2>
        )}
        {s.body !== '' && <p className={styles.ctaBody}>{s.body}</p>}
        {s.button && (
          <SiteLink href={s.button.href} className={`${primaryBtn(s)} ${styles.ctaBtn}`}>
            {s.button.label}
          </SiteLink>
        )}
      </div>
    </Frame>
  );
}

function Banner({ s }: { s: BannerSection }) {
  return (
    <Frame s={s}>
      <div className={`${styles.box} ${styles.banner}`}>
        <p className={styles.bannerText}>{s.title}</p>
        {s.button && (
          <SiteLink href={s.button.href} className={primaryBtn(s, 'btn-sm')}>
            {s.button.label}
          </SiteLink>
        )}
      </div>
    </Frame>
  );
}

function Compare({ s }: { s: CompareSection }) {
  const tp = useTranslations('pages');
  const cell = (v: string) => (v === '✓' ? 'yes' : v === '—' ? 'no' : undefined);
  return (
    <Frame s={s} labelled={s.title !== ''}>
      {s.title !== '' && (
        <h2 id={headingId(s)} className={`h2 ${styles.heading}`} style={{ textAlign: 'center' }}>
          {s.title}
        </h2>
      )}
      <div className={styles.compareWrap} tabIndex={0} role="region" aria-label={s.title !== '' ? s.title : tp('compare')}>
        <table className={styles.compare}>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">{tp('feature')}</span>
              </th>
              {s.columns.map((c, i) => (
                <th key={i} scope="col" data-highlight={i === s.highlight || undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r, i) => (
              <tr key={i}>
                <th scope="row">{r.feature}</th>
                {r.values.map((v, j) => (
                  <td key={j} data-cell={cell(v)}>
                    {v === '✓' ? (
                      <>
                        <span aria-hidden="true">✓</span>
                        <span className="sr-only">{tp('included')}</span>
                      </>
                    ) : v === '—' ? (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">{tp('notIncluded')}</span>
                      </>
                    ) : (
                      v
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}

function Quote({ s }: { s: QuoteSection }) {
  return (
    <Frame s={s}>
      <figure className={styles.single}>
        <span
          className="avatar"
          style={{ width: 52, height: 52, fontSize: 17, fontWeight: 800, background: s.author.color }}
          aria-hidden="true"
        >
          {s.author.initials}
        </span>
        <div>
          <blockquote>
            <p>{s.text}</p>
          </blockquote>
          {(s.name !== '' || s.meta !== '') && <figcaption>{[s.name, s.meta].filter(Boolean).join(' · ')}</figcaption>}
        </div>
      </figure>
    </Frame>
  );
}
