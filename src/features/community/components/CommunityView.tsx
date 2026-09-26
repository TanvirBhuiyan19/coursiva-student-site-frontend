'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { BrandMark } from '@/components/layout/BrandMark';
import { useToast } from '@/components/toast/Toaster';
import { useSession } from '@/features/auth/api';
import { useRsvp } from '@/features/community/api';
import type { Site } from '@/features/tenant/types';
import { ApiError } from '@/lib/api/errors';
import { useFormat } from '@/lib/useFormat';
import { useCommunity, useCreatePost, usePosts, useToggleLike } from '../api';
import type { Space } from '../types';
import styles from './Community.module.css';

const ALL = 'sp_all';

/** Community: spaces (access computed per learner by the API), feed, composer, leaderboard and events. */
export function CommunityView({ site }: { site: Pick<Site, 'name' | 'logoUrl'> }) {
  const t = useTranslations('community');
  const tc = useTranslations('common');
  const f = useFormat();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const composerId = useId();
  const { user } = useSession();
  const overview = useCommunity();
  const spaceId = params.get('space') ?? ALL;
  const sort = params.get('sort') === 'top' ? 'top' : 'new';
  const posts = usePosts(spaceId, sort, !!overview.data);
  const create = useCreatePost();
  const like = useToggleLike();
  const rsvp = useRsvp();
  const [draft, setDraft] = useState('');
  const [postError, setPostError] = useState<string | null>(null);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  if (overview.isPending)
    return (
      <div className="container page">
        <div className="skeleton" style={{ height: 480 }} />
      </div>
    );
  if (overview.isError)
    return (
      <div className="container page">
        <div className="alert alert-bad" role="alert">
          {tc('errorBody')}{' '}
          <button type="button" className="link-btn" onClick={() => void overview.refetch()}>
            {tc('retry')}
          </button>
        </div>
      </div>
    );

  const o = overview.data;
  const current = o.spaces.find((s) => s.id === spaceId) ?? o.spaces[0]!;
  const postTarget: Space | undefined =
    current.id !== ALL && !current.locked ? current : o.spaces.find((s) => s.access === 'members' && !s.locked);
  const groups = [...new Set(o.spaces.map((s) => s.group))];
  const feed = posts.data?.pages.flatMap((p) => p.data) ?? [];

  const pickSpace = (s: Space) => {
    if (s.locked) {
      toast(s.lockedReason ?? t('locked'));
      return;
    }
    setParam('space', s.id === ALL ? null : s.id);
  };

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!draft.trim() || !postTarget) return;
    create.mutate(
      { spaceId: postTarget.id, body: draft.trim() },
      {
        onSuccess: () => {
          setDraft('');
          setPostError(null);
          toast(t('posted', { space: postTarget.name }));
        },
        onError: (err) => setPostError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : t('postFailed')),
      },
    );
  };

  return (
    <>
      <section className={styles.hero}>
        <div className={`container ${styles.heroInner}`}>
          <BrandMark site={site} size={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="h1-sm" style={{ fontSize: 30 }}>
              {o.name}
            </h1>
            <p className={styles.heroMeta}>
              {t.rich('members', { count: o.memberCount, b: (c) => <b>{c}</b> })}
              <span className={styles.online}>
                <span className={styles.onlineDot} aria-hidden="true" />
                {t.rich('online', { count: o.onlineCount, b: (c) => <b>{c}</b> })}
              </span>
            </p>
          </div>
          <p className={styles.rules}>{o.guidelines}</p>
        </div>
      </section>

      <div className={`container ${styles.layout}`}>
        <div className={styles.side}>
          <nav aria-label={t('spaces')}>
            {groups.map((g) => (
              <div key={g} className={styles.group}>
                <h2 className={styles.groupTitle}>{g}</h2>
                <ul>
                  {o.spaces
                    .filter((s) => s.group === g)
                    .map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className={styles.space}
                          aria-current={s.id === current.id ? 'true' : undefined}
                          data-locked={s.locked}
                          onClick={() => pickSpace(s)}
                        >
                          <span className={styles.spaceDot} aria-hidden="true" />
                          <span className={styles.spaceName}>{s.name}</span>
                          {s.locked ? (
                            <span aria-label={t('lockedLabel')} role="img">
                              🔒
                            </span>
                          ) : (
                            <span className={styles.spaceCount}>{s.postCount}</span>
                          )}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className={styles.spaceInfo}>
            <p className={styles.spaceInfoTitle}>
              {current.name} <span className={styles.accessTag}>{t(`access.${current.access}`)}</span>
            </p>
            <p className={styles.spaceInfoWhy}>
              {t(`accessWhy.${current.access}`)} · {t('postCount', { count: current.postCount })}
            </p>
          </div>

          {o.leaderboard.length > 0 && (
            <section className={styles.panel} aria-labelledby="lb-t">
              <h2 id="lb-t" className={styles.panelTitle}>
                {t('leaderboard')}
              </h2>
              <ol className={styles.leaders}>
                {o.leaderboard.map((l) => (
                  <li key={l.rank} className={styles.leader} data-me={l.isMe}>
                    <span className={styles.rank} data-first={l.rank === 1}>
                      {l.rank}
                    </span>
                    <span className="avatar" style={{ width: 24, height: 24, fontSize: 9, background: l.person.color }} aria-hidden="true">
                      {l.person.initials}
                    </span>
                    <span className={styles.leaderName}>
                      {l.person.name}
                      {l.isMe && <span className="sr-only"> ({t('you')})</span>}
                    </span>
                    <span className={styles.points}>{f.number(l.points)}</span>
                  </li>
                ))}
              </ol>
              <p className={styles.panelNote}>{t('pointsNote')}</p>
            </section>
          )}

          <section className={styles.panel} aria-labelledby="ev-t">
            <h2 id="ev-t" className={styles.panelTitle}>
              {t('events')}
            </h2>
            <ul>
              {o.events.map((e, i) => {
                const d = new Date(e.startsAt);
                const tz = user?.timezone;
                return (
                  <li key={e.id} className={styles.event}>
                    <div className={styles.eventRow}>
                      <span className={styles.date} aria-hidden="true">
                        <span>{new Intl.DateTimeFormat(f.locale, { month: 'short', timeZone: tz }).format(d)}</span>
                        <b>{new Intl.DateTimeFormat(f.locale, { day: 'numeric', timeZone: tz }).format(d)}</b>
                      </span>
                      <div>
                        <p className={styles.eventTitle}>{e.title}</p>
                        <p className={styles.eventMeta}>
                          <time dateTime={e.startsAt}>
                            {new Intl.DateTimeFormat(f.locale, {
                              weekday: 'long',
                              hour: 'numeric',
                              minute: '2-digit',
                              timeZone: tz,
                            }).format(d)}
                          </time>{' '}
                          · {t(`providers.${e.provider}`)}
                        </p>
                      </div>
                    </div>
                    {i === 0 && (
                      <button
                        type="button"
                        className={`btn btn-sm btn-block ${e.going ? 'btn-success' : 'btn-outline'}`}
                        aria-pressed={e.going}
                        disabled={rsvp.isPending}
                        onClick={() => rsvp.mutate({ eventId: e.id, going: !e.going })}
                        style={{ marginTop: 10 }}
                      >
                        {e.going ? t('going', { count: e.attendees }) : t('rsvp', { count: e.attendees })}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <div className={styles.feed}>
          {postTarget && user && (
            <form className={styles.composer} onSubmit={submit}>
              <span className="avatar" style={{ width: 34, height: 34, fontSize: 12, background: user.color }} aria-hidden="true">
                {user.initials}
              </span>
              <div className={styles.composerBody}>
                <label htmlFor={composerId} className="sr-only">
                  {t('composerLabel', { space: postTarget.name })}
                </label>
                <textarea
                  id={composerId}
                  className={styles.composerInput}
                  rows={2}
                  placeholder={t('composerPlaceholder')}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                {postError && <p className="field-error">{postError}</p>}
                <div className={styles.composerFoot}>
                  <span className={styles.postingIn}>{t.rich('postingIn', { space: postTarget.name, b: (c) => <b>{c}</b> })}</span>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={create.isPending || !draft.trim()}>
                    {t('post')}
                  </button>
                </div>
              </div>
            </form>
          )}
          <div className={styles.sort} role="group" aria-label={t('sortLabel')}>
            <button type="button" className="chip" aria-pressed={sort === 'new'} onClick={() => setParam('sort', null)}>
              {t('newest')}
            </button>
            <button type="button" className="chip" aria-pressed={sort === 'top'} onClick={() => setParam('sort', 'top')}>
              {t('top')}
            </button>
          </div>
          {posts.isPending ? (
            <div className="skeleton" style={{ height: 300 }} />
          ) : feed.length === 0 ? (
            <p className={styles.empty}>{t('emptySpace')}</p>
          ) : (
            <ul className={styles.posts}>
              {feed.map((p) => (
                <li key={p.id}>
                  <article className={styles.post} aria-labelledby={`post-${p.id}`}>
                    <header className={styles.postHead}>
                      <span
                        className="avatar"
                        style={{ width: 36, height: 36, fontSize: 12.5, background: p.author.color }}
                        aria-hidden="true"
                      >
                        {p.author.initials}
                      </span>
                      <div>
                        <p id={`post-${p.id}`} className={styles.author}>
                          {p.author.name} {p.author.isInstructor && <span className={styles.coach}>{t('coach')}</span>}
                        </p>
                        <p className={styles.postMeta}>
                          <time dateTime={p.createdAt}>{f.ago(p.createdAt)}</time> · {p.spaceName}
                        </p>
                      </div>
                    </header>
                    <p className={styles.body}>{p.body}</p>
                    <footer className={styles.postFoot}>
                      <button
                        type="button"
                        className={styles.like}
                        aria-pressed={p.liked}
                        aria-label={t('likeLabel', { count: p.likes })}
                        onClick={() => user && like.mutate({ postId: p.id, liked: !p.liked })}
                      >
                        <span aria-hidden="true">♥</span> {p.likes}
                      </button>
                      <span className={styles.replies}>{t('replies', { count: p.replies })}</span>
                    </footer>
                  </article>
                </li>
              ))}
            </ul>
          )}
          {posts.hasNextPage && (
            <button
              type="button"
              className="btn btn-outline btn-block"
              onClick={() => void posts.fetchNextPage()}
              disabled={posts.isFetchingNextPage}
              style={{ marginTop: 16 }}
            >
              {t('loadMore')}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
