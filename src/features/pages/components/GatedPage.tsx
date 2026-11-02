'use client';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { Link, useAppPathname } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useUnlockPage, useVisitorPage } from '../api';
import { pageGateOf } from '../gates';
import type { PageGate } from '../types';
import { Sections } from './Sections';
import styles from './Sections.module.css';

/**
 * A password or members-only page. The shared server render can't know who is visiting, so it shows this gate; the
 * browser then asks the API with the visitor's own cookies (session, page unlock) and renders the page, a password
 * form, a sign-in prompt or a "members only" note.
 */
export function GatedPage({ slug, gate, title }: { slug: string; gate: PageGate; title: string | null }) {
  const page = useVisitorPage(slug);
  const t = useTranslations('pages');

  if (page.data) return <Sections sections={page.data.sections} title={page.data.title} />;
  if (page.isPending) {
    return (
      <div className={`container ${styles.gate}`} aria-busy="true">
        <h1 className="h1-sm">{title ?? t('gate.loadingTitle')}</h1>
        <div className="skeleton" style={{ height: 120, marginTop: 24 }} />
      </div>
    );
  }
  const current = pageGateOf(page.error) ?? gate;
  if (page.error instanceof ApiError && page.error.status === 404) {
    return (
      <div className={`container ${styles.gate}`}>
        <h1 className="h1-sm">{t('gate.goneTitle')}</h1>
      </div>
    );
  }
  if (current === 'page_password_required') return <PasswordGate slug={slug} title={title} />;
  return <MembersGate forbidden={current === 'members_only_forbidden'} />;
}

function PasswordGate({ slug, title }: { slug: string; title: string | null }) {
  const t = useTranslations('pages');
  const id = useId();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const unlock = useUnlockPage(slug);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (password === '') {
      setError(t('gate.passwordRequired'));
      return;
    }
    unlock.mutate(password, {
      onError: (err) =>
        setError(
          err instanceof ApiError
            ? err.isRateLimited
              ? t('gate.rateLimited')
              : (err.fieldErrors.password ?? err.message)
            : t('gate.failed'),
        ),
    });
  };

  return (
    <div className={`container ${styles.gate}`}>
      <h1 className="h1-sm">{title ?? t('gate.passwordTitle')}</h1>
      <p>{t('gate.passwordBody')}</p>
      <form className={styles.gateForm} onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={id} className="field-label">
            {t('gate.passwordLabel')}
          </label>
          <input
            id={id}
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            maxLength={100}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
          />
          {error && (
            <p id={`${id}-err`} className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={unlock.isPending}>
          {t('gate.unlock')}
        </button>
      </form>
    </div>
  );
}

function MembersGate({ forbidden }: { forbidden: boolean }) {
  const t = useTranslations('pages');
  const path = useAppPathname();
  return (
    <div className={`container ${styles.gate}`}>
      <h1 className="h1-sm">{t('gate.membersTitle')}</h1>
      <p>{forbidden ? t('gate.membersForbidden') : t('gate.membersSignIn')}</p>
      <div className={styles.gateActions}>
        {forbidden ? (
          <>
            <Link href={routes.membership} className="btn btn-primary">
              {t('gate.seeMembership')}
            </Link>
            <Link href={routes.courses} className="btn btn-outline">
              {t('gate.browseCourses')}
            </Link>
          </>
        ) : (
          <>
            <Link href={routes.signIn(path)} className="btn btn-primary">
              {t('gate.signIn')}
            </Link>
            <Link href={routes.signUp(path)} className="btn btn-outline">
              {t('gate.signUp')}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
