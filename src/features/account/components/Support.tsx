'use client';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useDeferredValue, useId, useState, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { useSession } from '@/features/auth/api';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useSupportTicket } from '../api';
import type { HelpCategory, SupportTopic } from '../types';
import styles from './Support.module.css';

/** Help centre: instant client-side filter over the tenant's article categories (all rendered on the server). */
export function HelpCenter({ categories }: { categories: HelpCategory[] }) {
  const t = useTranslations('support');
  const id = useId();
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q).trim().toLowerCase();
  const shown = categories
    .map((c) => ({
      ...c,
      articles: c.articles.filter((a) => !dq || a.title.toLowerCase().includes(dq) || c.title.toLowerCase().includes(dq)),
    }))
    .filter((c) => c.articles.length > 0);

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
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {dq ? t('results', { count: shown.reduce((n, c) => n + c.articles.length, 0) }) : ''}
      </p>
      {shown.length === 0 ? (
        <p className={styles.empty}>{t('noResults')}</p>
      ) : (
        <ul className={`grid-3 ${styles.cats}`}>
          {shown.map((c) => (
            <li key={c.title} className={styles.cat}>
              <h2 className={styles.catTitle}>{c.title}</h2>
              <ul className={styles.articles}>
                {c.articles.map((a) => (
                  <li key={a.slug}>{a.title}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
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
