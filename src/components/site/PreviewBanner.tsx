import { getTranslations } from 'next-intl/server';
import { personalContext } from '@/lib/api/personal';
import styles from './Site.module.css';

/** Shown while a dashboard preview is open (the school's draft): says so, and offers a way back to the live site. */
export async function PreviewBanner() {
  const personal = await personalContext();
  if (!personal?.preview) return null;
  const t = await getTranslations('site');
  return (
    <div className={styles.preview} role="status">
      <span>{t('previewing')}</span>
      <form method="post" action="/__site">
        <input type="hidden" name="action" value="exit" />
        <button type="submit" className="btn btn-white btn-sm">
          {t('exitPreview')}
        </button>
      </form>
    </div>
  );
}
