'use client';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { useSession } from '@/features/auth/api';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useHelpSearch, useSupportTicket } from '../api';
import type { HelpCategory, HelpSearchResult, SupportTopic } from '../types';
import styles from './Support.module.css';

/** Help centre: the school's article categories (rendered on the server), and search through the API as you type. */
export function HelpCenter({ categories }: { categories: HelpCategory[] }) {
  const t = useTranslations('support');
  const id = useId();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const active = debounced.split(/\s+/).some((w) => w.length >= 2);
  const search = useHelpSearch(debounced);
  // An API without search (or a failed request) falls back to matching the article titles listed on the page.
  const words = debounced.toLowerCase().split(/\s+/).filter(Boolean);
  const fallback: HelpSearchResult[] = categories.flatMap((c) =>
    c.articles
      .filter((a) => words.every((w) => a.title.toLowerCase().includes(w)))
      .map((a) => ({ slug: a.slug, title: a.title, category: c.title, excerpt: a.excerpt })),
  );
  const results = search.isError ? fallback : search.data;
  const loading = active && !search.isError && (search.isPending || search.isPlaceholderData);

  return (
    <>
      <div className={styles.search} role="search">
        <label htmlFor={id} className="sr-only">
          {t('searchLabel')}
        </label>
        <input
          id={id}
          type="search"
          className="input"
          placeholder={t('searchPlaceholder')}
          value={q}
          maxLength={100}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {active && results && !loading ? t('results', { count: results.length }) : ''}
      </p>
      {!active ? (
        categories.length === 0 ? (
          <p className={styles.empty}>{t('noArticles')}</p>
        ) : (
          <ul className={`grid-3 ${styles.cats}`}>
            {categories.map((c) => (
              <li key={c.title} className={styles.cat}>
                <h2 className={styles.catTitle}>{c.title}</h2>
                <ul className={styles.articles}>
                  {c.articles.map((a) => (
                    <li key={a.slug}>
                      <Link href={routes.helpArticle(a.slug)} className={styles.articleLink}>
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )
      ) : (
        <section className={styles.results} aria-labelledby={`${id}-results`} aria-busy={loading}>
          <h2 id={`${id}-results`} className="sr-only">
            {t('resultsTitle')}
          </h2>
          {search.isError && (
            <p className={`alert alert-bad ${styles.searchError}`} role="status">
              {t('searchError')}
            </p>
          )}
          {loading && !results ? (
            <div className={styles.resultList}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 64 }} />
              ))}
            </div>
          ) : results && results.length > 0 ? (
            <ul className={styles.resultList} style={loading ? { opacity: 0.6 } : undefined}>
              {results.map((r) => (
                <li key={r.slug} className={styles.result}>
                  <Link href={routes.helpArticle(r.slug)} className={styles.resultTitle}>
                    {r.title}
                  </Link>
                  <p className={styles.resultMeta}>{r.category}</p>
                  {r.excerpt && <p className={styles.resultExcerpt}>{r.excerpt}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>{t('noResults')}</p>
          )}
        </section>
      )}
    </>
  );
}

const TOPICS: SupportTopic[] = ['access', 'billing', 'refund', 'certificate', 'other'];

export function ContactForm() {
  const t = useTranslations('support');
  const toast = useToast();
  const id = useId();
  const { user, isLoading } = useSession();
  const ticket = useSupportTicket();
  const [topic, setTopic] = useState<SupportTopic>('access');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (ticket.isSuccess) {
    return (
      <div className="alert alert-ok" role="status" style={{ marginTop: 24, padding: 18 }}>
        <p style={{ fontWeight: 700 }}>{t('sentTitle')}</p>
        <p style={{ fontWeight: 500, marginTop: 4 }}>{t('sentBody', { email: user?.email ?? email })}</p>
      </div>
    );
  }

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (message.trim().length < 10) found.message = t('messageShort');
    if (!user && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = t('emailInvalid');
    setErrors(found);
    if (Object.keys(found).length) return;
    ticket.mutate(
      { topic, message: message.trim(), email: user?.email ?? email.trim() },
      {
        onSuccess: () => toast(t('sentToast')),
        onError: (err) => setErrors(err instanceof ApiError && err.isValidation ? err.fieldErrors : { form: t('failed') }),
      },
    );
  };

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {errors.form && (
        <p className="alert alert-bad" role="alert">
          {errors.form}
        </p>
      )}
      {!user && !isLoading && (
        <div className="field">
          <label className="field-label" htmlFor={`${id}-email`}>
            {t('email')}
          </label>
          <input
            id={`${id}-email`}
            type="email"
            autoComplete="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? `${id}-email-err` : undefined}
          />
          {errors.email && (
            <p id={`${id}-email-err`} className="field-error">
              {errors.email}
            </p>
          )}
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor={`${id}-topic`}>
          {t('topic')}
        </label>
        <select id={`${id}-topic`} className="select" value={topic} onChange={(e) => setTopic(e.target.value as SupportTopic)}>
          {TOPICS.map((tp) => (
            <option key={tp} value={tp}>
              {t(`topics.${tp}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-msg`}>
          {t('message')}
        </label>
        <textarea
          id={`${id}-msg`}
          className="textarea"
          rows={5}
          placeholder={t('messagePlaceholder')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={!!errors.message}
          aria-describedby={errors.message ? `${id}-msg-err` : undefined}
        />
        {errors.message && (
          <p id={`${id}-msg-err`} className="field-error">
            {errors.message}
          </p>
        )}
      </div>
      <button type="submit" className="btn btn-primary btn-lg" disabled={ticket.isPending} style={{ alignSelf: 'flex-start' }}>
        {t('send')}
      </button>
    </form>
  );
}

export function ContactAside({ email, community, guaranteeDays }: { email: string; community: boolean; guaranteeDays: number }) {
  const t = useTranslations('support');
  return (
    <aside className={styles.aside} aria-label={t('otherWays')}>
      <div className={styles.side}>
        <p className="eyebrow">{t('emailLabel')}</p>
        <a href={`mailto:${email}`} className={styles.sideTitle}>
          {email}
        </a>
        <p className={styles.sideSub}>{t('emailSub')}</p>
      </div>
      {community && (
        <div className={styles.side}>
          <p className="eyebrow">{t('communityLabel')}</p>
          <p className={styles.sideTitle}>{t('communityTitle')}</p>
          <p className={styles.sideSub}>{t('communitySub')}</p>
          <Link href={routes.community} className={styles.sideLink}>
            {t('openCommunity')}
          </Link>
        </div>
      )}
      <div className={styles.side}>
        <p className="eyebrow">{t('refundsLabel')}</p>
        <p className={styles.sideTitle}>{t('refundsTitle', { days: guaranteeDays })}</p>
        <Link href={routes.refund} className={styles.sideLink}>
          {t('readPolicy')}
        </Link>
      </div>
    </aside>
  );
}
