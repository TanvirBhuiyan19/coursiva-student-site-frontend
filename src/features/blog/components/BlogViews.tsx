import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/format';
import { Markdown } from '@/lib/markdown';
import { routes } from '@/lib/routes';
import type { BlogPost, BlogPostCard } from '../types';
import { BlogPostClient } from './BlogPostClient';
import styles from './Blog.module.css';

/** `/blog`: the school's published posts, newest first (server-rendered, cached by the `blog` tag). */
export async function BlogList({ posts, locale }: { posts: BlogPostCard[]; locale: string }) {
  const t = await getTranslations('blog');
  if (posts.length === 0) return <p className={styles.empty}>{t('empty')}</p>;
  return (
    <ul className={styles.list}>
      {posts.map((p) => (
        <li key={p.slug}>
          <article className={styles.card}>
            <p className={styles.meta}>
              {[p.categories.join(' · '), p.publishedAt ? formatDate(p.publishedAt, locale) : null].filter(Boolean).join(' — ')}
            </p>
            <h2>
              <Link href={routes.blogPost(p.slug)}>{p.title}</Link>
            </h2>
            {p.excerpt && <p className={styles.excerpt}>{p.excerpt}</p>}
            <p className={styles.meta}>{t('byline', { author: p.author.name || t('team'), minutes: p.readMinutes })}</p>
          </article>
        </li>
      ))}
    </ul>
  );
}

/** `/blog/{slug}`: one post (Markdown rendered to safe elements), its approved comments and the comment form. */
export async function BlogPostView({ post, locale }: { post: BlogPost; locale: string }) {
  const t = await getTranslations('blog');
  const meta = [
    post.author.name || t('team'),
    post.publishedAt ? formatDate(post.publishedAt, locale) : null,
    t('minutes', { minutes: post.readMinutes }),
  ];
  return (
    <article className={styles.post} aria-labelledby="post-title">
      <Link href={routes.blog} className={styles.meta}>
        {`← ${t('back')}`}
      </Link>
      {post.categories.length > 0 && (
        <p className={styles.meta} style={{ marginTop: 18 }}>
          {post.categories.join(' · ')}
        </p>
      )}
      <h1 id="post-title" className="h1" style={{ marginTop: 6 }}>
        {post.title}
      </h1>
      <p className={styles.meta} style={{ marginTop: 10 }}>
        {meta.filter(Boolean).join(' · ')}
      </p>
      <Markdown source={post.body} className={styles.body} />
      {post.cta !== 'none' && post.cta !== '' && (
        <aside className={styles.cta}>
          <p style={{ fontWeight: 700 }}>{t('ctaTitle')}</p>
          <Link href={routes.courses} className="btn btn-primary" style={{ marginTop: 12 }}>
            {t('ctaButton')}
          </Link>
        </aside>
      )}
      <section className={styles.comments} aria-labelledby="comments-title">
        <h2 id="comments-title" className="h3">
          {t('comments', { count: post.comments.length })}
        </h2>
        {post.comments.map((c) => (
          <div key={c.id} className={styles.comment}>
            <p className={styles.meta}>
              <b>{c.authorName}</b> · {formatDate(c.createdAt, locale)}
            </p>
            <p style={{ marginTop: 4 }}>{c.text}</p>
          </div>
        ))}
        <BlogPostClient slug={post.slug} />
      </section>
    </article>
  );
}
