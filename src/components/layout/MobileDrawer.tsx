'use client';
import { Link, useAppPathname, useHardNavigate } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { useLogout, useSession } from '@/features/auth/api';
import type { Site } from '@/features/tenant/types';
import { routes } from '@/lib/routes';
import { BrandMark } from './BrandMark';
import styles from './MobileDrawer.module.css';
import { isActive, type NavItem } from './NavLinks';

/** Tablet/mobile navigation. A native modal <dialog>: focus is trapped, Esc closes, the page behind is inert. */
export function MobileDrawer({
  site,
  navItems,
  onClose,
}: {
  site: Pick<Site, 'name' | 'logoUrl' | 'features'>;
  navItems: NavItem[];
  onClose: () => void;
}) {
  const t = useTranslations('header');
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = useAppPathname();
  const hardNavigate = useHardNavigate();
  const { user } = useSession();
  const logout = useLogout();

  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const quick: { icon: IconName; label: string; href: string; badge?: number }[] = [
    ...(user ? [{ icon: 'heart' as const, label: t('wishlist'), href: routes.wishlist }] : []),
    { icon: 'cart', label: t('cart'), href: routes.cart, badge: user?.cartCount },
    ...(user && site.features.certificates ? [{ icon: 'award' as const, label: t('certificates'), href: routes.certificates }] : []),
    { icon: 'help', label: t('help'), href: routes.help },
  ];

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- backdrop click; <dialog> handles Esc natively
    <dialog
      ref={ref}
      className={styles.drawer}
      aria-label={t('menu')}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className={styles.panel}>
        <div className={styles.head}>
          <BrandMark site={site} size={28} />
          <span className={styles.name}>{site.name}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('closeMenu')}>
            <Icon name="close" size={20} />
          </button>
        </div>
        {user && site.features.streaks && user.streakDays > 0 && (
          <div className={styles.streak}>
            <span className="pill pill-brand">{t('streak', { days: user.streakDays })}</span>
          </div>
        )}
        <nav aria-label={t('menu')}>
          <ul className={styles.nav}>
            {navItems.map((item) => (
              <li key={item.href}>
                <Link href={item.href} onClick={onClose} aria-current={isActive(pathname, item) ? 'page' : undefined}>
                  {item.label}
                  <Icon name="chevronRight" size={18} className="flip-rtl" />
                </Link>
              </li>
            ))}
          </ul>
          <hr className={styles.rule} />
          <ul className={styles.quick}>
            {quick.map((q) => (
              <li key={q.href}>
                <Link href={q.href} onClick={onClose}>
                  <span className={styles.glyph}>
                    <Icon name={q.icon} size={14} />
                  </span>
                  <span className={styles.quickLabel}>{q.label}</span>
                  {q.badge ? <span className={styles.badge}>{q.badge}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.foot}>
          {user ? (
            <>
              <Link
                href={routes.account}
                onClick={onClose}
                className="avatar"
                style={{ width: 38, height: 38, fontSize: 13, background: user.color }}
                aria-hidden="true"
                tabIndex={-1}
              >
                {user.initials}
              </Link>
              <Link href={routes.account} onClick={onClose} className={styles.profile}>
                <strong>{t('drawerProfile')}</strong>
                <span>{t('drawerProfileSub')}</span>
              </Link>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={logout.isPending}
                onClick={() =>
                  logout.mutate(undefined, {
                    onSuccess: () => {
                      onClose();
                      hardNavigate(routes.signIn());
                    },
                  })
                }
              >
                {t('signOut')}
              </button>
            </>
          ) : (
            <div className={styles.guestFoot}>
              <Link href={routes.signIn(pathname)} className="btn btn-outline" onClick={onClose}>
                {t('signIn')}
              </Link>
              <Link href={routes.signUp(pathname)} className="btn btn-primary" onClick={onClose}>
                {t('getStarted')}
              </Link>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
