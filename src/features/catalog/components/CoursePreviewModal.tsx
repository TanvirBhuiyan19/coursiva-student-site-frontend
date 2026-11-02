'use client';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { LessonBlocks } from '@/features/learning/components/LessonBlocks';
import { VideoPlayer } from '@/features/learning/components/VideoPlayer';
import { ApiError } from '@/lib/api/errors';
import { useFormat } from '@/lib/useFormat';
import { useCoursePreview } from '../api';
import type { CourseDetail, CoursePreview, LessonType, PreviewItem, PreviewSummary } from '../types';
import styles from './CourseDetail.module.css';

const ITEM_ICON: Record<LessonType, IconName> = { video: 'play', pdf: 'file', quiz: 'help', text: 'file', live: 'users' };

/**
 * The course's free previews: `previews`, else (an older API, or a page cached before it) every curriculum row flagged
 * `freePreview` — the same lessons, in the same order.
 */
export function previewItems(course: CourseDetail): PreviewItem[] {
  if (course.previews) return course.previews;
  return course.modules.flatMap((m) =>
    m.lessons
      .filter((l) => l.freePreview)
      .map((l) => ({ lessonId: l.id, title: l.title, type: l.type, durationSeconds: l.durationSeconds, posterUrl: null })),
  );
}

/** What the cover's "Preview this course" opens: the first video free preview, else the first free preview. */
export function coverPreviewId(course: CourseDetail): string | null {
  const items = previewItems(course);
  return (items.find((i) => i.type === 'video') ?? items[0])?.lessonId ?? null;
}

/**
 * The free-preview modal (Udemy pattern): the chosen lesson's player or viewer, and — with more than one free preview
 * — a "Free previews" list to switch between them. A native modal `<dialog>` (focus kept inside, Esc closes, focus
 * returns to the trigger); the list is a set of buttons (Tab, or ↑/↓ between them). Content mounts only while open:
 * opening or switching fetches that lesson's signed URLs, closing unmounts the player (stops playback, drops the URLs).
 */
export function CoursePreviewDialog({
  course,
  dialogRef,
  isOpen,
  initialLessonId,
  onClose,
  footer,
  enrolCta,
}: {
  course: CourseDetail;
  dialogRef: RefObject<HTMLDialogElement | null>;
  isOpen: boolean;
  initialLessonId: string | null;
  onClose: () => void;
  /** The footer's call to action (EnrollCta), or null when enrolled. */
  footer: ReactNode;
  /** The "Enrol to take this" button under a quiz, assignment or live lesson's summary, or null when enrolled. */
  enrolCta: ReactNode;
}) {
  const t = useTranslations('course');
  const titleId = useId();
  const items = previewItems(course);
  const [selected, setSelected] = useState<string | null>(initialLessonId);
  // Each opening starts on the lesson its trigger names (state adjusted while rendering, not in an effect).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) setSelected(initialLessonId);
  }
  const current = items.find((i) => i.lessonId === selected) ?? items[0] ?? null;
  const listed = items.length > 1;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- backdrop click; <dialog> handles Esc natively
    <dialog
      ref={dialogRef}
      className={styles.previewDialog}
      data-listed={listed || undefined}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current.close();
      }}
    >
      <div className={styles.previewHead}>
        <div className={styles.previewHeadText}>
          <p className={styles.previewKicker}>{t('coursePreview')}</p>
          <h2 id={titleId} className={styles.previewTitle}>
            {course.title}
          </h2>
        </div>
        <button type="button" className={styles.previewClose} onClick={() => dialogRef.current?.close()} aria-label={t('closePreview')}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className={styles.previewBody}>
        {isOpen && current && (
          // Not keyed by lesson: the list stays mounted (and keeps focus) while the stage and sheet switch lessons.
          <PreviewLesson
            course={course}
            item={current}
            enrolCta={enrolCta}
            list={listed ? <PreviewList items={items} current={current.lessonId} onSelect={setSelected} /> : null}
          />
        )}
      </div>
      <div className={styles.previewFoot}>
        <span>{t('previewCta', { count: course.lessonCount })}</span>
        {footer}
      </div>
    </dialog>
  );
}

