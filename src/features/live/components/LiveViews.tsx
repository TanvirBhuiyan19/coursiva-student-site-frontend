'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import type { Organizer } from '@/features/learning/calendar';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import {
  fetchBreakoutToken,
  fetchRoomChat,
  fetchRoomToken,
  isRemoved,
  sendPresence,
  useLiveSession,
  useRoomActions,
  useRoomFeed,
} from '../api';
import type { LiveSession, RoomChatMessage, RoomFeed, RoomPoll } from '../types';
import { DailyRoom } from './DailyRoom';
import styles from './Live.module.css';
import { SessionDetails } from './SessionDetails';

function Loading({ id, poll, children }: { id: string; poll?: boolean; children: (s: LiveSession) => React.ReactNode }) {
  const t = useTranslations('live');
  const tc = useTranslations('common');
  const { data, isPending, isError, error, refetch } = useLiveSession(id, poll);
  if (isPending) return <div className="skeleton" style={{ height: 280, maxWidth: 720, margin: '0 auto' }} />;
  if (isError)
    return (
      <div className="alert alert-bad" role="alert" style={{ maxWidth: 720, margin: '0 auto' }}>
        {error instanceof ApiError && error.status === 404 ? t('notFound') : tc('errorBody')}{' '}
        {!(error instanceof ApiError && error.status === 404) && (
          <button type="button" className="link-btn" onClick={() => void refetch()}>
            {tc('retry')}
          </button>
        )}
      </div>
    );
  return <>{children(data)}</>;
}

/** `/live/{id}` (reminder and recap e-mails link here): when, what, RSVP, add to calendar, and the way in. */
export function LiveSessionView({ id, organizer }: { id: string; organizer: Organizer }) {
  // Re-read every 20 s: it goes live, the join opens, the replay is published.
  return (
    <Loading id={id} poll>
      {(s) => <SessionDetails s={s} organizer={organizer} />}
    </Loading>
  );
}

/**
 * `/live/{id}/room`: the built-in room on the learner's side. Being here counts as attendance (a heartbeat a minute);
 * learners ask questions, chat, raise a hand, vote in polls, accept a stage invite and follow the host into breakout
 * rooms. All of it is the room's server state, re-read every 4 seconds (`useRoomFeed`), so the host's moderation —
 * hidden messages, the pin, slow mode, the lock, mute, remove — reaches the learner within seconds.
 */
export function LiveRoom({ id }: { id: string }) {
  return (
    <Loading id={id} poll>
      {(s) => <Room s={s} />}
    </Loading>
  );
}

/** Seconds left before slow mode lets the learner post again (from the server's `retry_after`). */
function useCountdown() {
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [until]);
  const left = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
  const start = (seconds: number) => {
    setNow(Date.now());
    setUntil(Date.now() + seconds * 1000);
  };
  return { left, start };
}

