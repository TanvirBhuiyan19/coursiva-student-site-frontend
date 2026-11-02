'use client';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { useLocalePrefix } from '@/i18n/navigation';
import { withPrefix } from '@/i18n/locales';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useDiscordLink, useUnlinkDiscord } from '../api';
import { type DiscordReturn, discordLinkUrl, discordReturn, withoutDiscordParams } from '../discord';
import styles from './Profile.module.css';

/**
 * "Link Discord": joins the school's community server and syncs course roles (docs/api/account.md → Discord). Hidden
 * unless the school has Discord connected. The link is a full-page round trip through Discord that lands back here
 * with `?discord=linked|error&reason=…`; the outcome shows once and the query is stripped.
 */
export function DiscordCard() {
  const t = useTranslations('account.discord');
  const tc = useTranslations('common');
  const f = useFormat();
  const toast = useToast();
  const params = useSearchParams();
  const [outcome, setOutcome] = useState<DiscordReturn | null>(() => discordReturn(params));
  const { data, isPending, isError, refetch } = useDiscordLink();
  const unlink = useUnlinkDiscord();
  // Back in the browser's own URL (with the /<lang> prefix): the API redirects there directly.
  const linkHref = discordLinkUrl(withPrefix(useLocalePrefix(), routes.account));

  // Strip the round trip's query so a reload or a shared URL doesn't repeat the message.
  useEffect(() => {
    if (!outcome) return;
    const { pathname, search, hash } = window.location;
    const cleaned = withoutDiscordParams(search);
    if (cleaned !== search) window.history.replaceState(null, '', `${pathname}${cleaned}${hash}`);
  }, [outcome]);

  const alert = outcome && (
    <div
      className={`alert ${outcome.kind === 'linked' ? 'alert-ok' : 'alert-bad'} ${styles.notice}`}
      role={outcome.kind === 'linked' ? 'status' : 'alert'}
    >
      <span>{outcome.kind === 'linked' ? t('linkedAlert') : t(`reasons.${outcome.reason ?? 'generic'}`)}</span>
      <button type="button" className="link-btn" onClick={() => setOutcome(null)}>
        {t('dismiss')}
      </button>
    </div>
  );

  if (isPending) return <div className="skeleton" style={{ height: 120, marginTop: 16 }} />;
  if (isError)
    return (
      <div className="alert alert-bad" role="alert" style={{ marginTop: 16 }}>
        {tc('errorBody')}{' '}
        <button type="button" className="link-btn" onClick={() => void refetch()}>
          {tc('retry')}
        </button>
      </div>
    );
  // Not offered by this school: no card, but a failed round trip (e.g. Discord was just disconnected) still says why.
  if (!data.available) return alert ? <div style={{ marginTop: 16 }}>{alert}</div> : null;

  return (
    <section className={styles.card} aria-labelledby="discord-t">
      <h2 id="discord-t" className={styles.title}>
        {t('title')}
      </h2>
      {alert}
      {data.linked && data.needsRelink && (
        <p className="alert alert-bad" role="alert">
          {t('needsRelink')}
        </p>
      )}
      {data.linked ? (
        <div className={styles.row}>
          <div style={{ flex: 1 }}>
            <p className={styles.strong}>{data.username ? t('linkedAs', { username: data.username }) : t('linkedNoName')}</p>
            {data.linkedAt && <p className={styles.sub}>{t('linkedOn', { date: f.date(data.linkedAt) })}</p>}
          </div>
          {data.needsRelink && (
            <a href={linkHref} className="btn btn-primary">
              {t('linkAgain')}
            </a>
          )}
          <button
            type="button"
            className="btn btn-outline"
            disabled={unlink.isPending}
            onClick={() =>
              unlink.mutate(undefined, {
                onSuccess: () => {
                  setOutcome(null);
                  toast(t('unlinkedToast'));
                },
                onError: () => toast(t('unlinkFailed')),
              })
            }
          >
            {t('unlink')}
          </button>
        </div>
      ) : (
        <div className={styles.row}>
          <p className={styles.sub} style={{ flex: 1, marginTop: 0 }}>
            {t('intro')}
          </p>
          <a href={linkHref} className="btn btn-primary">
            {t('link')}
          </a>
        </div>
      )}
    </section>
  );
}