/** The "Free previews" list: one button per lesson, the current one marked; ↑/↓ move between them. */
function PreviewList({ items, current, onSelect }: { items: PreviewItem[]; current: string | null; onSelect: (id: string) => void }) {
  const t = useTranslations('course');
  const tc = useTranslations('common');
  const f = useFormat();
  const headingId = useId();
  const list = useRef<HTMLUListElement>(null);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = buttons.indexOf(e.currentTarget);
    const next = buttons[(at + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };
  return (
    <nav className={styles.previewList} aria-labelledby={headingId}>
      <div className={styles.previewListHead}>
        <h3 id={headingId} className={styles.previewListTitle}>
          {t('freePreviews')}
        </h3>
        <span className={styles.previewListCount}>{t('previewSampleCount', { count: items.length })}</span>
      </div>
      <ul ref={list}>
        {items.map((i) => {
          const mins = i.durationSeconds ? Math.max(1, Math.round(i.durationSeconds / 60)) : 0;
          const on = i.lessonId === current;
          return (
            <li key={i.lessonId}>
              <button
                type="button"
                className={styles.previewItem}
                aria-current={on ? 'true' : undefined}
                onClick={() => onSelect(i.lessonId)}
                onKeyDown={onKey}
              >
                <span
                  className={styles.previewThumb}
                  data-type={i.type}
                  style={i.posterUrl ? { backgroundImage: `url(${JSON.stringify(i.posterUrl)})` } : undefined}
                  aria-hidden="true"
                >
                  <Icon name={ITEM_ICON[i.type]} size={16} />
                </span>
                <span className={styles.previewItemText}>
                  <span className={styles.previewItemTitle}>{i.title}</span>
                  <span className={styles.previewItemMeta}>
                    {on ? t('nowPlaying') : tc(`lessonTypes.${i.type}`)}
                    {on && <span className="sr-only"> · {tc(`lessonTypes.${i.type}`)}</span>}
                  </span>
                </span>
                {mins > 0 && <span className={styles.previewItemDur}>{f.duration(mins)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * One preview, always in the same order: the stage (the video, or for a document its reading sheet), what's playing,
 * the free previews list, then a video lesson's notes. Stage and sheet are keyed by lesson, so switching remounts the
 * player (stops playback, drops the old signed URLs) while the list stays put.
 */
function PreviewLesson({
  course,
  item,
  enrolCta,
  list,
}: {
  course: CourseDetail;
  item: PreviewItem;
  enrolCta: ReactNode;
  list: ReactNode;
}) {
  const t = useTranslations('course');
  const tc = useTranslations('common');
  const f = useFormat();
  const id = item.lessonId;
  const preview = useCoursePreview(course.slug, id);
  const data = preview.data;
  const seconds = data ? data.durationSeconds : item.durationSeconds;
  const mins = seconds ? Math.max(1, Math.round(seconds / 60)) : 0;

  const sheet =
    data && hasPanel(data) ? (
      // A labelled region; it doesn't scroll on its own — the dialog body does (one scrollbar).
      <div
        key={`sheet-${id}`}
        className={styles.previewBlocks}
        data-full={!data.video || undefined}
        role="region"
        aria-label={t('previewContent')}
      >
        <PreviewPanel data={data} enrolCta={enrolCta} />
      </div>
    ) : null;

  let stage: ReactNode;
  if (!data) {
    const staged = item.type === 'video';
    const poster = item.posterUrl ?? course.preview?.posterUrl;
    const posterStyle = staged && poster ? { backgroundImage: `url(${JSON.stringify(poster)})` } : undefined;
    // 404: not a preview (any more). 401/403: the site lock or members-only answer, worded by the API. Neither changes
    // on a retry; anything else (network, 5xx, 429) can.
    const err = preview.error instanceof ApiError ? preview.error : null;
    const final = err?.status === 404 ? t('noPreview') : err && (err.status === 401 || err.status === 403) ? err.message : null;
    stage = (
      <div key={`state-${id}`} className={staged ? styles.previewVideo : styles.previewPanelState}>
        {preview.isPending ? (
          <div className={styles.previewState} style={posterStyle} role="status">
            <span className={styles.previewSpinner} aria-hidden="true" />
            <span className="sr-only">{t('previewLoading')}</span>
          </div>
        ) : (
          <div className={styles.previewState} style={posterStyle}>
            <p className={styles.previewMessage} role="alert">
              {final ?? t('previewFailed')}
            </p>
            {final === null && (
              <button type="button" className="btn btn-white btn-sm" disabled={preview.isFetching} onClick={() => void preview.refetch()}>
                {tc('retry')}
              </button>
            )}
          </div>
        )}
      </div>
    );
  } else if (data.video) {
    stage = (
      <div key={`video-${id}`} className={styles.previewVideo}>
        <VideoPlayer
          // A guest preview: no playback reports, no progress bar.
          video={{ ...data.video, posterUrl: data.video.posterUrl ?? data.posterUrl }}
          title={data.title}
          durationSeconds={data.durationSeconds}
          reportLessonId={null}
          autoStart
          className={styles.previewPlayer}
        />
      </div>
    );
  } else {
    stage = sheet;
  }

  return (
    <div className={styles.previewLesson}>
      {stage}
      <div className={styles.previewNow}>
        <span className={styles.previewNowKicker}>
          <Icon name={ITEM_ICON[item.type]} size={13} />
          {t('nowPlaying')} · {tc(`lessonTypes.${item.type}`)}
          {mins > 0 && <> · {f.duration(mins)}</>}
        </span>
        <h3 className={styles.previewNowTitle}>{data?.title ?? item.title}</h3>
      </div>
      {list}
      {data?.video ? sheet : null}
    </div>
  );
}

const hasPanel = (d: CoursePreview) => !!(d.blocks?.length || d.bodyHtml || d.pdf || d.file || d.link || d.summary || d.resources?.length);

function PreviewPanel({ data, enrolCta }: { data: CoursePreview; enrolCta: ReactNode }) {
  const t = useTranslations('course');
  const f = useFormat();
  return (
    <div className={styles.previewPanel}>
      {data.summary && <PreviewSummaryCard summary={data.summary} enrolCta={enrolCta} />}
      {data.pdf && (
        <figure className={styles.previewPdf}>
          {/* An iframe (the site's CSP is `object-src 'none'`, so <object>/<embed> never render). View only: the
              browser viewer's toolbar (with its download button) is hidden — a deterrent, not protection. */}
          <iframe
            className={styles.previewPdfFrame}
            src={data.pdf.downloadable ? data.pdf.url : `${data.pdf.url}#toolbar=0`}
            title={t('previewPdf', { name: data.pdf.name })}
            referrerPolicy="no-referrer"
          />
          <figcaption className={styles.previewFile}>
            <span className={styles.previewFileText}>
              <span className={styles.previewFileName}>{data.pdf.name}</span>
              <span className={styles.previewFileMeta}>
                {f.bytes(data.pdf.sizeBytes)}
                {!data.pdf.downloadable && <> · {t('previewViewOnly')}</>}
              </span>
            </span>
            {data.pdf.downloadable && (
              <a href={data.pdf.url} className="btn btn-outline btn-sm" download={data.pdf.name}>
                <Icon name="download" size={14} />
                {t('previewDownload')}
                <span className="sr-only"> {data.pdf.name}</span>
              </a>
            )}
          </figcaption>
        </figure>
      )}
      {data.file && (
        <div className={styles.previewFile} data-standalone>
          <span className={styles.previewFileText}>
            <span className={styles.previewFileName}>{data.file.name}</span>
            <span className={styles.previewFileMeta}>
              {f.bytes(data.file.sizeBytes)}
              {!data.file.url && <> · {t('previewDownloadAfterEnrol')}</>}
            </span>
          </span>
          {data.file.url && (
            <a href={data.file.url} className="btn btn-primary btn-sm" download={data.file.name}>
              <Icon name="download" size={14} />
              {t('previewDownload')}
              <span className="sr-only"> {data.file.name}</span>
            </a>
          )}
        </div>
      )}
      {data.bodyHtml && (
        // Rendered from Markdown by the API with raw HTML stripped and unsafe links dropped.
        <div className="rich-text" dangerouslySetInnerHTML={{ __html: data.bodyHtml }} />
      )}
      {data.blocks && data.blocks.length > 0 && (
        // No lessonId: a guest preview — answers can't be checked and the first continue gate ends it.
        <LessonBlocks blocks={data.blocks} lessonTitle={data.title} blocksLocked={data.blocksLocked ?? 0} embedded />
      )}
      {data.link && /^https:\/\//i.test(data.link.url) && (
        <p>
          <a href={data.link.url} className="btn btn-primary btn-sm" target="_blank" rel="noopener noreferrer">
            {t('previewOpenLink', { title: data.title })}
          </a>
        </p>
      )}
      {data.resources && data.resources.length > 0 && (
        <ul className={styles.previewResources} aria-label={t('previewResources')}>
          {data.resources.map((r) => (
            <li key={r.id}>
              {r.url ? (
                <a href={r.url} download={r.name}>
                  {r.name} · {f.bytes(r.sizeBytes)}
                </a>
              ) : (
                <span>
                  {r.name} · {f.bytes(r.sizeBytes)} · {t('previewDownloadAfterEnrol')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A quiz, assignment, live or other gated lesson: what's inside, and "Enrol to take this". Never its questions. */
function PreviewSummaryCard({ summary: s, enrolCta }: { summary: PreviewSummary; enrolCta: ReactNode }) {
  const t = useTranslations('course');
  const f = useFormat();
  const facts = [
    s.questionCount !== null && t('previewFacts.questions', { count: s.questionCount }),
    s.passPercent !== null && t('previewFacts.pass', { percent: s.passPercent }),
    s.timeLimitMinutes !== null && t('previewFacts.timeLimit', { minutes: s.timeLimitMinutes }),
    s.attemptsAllowed !== null && t('previewFacts.attempts', { count: s.attemptsAllowed }),
    s.points !== null && t('previewFacts.points', { count: s.points }),
    s.startsAt !== null && t('previewFacts.startsAt', { date: f.dateTime(s.startsAt) }),
    s.durationMinutes !== null && t('previewFacts.duration', { minutes: s.durationMinutes }),
  ].filter((x): x is string => typeof x === 'string');
  return (
    <section className={styles.previewSummary} aria-label={t('previewInside')}>
      <p className={styles.previewSummaryKind}>
        <Icon name="lock" size={14} />
        {t(`previewKinds.${summaryKind(s.kind)}`)}
      </p>
      {facts.length > 0 && (
        <ul className={styles.previewFacts}>
          {facts.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      <p className={styles.previewEnrolNote}>{t('previewEnrolToTake')}</p>
      {enrolCta}
    </section>
  );
}

const SUMMARY_KINDS = ['quiz', 'assignment', 'survey', 'checkpoint', 'live', 'scorm', 'coaching'] as const;
const summaryKind = (k: string): (typeof SUMMARY_KINDS)[number] | 'other' => SUMMARY_KINDS.find((x) => x === k) ?? 'other';
