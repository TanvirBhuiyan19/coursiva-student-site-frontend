'use client';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { useMarkAllRead, useNotifications } from '@/features/account/api';
import { useSession } from '@/features/auth/api';
import type { Site } from '@/features/tenant/types';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { MobileDrawer } from './MobileDrawer';
import type { NavItem } from './NavLinks';
import styles from './SiteHeader.module.css';

type HeaderSite = Pick<Site, 'name' | 'logoUrl' | 'features'>;

/** Learner-specific header controls. Renders nothing personal until the session query resolves (no layout shift). */
export function HeaderActions({ site, navItems }: { site: HeaderSite; navItems: NavItem[] }) {
  const t = useTranslations('header');
  const { user, isLoading } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const cartCount = user?.cartCount ?? 0;

  return (
    <div className={styles.actions}>
      <span className={styles.spacer} />
      {user && site.features.streaks && user.streakDays > 0 && (
        <span className={`pill pill-brand ${styles.hideTablet}`}>{t('streak', { days: user.streakDays })}</span>
      )}
      {user && (
        <Link href={routes.wishlist} className={`icon-btn ${styles.hideTablet}`} aria-label={t('wishlist')} title={t('wishlist')}>
          <Icon name="heart" size={15} />
        </Link>
      )}
      <Link
        href={routes.cart}
        className="icon-btn"
        aria-label={cartCount ? t('cartCount', { count: cartCount }) : t('cart')}
        title={t('cart')}
      >
        <Icon name="cart" size={15} />
        {cartCount > 0 && (
          <span className="badge-count" aria-hidden="true">
            {cartCount}
          </span>
        )}
      </Link>
      {user && <Notifications unread={user.unreadNotifications} />}
      {user && (
        <Link
          href={routes.account}
          className={`avatar ${styles.avatarLink} ${styles.hideMobile}`}
          style={{ background: user.color }}
          aria-label={t('account')}
          title={user.name}
        >
          {user.initials}
        </Link>
      )}
      {!user && !isLoading && (
        <div className={`${styles.guest} ${styles.hideMobile}`}>
          <Link href={routes.signIn()} className="btn btn-outline btn-sm">
            {t('signIn')}
          </Link>
          <Link href={routes.signUp()} className={`btn btn-primary btn-sm ${styles.hideTablet}`}>
            {t('getStarted')}
          </Link>
        </div>
      )}
      <button type="button" className={styles.menuBtn} aria-label={t('menu')} aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
        <Icon name="menu" size={20} />
      </button>
      {menuOpen && <MobileDrawer site={site} navItems={navItems} onClose={() => setMenuOpen(false)} />}
    </div>
  );
}

function Notifications({ unread }: { unread: number }) {
  const t = useTranslations('header');
  const f = useFormat();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { data } = useNotifications(open);
  const markAll = useMarkAllRead();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`${styles.notifWrap} ${styles.hideMobile}`} ref={wrap}>
      <button
        type="button"
        className="icon-btn"
        aria-label={unread ? t('notificationsUnread', { count: unread }) : t('notifications')}
        aria-expanded={open}
        aria-controls="notifications-popover"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" size={16} />
        {unread > 0 && <span className={styles.dot} aria-hidden="true" />}
      </button>
      {open && (
        <div className={styles.popover} id="notifications-popover" role="region" aria-label={t('notifications')}>
          <div className={styles.popHead}>
            <h2>{t('notifications')}</h2>
            {unread > 0 && (
              <button
                type="button"
                className="link-btn"
                style={{ fontSize: 12 }}
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
              >
                {t('markAllRead')}
              </button>
            )}
          </div>
          {data?.length === 0 && <p className={styles.popEmpty}>{t('noNotifications')}</p>}
          <ul>
            {data?.map((n) => (
              <li key={n.id}>
                <Link href={n.href} className={styles.popItem} onClick={() => setOpen(false)}>
                  <span className={styles.popDot} data-read={n.read} aria-hidden="true" />
                  <span>
                    <span className={styles.popText}>{n.text}</span>
                    <span className={styles.popWhen} style={{ display: 'block' }}>
                      {f.ago(n.createdAt)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
