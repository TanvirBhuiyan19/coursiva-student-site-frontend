import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Markdown } from '@/lib/markdown';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import type { HelpArticle } from '../types';
import styles from './Support.module.css';

/** A help-centre article (`/help/{slug}`): the school's Markdown, related articles of its category, and the way to support. */
export function HelpArticleView({ article }: { article: HelpArticle }) {
  const t = useTranslations('support');
  const f = useFormat();
  return (
    <article className={`container page ${styles.article}`}>
      <nav aria-label={t('helpMeta')}>
        <ol className={styles.crumbs}>
          <li>
            <Link href={routes.help}>{t('helpMeta')}</Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>{article.category}</li>
        </ol>
      </nav>
      <h1 className="h1-sm" style={{ marginTop: 10 }}>
        {article.title}
      </h1>
      <p className={styles.updated}>
        {t('updated')} <time dateTime={article.updatedAt}>{f.date(article.updatedAt)}</time>
      </p>
      <Markdown source={article.body} className={styles.articleBody} headingLevel={2} images={false} />
      {article.related.length > 0 && (
        <section className={styles.related} aria-labelledby="help-related">
          <h2 id="help-related">{t('relatedTitle', { category: article.category })}</h2>
          <ul className={styles.articles}>
            {article.related.map((r) => (
              <li key={r.slug}>
                <Link href={routes.helpArticle(r.slug)} className={styles.articleLink}>
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={styles.stuck} aria-labelledby="help-stuck">
        <h2 id="help-stuck">{t('articleStuckTitle')}</h2>
        <p>{t('articleStuckBody')}</p>
        <Link href={routes.contact} className="btn btn-primary btn-lg" style={{ marginTop: 18 }}>
          {t('contactSupport')}
        </Link>
      </section>
    </article>
  );
}