function Room({ s }: { s: LiveSession }) {
  const t = useTranslations('live');
  const id = useId();
  const toast = useToast();
  const live = s.status === 'live';
  const builtIn = s.provider === 'built_in';
  const feedQuery = useRoomFeed(s.id, live && builtIn && s.going);
  const feed = feedQuery.data;
  const removed = isRemoved(feedQuery.error);
  const actions = useRoomActions(s.id);
  const [question, setQuestion] = useState('');
  const [message, setMessage] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const slow = useCountdown();
  const breakout = feed?.me.breakout ?? null;
  const onStage = feed?.me.stage === 'on_stage';
  // The video rejoins with a fresh token when the learner moves (stage, breakout room): the token decides what they
  // may send and which Daily room they're in.
  const videoKey = breakout ? `breakout:${breakout.id}` : onStage ? 'stage' : 'audience';
  // A unique join link carries its registrant's token (`?t=`): sent along so the room opens only for them.
  const getToken = useCallback(
    () => (breakout ? fetchBreakoutToken(s.id) : fetchRoomToken(s.id, new URLSearchParams(window.location.search).get('t'))),
    [breakout, s.id],
  );

  useEffect(() => {
    if (!live || !s.going || removed) return;
    void sendPresence(s.id);
    const timer = setInterval(() => void sendPresence(s.id), 60_000);
    return () => clearInterval(timer);
  }, [live, s.going, s.id, removed]);

  if (!builtIn)
    return (
      <div className={styles.card}>
        <p>{t('notBuiltIn')}</p>
        <Link href={routes.live(s.id)} className="btn btn-primary" style={{ marginTop: 12 }}>
          {t('backToSession')}
        </Link>
      </div>
    );
  if (!s.going)
    return (
      <div className={styles.card}>
        <p>{t('rsvpFirst')}</p>
        <Link href={routes.live(s.id)} className="btn btn-primary" style={{ marginTop: 12 }}>
          {t('backToSession')}
        </Link>
      </div>
    );
  if (removed)
    return (
      <div className={styles.card} role="alert">
        <p>{feedQuery.error instanceof ApiError ? feedQuery.error.message : t('room.removed')}</p>
        <Link href={routes.live(s.id)} className="btn btn-outline" style={{ marginTop: 12 }}>
          {t('backToSession')}
        </Link>
      </div>
    );

  const sendQuestion = (e: SyntheticEvent) => {
    e.preventDefault();
    const text = question.trim();
    if (!text) return;
    actions.question.mutate(text, {
      onSuccess: () => {
        setQuestion('');
        toast(t('questionSent'));
      },
      onError: (err) => toast(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : t('sendError')),
    });
  };
  const sendChat = (e: SyntheticEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text) return;
    setChatError(null);
    actions.chat.mutate(text, {
      onSuccess: () => {
        setMessage('');
        if (feed && feed.moderation.slowModeSec > 0) slow.start(feed.moderation.slowModeSec);
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 429) {
          const wait = Number(err.details.retryAfter);
          if (Number.isFinite(wait) && wait > 0) slow.start(wait);
        }
        setChatError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : t('sendError'));
      },
    });
  };
  const locked = !!feed?.moderation.chatLocked;
  const muted = !!feed?.me.muted;
  const chatBlocked = locked || muted || slow.left > 0;
  const broadcast = breakout ? [...(feed?.chat ?? [])].reverse().find((m) => m.kind === 'broadcast') : undefined;

  return (
    <div className={styles.room}>
      <header className={styles.roomHead}>
        <h1 className="h1-sm">{s.title}</h1>
        <p className={styles.badge} data-status={s.status} role="status">
          {t(`status.${s.status}`)}
        </p>
      </header>
      {feed?.me.stage === 'invited' && (
        <div className={styles.banner} role="alert">
          <p>{t('room.stageInvite')}</p>
          <div className={styles.actions}>
            <button type="button" className="btn btn-primary" disabled={actions.stage.isPending} onClick={() => actions.stage.mutate(true)}>
              {t('room.stageAccept')}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={actions.stage.isPending}
              onClick={() => actions.stage.mutate(false)}
            >
              {t('room.stageDecline')}
            </button>
          </div>
        </div>
      )}
      {onStage && (
        <div className={styles.banner} role="status">
          <p>{t('room.onStage')}</p>
          <button type="button" className="btn btn-outline" disabled={actions.stage.isPending} onClick={() => actions.stage.mutate(false)}>
            {t('room.leaveStage')}
          </button>
        </div>
      )}
      {breakout && (
        <div className={styles.banner} role="status">
          <p>{t('room.inBreakout', { name: breakout.name })}</p>
          {broadcast && (
            <p>
              <b>{t('room.broadcastFrom', { who: broadcast.who })}</b> {broadcast.message}
            </p>
          )}
        </div>
      )}
      {feed?.pinned && (
        <p className={styles.pinned} role="status">
          <span aria-hidden="true">{t('room.pinIcon')} </span>
          <b>{feed.pinned.kind === 'announcement' ? t('room.announcement') : feed.pinned.who}</b> {feed.pinned.message}
        </p>
      )}
      {!live ? (
        <p className={styles.card}>{s.status === 'ended' ? t('endedNote') : t('notLiveYet')}</p>
      ) : (
        <DailyRoom key={videoKey} title={s.title} getToken={getToken} />
      )}
      {live && (
        <div className={styles.roomGrid}>
          <section className={styles.card} aria-labelledby={`${id}-c`}>
            <h2 id={`${id}-c`} className="h3">
              {t('chatTitle')}
            </h2>
            <ChatLog sessionId={s.id} feed={feed} />
            {(locked || muted || (feed?.moderation.slowModeSec ?? 0) > 0) && (
              <p className={styles.meta} role="status">
                {muted
                  ? t('room.muted')
                  : locked
                    ? t('room.locked')
                    : slow.left > 0
                      ? t('room.slowWait', { seconds: slow.left })
                      : t('room.slowOn', { seconds: feed?.moderation.slowModeSec ?? 0 })}
              </p>
            )}
            <form className={styles.form} onSubmit={sendChat}>
              <label className="sr-only" htmlFor={`${id}-ct`}>
                {t('chatLabel')}
              </label>
              <input
                id={`${id}-ct`}
                className="input"
                maxLength={500}
                value={message}
                disabled={locked || muted}
                onChange={(e) => setMessage(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={actions.chat.isPending || chatBlocked}>
                {t('send')}
              </button>
            </form>
            {chatError && (
              <p className={styles.error} role="alert">
                {chatError}
              </p>
            )}
          </section>
          <section className={styles.card} aria-labelledby={`${id}-q`}>
            <h2 id={`${id}-q`} className="h3">
              {t('askTitle')}
            </h2>
            <form className={styles.form} onSubmit={sendQuestion}>
              <label className="sr-only" htmlFor={`${id}-qt`}>
                {t('askLabel')}
              </label>
              <textarea
                id={`${id}-qt`}
                className="textarea"
                rows={3}
                maxLength={500}
                value={question}
                disabled={muted}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={actions.question.isPending || muted}>
                {t('ask')}
              </button>
            </form>
            {feed && (
              <button
                type="button"
                className="btn btn-outline"
                aria-pressed={feed.me.handRaised}
                disabled={actions.hand.isPending}
                onClick={() => actions.hand.mutate(!feed.me.handRaised)}
              >
                {feed.me.handRaised ? t('lowerHand') : t('raiseHand')}
              </button>
            )}
          </section>
          {feed?.polls.map((p) => (
            <PollCard
              key={p.id}
              poll={p}
              pending={actions.vote.isPending}
              onVote={(option) =>
                actions.vote.mutate(
                  { poll: p.id, option },
                  {
                    onError: (err) => toast(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : t('sendError')),
                  },
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Earlier chat pages re-read while shown: the most recently loaded ones (each re-read is one request). */
const REREAD_PAGES = 5;

interface ChatPage {
  /** The cursor this page was loaded with: re-reads use it, so they don't shift as new messages arrive. */
  before: string;
  messages: RoomChatMessage[];
  nextCursor: string | null;
}

/** The conversation: the feed's latest messages, plus older pages on demand. */
function ChatLog({ sessionId, feed }: { sessionId: string; feed: RoomFeed | undefined }) {
  const t = useTranslations('live');
  const f = useFormat();
  // Loaded pages, newest first (pages[0] was loaded first, right before the live feed).
  const [pages, setPages] = useState<ChatPage[]>([]);
  const [loading, setLoading] = useState(false);
  const pagesRef = useRef<ChatPage[]>([]);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  // Earlier pages are re-read every 30 s while shown, so a message the host hides (or deletes) after the learner
  // scrolled back to it disappears there too, not only from the live feed. Only the last REREAD_PAGES loaded pages,
  // each from its own stored cursor (older chat has its own rate-limit bucket on the API).
  const loaded = pages.length;
  useEffect(() => {
    if (loaded === 0) return undefined;
    let live = true;
    const reread = async () => {
      const targets = pagesRef.current.slice(-REREAD_PAGES);
      const fresh = new Map<string, ChatPage>();
      for (const p of targets) {
        const page = await fetchRoomChat(sessionId, p.before);
        fresh.set(p.before, { before: p.before, messages: page.messages, nextCursor: page.nextCursor });
      }
      if (live) setPages((prev) => prev.map((p) => fresh.get(p.before) ?? p));
    };
    const timer = setInterval(() => void reread().catch(() => undefined), 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [loaded, sessionId]);
  if (!feed) return <div className="skeleton" style={{ height: 80 }} />;
  const oldest = pages[pages.length - 1];
  const next = oldest ? oldest.nextCursor : feed.chatCursor;
  const seen = new Set(feed.chat.map((m) => m.id));
  const older: RoomChatMessage[] = [];
  for (const p of [...pages].reverse()) {
    for (const m of p.messages) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        older.push(m);
      }
    }
  }
  const rows = [...older, ...feed.chat];
  const loadEarlier = async () => {
    if (!next) return;
    setLoading(true);
    try {
      const page = await fetchRoomChat(sessionId, next);
      setPages((ps) => [...ps, { before: next, messages: page.messages, nextCursor: page.nextCursor }]);
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      {next && (
        <button type="button" className="link-btn" disabled={loading} onClick={() => void loadEarlier()}>
          {t('room.loadEarlier')}
        </button>
      )}
      {rows.length === 0 ? (
        <p className={styles.meta}>{t('room.noMessages')}</p>
      ) : (
        <ul className={styles.chat} aria-label={t('room.chatLog')} aria-live="polite">
          {rows.map((m) => (
            <li key={m.id} data-kind={m.kind} data-mine={m.mine || undefined}>
              <b>{m.kind === 'message' ? m.who : t(`room.kind.${m.kind}`)}</b> <span>{m.message}</span>{' '}
              <time className={styles.time} dateTime={m.createdAt}>
                {f.dateTime(m.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PollCard({ poll, pending, onVote }: { poll: RoomPoll; pending: boolean; onVote: (option: number) => void }) {
  const t = useTranslations('live');
  const id = useId();
  const voted = poll.myVote !== null;
  const showResults = voted || poll.status === 'closed';
  return (
    <section className={styles.card} aria-labelledby={`${id}-p`}>
      <h2 id={`${id}-p`} className="h3">
        {poll.status === 'closed' ? t('room.pollClosed') : t('pollTitle')}
      </h2>
      <fieldset className={styles.poll} disabled={voted || poll.status === 'closed' || pending}>
        <legend className={styles.meta}>{poll.question}</legend>
        {poll.options.map((o, i) => {
          const pct = poll.totalVotes ? Math.round((o.votes / poll.totalVotes) * 100) : 0;
          return (
            <label key={o.label} className="option">
              <input type="radio" className="sr-only" name={`${id}-o`} checked={poll.myVote === i} onChange={() => onVote(i)} />
              <span className="radio-dot" aria-hidden="true" />
              <span style={{ flex: 1 }}>{o.label}</span>
              {showResults && <span className={styles.meta}>{t('room.pollShare', { pct, votes: o.votes })}</span>}
              {showResults && (
                <span
                  className={styles.bar}
                  role="progressbar"
                  aria-label={o.label}
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${pct}%` }} />
                </span>
              )}
            </label>
          );
        })}
      </fieldset>
      <p className={styles.meta}>{voted ? t('room.voted', { count: poll.totalVotes }) : t('room.votes', { count: poll.totalVotes })}</p>
    </section>
  );
}
