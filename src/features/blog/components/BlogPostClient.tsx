'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import { rememberPostRead } from '@/features/consent/tracking';
import { ApiError } from '@/lib/api/errors';
import { reportBlogView, useBlogComment } from '../api';
import styles from './Blog.module.css';

const KNOWN_SOURCES: Record<string, string> = {
  google: 'Google',
  bing: 'Bing',
  facebook: 'Facebook',
  instagram: 'Instagram',
  t: 'X',
  twitter: 'X',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
};

/** The referrer label the dashboard groups reads by (`Google`, `Instagram`, a host, or `Direct`). */
export function sourceLabel(referrer: string, ownHost: string): string {
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    if (host === ownHost) return 'Direct';
    const name = host.split('.').at(-2) ?? host;
    return KNOWN_SOURCES[name] ?? host.slice(0, 40);
  } catch {
    return 'Direct';
  }
}

/**
 * The post's browser side: counts the read (and its time when the reader leaves), remembers the post for last-click
 * blog revenue at checkout (features/analytics/referral), and the comment form (held for moderation).
 */
export function BlogPostClient({ slug }: { slug: string }) {
  const t = useTranslations('blog');
  const id = useId();
  const comment = useBlogComment(slug);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rememberPostRead(slug);
    const source = sourceLabel(document.referrer, window.location.hostname);
    reportBlogView(slug, { source });
    const started = Date.now();
    let sent = false;
    const leave = () => {
      const seconds = Math.round((Date.now() - started) / 1000);
      if (sent || seconds < 5) return;
      sent = true;
      reportBlogView(slug, { source, readSeconds: Math.min(7200, seconds) }, true);
    };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [slug]);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || text.trim().length < 2) {
      setError(t('commentInvalid'));
      return;
    }
    setError(null);
    comment.mutate(
      { name: name.trim(), email: email.trim(), text: text.trim() },
      {
        onError: (err) => setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : t('commentError')),
      },
    );
  };

  if (comment.isSuccess)
    return (
      <p className="alert alert-ok" role="status">
        {t('commentReceived')}
      </p>
    );

  return (
    <form className={styles.commentForm} onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="h3">
        {t('leaveComment')}
      </h3>
      {error && (
        <p className="alert alert-bad" role="alert">
          {error}
        </p>
      )}
      <div className="field">
        <label className="field-label" htmlFor={`${id}-name`}>
          {t('name')}
        </label>
        <input id={`${id}-name`} className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-email`}>
          {t('email')}
        </label>
        <input
          id={`${id}-email`}
          className="input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-text`}>
          {t('comment')}
        </label>
        <textarea id={`${id}-text`} className="textarea" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <p className={styles.meta}>{t('commentNote')}</p>
      <button type="submit" className="btn btn-primary" disabled={comment.isPending} style={{ justifySelf: 'start' }}>
        {t('postComment')}
      </button>
    </form>
  );
}
