'use client';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api/client';
import { Markdown } from '@/lib/markdown';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { previewKeys, previewLessonPath, PreviewProvider } from '../previewContext';
import type { PreviewLesson, PreviewSession, PreviewSimulation } from '../types';
import { LessonBlocks } from './LessonBlocks';
import { CompletionStatus, LiveLesson, LockIcon } from './LessonStatus';
import { Sidebar } from './Player';
import styles from './Player.module.css';
import previewStyles from './PreviewPlayer.module.css';
import { VideoPlayer } from './VideoPlayer';

/**
 * The staff preview (course builder O7, `/preview/{token}`): the real player — outline, video, blocks, interactive
 * checks — for a virtual learner, framed by the course builder. Everything here stays inside the preview: links go to
 * `/preview/{token}?lesson=…`, nothing is reported (the `PreviewProvider` turns the player's playback/time hooks off and
 * points checks and sorting at the stateless preview API), continue gates open client-side, and the account UI is
 * replaced by a note in the top bar. The lesson comes from the server render; the browser only ever calls
 * `/api/v1/preview/{token}/…` (lib/api/client.ts refuses anything else on a preview page).
 */
export function PreviewPlayer({ token, session, lesson }: { token: string; session: PreviewSession; lesson: PreviewLesson | null }) {
  const t = useTranslations('preview');
  const now = Date.parse(session.simulation.now);
  return (
    <PreviewProvider token={token}>
      <div className={previewStyles.shell}>
        <PreviewBar simulation={session.simulation} expiresAt={session.expiresAt} />
        <div className={styles.wrap}>
          <Sidebar
            course={session.course}
            currentId={lesson?.id ?? null}
            preview={{ href: (id) => routes.preview(token, id), now: Number.isFinite(now) ? now : undefined }}
          />
          <div className={styles.main}>
            {lesson ? (
              <PreviewLessonView key={lesson.id} token={token} initial={lesson} />
            ) : (
              <p className="alert" role="status">
                {t('lessonMissing')}
              </p>
            )}
          </div>
        </div>
      </div>
    </PreviewProvider>
  );
}

/** "Preview · Day 3 · Working copy", when the link expires, and the note that stands in for the account UI. */
export function PreviewBar({ simulation, expiresAt }: { simulation: PreviewSimulation; expiresAt: string }) {
  const t = useTranslations('preview');
  const f = useFormat();
  return (
    <div className={previewStyles.bar} role="region" aria-label={t('label')}>
      <p className={previewStyles.barTitle}>{t('bar', { day: simulation.day, content: simulation.content })}</p>
      <p className={previewStyles.barMeta}>
        {/* The viewer's zone: the server render's time may differ from the browser's. */}
        <time dateTime={expiresAt} suppressHydrationWarning>
          {t('expires', { time: f.dateTime(expiresAt) })}
        </time>
      </p>
      <p className={previewStyles.barNote}>{t('note')}</p>
    </div>
  );
}

/** Above a lesson learners can't open yet (locked lessons stay viewable in preview). `text` is the API's sentence. */
export function PreviewLockBanner({ text }: { text: string }) {
  const t = useTranslations('preview');
  return (
    <p className={previewStyles.lock} role="note">
      <LockIcon className={previewStyles.lockIcon} />
      <span>{t('locked', { text })}</span>
    </p>
  );
}

/** Where a quiz or an assignment would be: they can't be taken in preview. */
export function PreviewAssessmentNotice() {
  const t = useTranslations('preview');
  return (
    <p className={`alert ${previewStyles.notice}`} role="note">
      {t('assessment')}
    </p>
  );
}

