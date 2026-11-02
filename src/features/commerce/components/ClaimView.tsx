'use client';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useSession } from '@/features/auth/api';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useClaim } from '../api';
import styles from './Commerce.module.css';

/**
 * Redeems a gift or team seat (`/claim?token=` → `POST /me/claims`). The learner confirms with a button, so a link
 * opened in the wrong account (or by an email scanner) never uses the seat up by itself.
 */
export function ClaimView() {
  const t = useTranslations('claim');
  const token = useSearchParams().get('token') ?? '';
  const { user } = useSession();
  const claim = useClaim();

  if (!token) {
    return (
      <div className={styles.success}>
        <h1 className="h1-sm">{t('invalidTitle')}</h1>
        <p className="lead">{t('invalidBody')}</p>
      </div>
    );
  }

  if (claim.isSuccess) {
    const slug = claim.data.courseSlug;
    return (
      <div className={styles.success} role="status">
        <span className={styles.tick} aria-hidden="true">
          ✓
        </span>
        <h1 className="h1-sm" style={{ marginTop: 16 }}>
          {t('doneTitle')}
        </h1>
        <p className="lead" style={{ marginTop: 8 }}>
          {t('doneBody')}
        </p>
        <Link href={slug ? routes.player(slug) : routes.learning} className="btn btn-primary btn-lg" style={{ marginTop: 24 }}>
          {slug ? t('start') : t('goToLearning')}
        </Link>
      </div>
    );
  }

  const error = claim.isError
    ? claim.error instanceof ApiError
      ? (Object.values(claim.error.fieldErrors)[0] ?? claim.error.message)
      : t('error')
    : null;

  return (
    <div className={styles.success}>
      <span className={styles.tick} aria-hidden="true">
        ✦
      </span>
      <h1 className="h1-sm" style={{ marginTop: 16 }}>
        {t('title')}
      </h1>
      <p className="lead" style={{ marginTop: 8 }}>
        {user ? t('body', { email: user.email }) : t('bodyGuest')}
      </p>
      {error && (
        <p className="alert alert-bad" role="alert" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary btn-lg"
        style={{ marginTop: 24 }}
        disabled={!user || claim.isPending}
        onClick={() => claim.mutate(token)}
      >
        {t('cta')}
      </button>
      <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>
        {t('wrongAccount')}
      </p>
    </div>
  );
}
