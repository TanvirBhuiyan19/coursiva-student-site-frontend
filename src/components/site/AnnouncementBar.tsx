import { useTranslations } from 'next-intl';
import styles from './Site.module.css';

/** The school's announcement bar (site builder → Theme → Announcement), above the header on every page. */
export function AnnouncementBar({ text }: { text: string }) {
  const t = useTranslations('site');
  return (
    <aside className={styles.announcement} aria-label={t('announcement')}>
      {text}
    </aside>
  );
}
