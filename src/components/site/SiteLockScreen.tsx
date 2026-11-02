'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import { BrandMark } from '@/components/layout/BrandMark';
import { enablePersonal, siteUnlockedForVisitor, useUnlockSite } from '@/features/pages/api';
import type { Site } from '@/features/tenant/types';
import { ApiError } from '@/lib/api/errors';
import styles from './Site.module.css';

const RETRY_KEY = 'coursiva_unlock_retry';

/**
 * The school's site is locked (site builder → Settings → Site lock). The shared render shows this to everyone; a
 * visitor with the password unlocks it (`POST /site/unlock` sets an httpOnly cookie), then this browser switches to
 * personal rendering and reloads into the real site. A visitor who unlocked earlier is let back in automatically.
 */
export function SiteLockScreen({ site, password }: { site: Pick<Site, 'name' | 'logoUrl'>; password: boolean }) {
  const t = useTranslations('site');
  const id = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const unlock = useUnlockSite();

  useEffect(() => {
    // Unlocked on an earlier visit (the cookie lasts 30 days): switch personal rendering back on — once per tab, so a
    // browser that refuses the switch can't loop.
    let tried = false;
    try {
      tried = sessionStorage.getItem(RETRY_KEY) === '1';
      sessionStorage.setItem(RETRY_KEY, '1');
    } catch {
      tried = true;
    }
    if (tried) return;
    void siteUnlockedForVisitor()
      .then(async (open) => {
        if (!open) return;
        await enablePersonal();
        window.location.reload();
      })
      .catch(() => undefined);
  }, []);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (value === '') {
      setError(t('lockRequired'));
      return;
    }
    unlock.mutate(value, {
      onSuccess: () => window.location.reload(),
      onError: (err) =>
        setError(
          err instanceof ApiError
            ? err.isRateLimited
              ? t('lockRateLimited')
              : (err.fieldErrors.password ?? err.message)
            : t('lockFailed'),
        ),
    });
  };

  return (
    <main id="main" className={styles.lock}>
      <div className={styles.lockCard}>
        <div className={styles.lockBrand}>
          <BrandMark site={site} size={30} />
          <span>{site.name}</span>
        </div>
        <h1 className="h2">{t('lockTitle')}</h1>
        <p>{password ? t('lockBody') : t('lockClosed')}</p>
        {password && (
          <form className={styles.lockForm} onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor={id} className="field-label">
                {t('lockPassword')}
              </label>
              <input
                id={id}
                type="password"
                className="input"
                autoComplete="current-password"
                maxLength={100}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
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
              {t('lockUnlock')}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