function PreviewLessonView({ token, initial }: { token: string; initial: PreviewLesson }) {
  const t = useTranslations('player');
  const tp = useTranslations('preview');
  const f = useFormat();
  // The server render's lesson seeds the cache: checks, sorting and continue gates patch it (api.ts).
  const { data: lesson } = useQuery({
    queryKey: previewKeys.lesson(token, initial.id),
    queryFn: () => api.get<PreviewLesson>(previewLessonPath(token, initial.id)),
    initialData: initial,
    staleTime: Infinity,
  });
  const completion = lesson.completion;
  const manual = completion ? completion.rule === 'manual' : !(lesson.type === 'quiz' || !!lesson.scorm || !!lesson.assignment);
  const assessment = !!lesson.quiz || !!lesson.assignment;

  return (
    <article className={styles.lesson}>
      {lesson.previewLock && <PreviewLockBanner text={lesson.previewLock.text} />}
      {lesson.draft && (
        <p className={`alert ${previewStyles.notice}`} role="note">
          {tp('draftLesson')}
        </p>
      )}
      {lesson.video && (
        // No playback reports in preview (VideoPlayer's report hook is off under PreviewProvider too).
        <VideoPlayer
          video={lesson.video}
          title={lesson.title}
          durationSeconds={lesson.durationSeconds}
          completed={false}
          reportLessonId={null}
        />
      )}
      {lesson.live && <LiveLesson lessonId={lesson.id} live={lesson.live} />}
      {lesson.pdf && (
        <div className={styles.pdf}>
          <span className={styles.pdfIcon} aria-hidden="true">
            PDF
          </span>
          <div style={{ flex: 1 }}>
            <p className={styles.pdfTitle}>{lesson.title}</p>
            <p className={styles.pdfMeta}>{t('pdfMeta', { size: f.bytes(lesson.pdf.sizeBytes) })}</p>
          </div>
          <a href={lesson.pdf.url} className="btn btn-primary" download>
            {t('download')}
          </a>
        </div>
      )}
      {assessment && <PreviewAssessmentNotice />}
      {lesson.scorm && (
        <p className={`alert ${previewStyles.notice}`} role="note">
          {tp('scorm')}
        </p>
      )}

      <div className={styles.titleRow}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className={styles.module}>{lesson.moduleTitle}</p>
          <h1 className={styles.title} tabIndex={-1}>
            {lesson.title}
          </h1>
        </div>
        {manual ? (
          // What learners see; completing is a learner action, so it does nothing here.
          <button type="button" className="btn btn-lg btn-primary" disabled>
            {t('markComplete')}
          </button>
        ) : (
          completion && <CompletionStatus completion={completion} lesson={lesson} />
        )}
        {lesson.nextLessonId && (
          <Link prefetch={false} href={routes.preview(token, lesson.nextLessonId)} className="btn btn-outline btn-lg">
            {t('next')}
          </Link>
        )}
      </div>
      {lesson.blocks ? (
        <LessonBlocks blocks={lesson.blocks} lessonTitle={lesson.title} lessonId={lesson.id} blocksLocked={lesson.blocksLocked ?? 0} />
      ) : lesson.bodyHtml ? (
        // Rendered from Markdown by the API with raw HTML stripped and unsafe links dropped.
        <div className={`rich-text ${styles.desc}`} dangerouslySetInnerHTML={{ __html: lesson.bodyHtml }} />
      ) : (
        <p className={styles.desc}>{lesson.description}</p>
      )}
      {lesson.assignment && lesson.assignment.brief !== lesson.description && (
        <section className={styles.section} aria-labelledby="brief-h">
          <h2 id="brief-h" className={styles.sectionTitle}>
            {tp('assignmentBrief')}
          </h2>
          <Markdown source={lesson.assignment.brief} breaks images={false} headingLevel={3} className="rich-text" />
        </section>
      )}
      {lesson.link && (
        <p>
          <a href={lesson.link.url} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
            {t('openLink', { title: lesson.title })}
          </a>
        </p>
      )}
      {lesson.resources.length > 0 && (
        <section className={styles.section} aria-labelledby="res-t">
          <h2 id="res-t" className={styles.sectionTitle}>
            {t('resources', { count: lesson.resources.length })}
          </h2>
          <ul className={styles.resources}>
            {lesson.resources.map((r) => (
              <li key={r.id}>
                <a href={r.url} className={styles.resource} download>
                  <span className={styles.resKind} data-kind={r.kind}>
                    {t(`resourceKinds.${r.kind}`)}
                  </span>
                  {r.name} · {f.bytes(r.sizeBytes)}
                  <span aria-hidden="true">↓</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
