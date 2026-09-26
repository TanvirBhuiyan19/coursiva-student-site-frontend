import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { CourseCard } from '@/features/catalog/components/CourseCard';
import { CourseCover } from '@/features/catalog/components/CourseCover';
import { PlanCard } from '@/features/membership/components/PlanCard';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { stars } from '@/lib/format';
import type {
  FeaturedCoursesSection,
  HeroSection,
  InstructorSection,
  MembershipSection,
  NewsletterSection,
  Section,
  TestimonialsSection,
  TopicsSection,
  ValuePropsSection,
} from '../types';
import { NewsletterForm } from './NewsletterForm';
import styles from './Sections.module.css';

/** Renders the tenant's site-builder sections in order. Unknown kinds are skipped, so new kinds never break a page. */
export function Sections({ sections }: { sections: Section[] }) {
  return sections.map((s) => {
    switch (s.kind) {
      case 'hero':
        return <Hero key={s.id} s={s} />;
      case 'featured_courses':
        return <Featured key={s.id} s={s} />;
      case 'topics':
        return <Topics key={s.id} s={s} />;
      case 'instructor':
        return <Instructor key={s.id} s={s} />;
      case 'membership_plans':
        return <Membership key={s.id} s={s} />;
      case 'testimonials':
        return <Testimonials key={s.id} s={s} />;
      case 'value_props':
        return <ValueProps key={s.id} s={s} />;
      case 'newsletter':
        return <Newsletter key={s.id} s={s} />;
      default:
        return null;
    }
  });
}

function Hero({ s }: { s: HeroSection }) {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const f = useFormat();
  const c = s.spotlight;
  return (
    <section className={styles.hero} aria-labelledby={`${s.id}-title`}>
      <div className={`container ${styles.heroGrid}`}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrowPill}>{s.eyebrow}</span>
          <h1 id={`${s.id}-title`} className={`display ${styles.heroTitle}`}>
            {s.title}
          </h1>
          <p className={styles.heroSub}>{s.subtitle}</p>
          <div className={styles.ctas}>
            <Link href={s.primaryCta.href} className="btn btn-primary btn-lg">
              {s.primaryCta.label}
            </Link>
            {s.secondaryCta && (
              <Link href={s.secondaryCta.href} className="btn btn-outline btn-lg">
                {s.secondaryCta.label}
              </Link>
            )}
          </div>
          <dl className={styles.stats}>
            {s.stats.map((st) => (
              <div key={st.label}>
                <dt>{st.label}</dt>
                <dd className="num">{st.value}</dd>
              </div>
            ))}
          </dl>
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
              <span className="stars" aria-hidden="true">
                {stars(c.rating)}
              </span>
              <span className="sr-only">{tc('ratingLabel', { rating: c.rating })}</span>
              <span aria-hidden="true">{c.rating.toFixed(1)}</span> · {tc('students', { count: c.studentCount })}
            </p>
            <div className={styles.spotFoot}>
              <span className="num" style={{ fontSize: 22 }}>
                {f.money(c.price)}
              </span>
              <Link href={routes.course(c.slug)} className={styles.spotLink} aria-label={t('viewCourseNamed', { title: c.title })}>
                {t('viewCourse')}
              </Link>
            </div>
          </article>
        )}
      </div>
    </section>
  );
}

function Featured({ s }: { s: FeaturedCoursesSection }) {
  const tc = useTranslations('common');
  return (
    <section className={`container ${styles.section} ${styles.first}`} aria-labelledby={`${s.id}-title`}>
      <div className={styles.head}>
        <h2 id={`${s.id}-title`} className="h2-lg">
          {s.title}
        </h2>
        <Link href={routes.courses} className={styles.headLink}>
          {tc('seeAll')}
        </Link>
      </div>
      <ul className={`grid-3 ${styles.gridTop}`}>
        {s.courses.map((c) => (
          <li key={c.id}>
            <CourseCard course={c} variant="featured" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Topics({ s }: { s: TopicsSection }) {
  const tc = useTranslations('common');
  return (
    <section className={`container ${styles.section}`} aria-labelledby={`${s.id}-title`}>
      <h2 id={`${s.id}-title`} className="h2">
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
    </section>
  );
}

function Instructor({ s }: { s: InstructorSection }) {
  const t = useTranslations('home');
  const f = useFormat();
  const p = s.instructor;
  return (
    <section className={`container ${styles.section}`} aria-labelledby={`${s.id}-title`}>
      <div className={styles.instructor}>
        {s.video && (
          <figure className={styles.video}>
            {/* The welcome video loads its player on click (keeps the home page light). */}
            <span className={styles.play} aria-hidden="true">
              ▶
            </span>
            <figcaption className={styles.videoCap}>
              {s.video.title} · {f.clock(s.video.durationSeconds)}
            </figcaption>
          </figure>
        )}
        <div className={styles.instructorCopy}>
          <p className="eyebrow eyebrow-brand" style={{ letterSpacing: '0.08em', fontSize: 12 }}>
            {s.eyebrow}
          </p>
          <h2 id={`${s.id}-title`} className="h2" style={{ fontSize: 28, marginTop: 8 }}>
            {s.title}
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
              <p className={styles.personRole}>{p.role}</p>
            </div>
          </div>
          <p className={styles.bio}>{p.bio}</p>
          <dl className={`${styles.stats} ${styles.statsSm}`} aria-label={t('instructorStats')}>
            {s.stats.map((st) => (
              <div key={st.label}>
                <dt>{st.label}</dt>
                <dd className="num">{st.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function Membership({ s }: { s: MembershipSection }) {
  return (
    <section className={`container ${styles.section}`} aria-labelledby={`${s.id}-title`}>
      <div className={styles.centerHead}>
        <h2 id={`${s.id}-title`} className="h2">
          {s.title}
        </h2>
        <p>{s.subtitle}</p>
      </div>
      <ul className={`grid-3 ${styles.plans}`}>
        {s.plans.map((p) => (
          <li key={p.id} style={{ display: 'flex' }}>
            <PlanCard plan={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Testimonials({ s }: { s: TestimonialsSection }) {
  const tc = useTranslations('common');
  return (
    <section className={`container ${styles.section}`} aria-labelledby={`${s.id}-title`}>
      <div className={`card-soft ${styles.testimonials}`}>
        <h2 id={`${s.id}-title`} className="h2" style={{ textAlign: 'center' }}>
          {s.title}
        </h2>
        <ul className={`grid-3 ${styles.gridTop}`}>
          {s.items.map((q) => (
            <li key={q.author.name} className={styles.quote}>
              <figure>
                <p className="stars" style={{ fontSize: 13, letterSpacing: 2 }} aria-label={tc('ratingLabel', { rating: q.rating })}>
                  {stars(q.rating)}
                </p>
                <blockquote>
                  <p>{q.quote}</p>
                </blockquote>
                <figcaption className={styles.quoteBy}>
                  <span className="avatar" style={{ width: 32, height: 32, fontSize: 11.5, background: q.author.color }} aria-hidden="true">
                    {q.author.initials}
                  </span>
                  <span>
                    <strong>{q.author.name}</strong>
                    <span>{q.context}</span>
                  </span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const VALUE_GLYPH = { check: '✓', infinity: '∞', sparkle: '✦' } as const;

function ValueProps({ s }: { s: ValuePropsSection }) {
  return (
    <section className={`container ${styles.section}`}>
      <ul className="grid-3">
        {s.items.map((v) => (
          <li key={v.title} className={styles.value}>
            <span className={styles.valueIcon} aria-hidden="true">
              {VALUE_GLYPH[v.icon]}
            </span>
            <div>
              <h2 className={styles.valueTitle}>{v.title}</h2>
              <p>{v.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Newsletter({ s }: { s: NewsletterSection }) {
  return (
    <section className={`container ${styles.section} ${styles.last}`} aria-labelledby={`${s.id}-title`}>
      <div className={styles.newsletter}>
        <h2 id={`${s.id}-title`} className="h2" style={{ fontSize: 28 }}>
          {s.title}
        </h2>
        <p className={styles.nlBody}>{s.body}</p>
        <NewsletterForm />
      </div>
    </section>
  );
}
