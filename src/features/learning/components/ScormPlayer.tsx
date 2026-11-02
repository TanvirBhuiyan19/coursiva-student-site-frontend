'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { camelize } from '@/lib/api/case';
import { api } from '@/lib/api/client';
import { afterProgress, learningKeys, patchLessonDone } from '../api';
import { ScormDataModel, scorm12Api, scorm2004Api } from '../scorm/runtime';
import type { Lesson, ScormCommitResult, ScormLaunch, ScormState } from '../types';
import styles from './Player.module.css';

/** Content tokens last 4 h (xAPI 8 h): relaunch a little before, after committing, so the package resumes. */
const RELAUNCH_AFTER_MS = 3.75 * 3600_000;
const COMMIT_EVERY_MS = 30_000;

interface RawLaunch {
  launch_url: string;
  standard: string;
  runtime: ScormLaunch['runtime'];
  version: number;
  tracking: string;
  cmi: Record<string, string> | null;
  state: unknown;
}

/**
 * The launch is read without case conversion: `cmi` is keyed by data-model element names. Only the envelope's own
 * fields are mapped by hand.
 */
async function fetchLaunch(lessonId: string): Promise<ScormLaunch> {
  const d = await api.raw<RawLaunch>('GET', `/me/lessons/${encodeURIComponent(lessonId)}/scorm`);
  return {
    launchUrl: d.launch_url,
    standard: d.standard,
    runtime: d.runtime,
    version: d.version,
    tracking: d.tracking,
    cmi: d.cmi,
    state: camelize<ScormState>(d.state),
  };
}

declare global {
  interface Window {
    API?: ReturnType<typeof scorm12Api>;
    API_1484_11?: ReturnType<typeof scorm2004Api>;
  }
}

/**
 * SCORM / xAPI lesson player (docs/scorm.md). Lazy-loaded: only SCORM lessons pay for it.
 *
 * SCORM 1.2 / 2004: the run-time API (`window.API` / `window.API_1484_11`) is installed on this page **before** the
 * package's iframe loads — the iframe is same-origin (`/api/v1/files/scorm/…` goes through the site's proxy), so the
 * package finds it on `window.parent`. Commits go to `PUT /me/lessons/{id}/scorm` (changed elements only), on the
 * package's `Commit`, every 30 s, and on `Finish`/`Terminate` or `pagehide` (`finish: true`, `keepalive`). The API
 * decides completion; its answer updates the sidebar.
 *
 * xAPI (Tin Can / cmi5): the launch URL carries the LRS endpoint and credentials, so the package talks to the LRS
 * itself; the player only refreshes the lesson's state.
 */
export default function ScormPlayer({ lesson }: { lesson: Lesson }) {
  const t = useTranslations('player');
  const qc = useQueryClient();
  const [launchNo, setLaunchNo] = useState(0);
  const [stale, setStale] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const modelRef = useRef<ScormDataModel | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // `GET …/scorm` counts a launch: fetch once per mount (or explicit relaunch), never in the background.
  const launch = useQuery({
    queryKey: ['learning', 'scorm', lesson.id, launchNo],
    queryFn: () => fetchLaunch(lesson.id),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const data = launch.data;
  const isScorm = data?.runtime === 'scorm12' || data?.runtime === 'scorm2004';

  // Install the run-time API, then point the iframe at the package — so the API exists before the package loads.
  useEffect(() => {
    const frame = frameRef.current;
    if (!data || !frame) return;
    if (!(data.runtime === 'scorm12' || data.runtime === 'scorm2004')) {
      frame.src = data.launchUrl;
      return;
    }
    let hiding = false;
    const commit = (changes: Record<string, string>, finish: boolean) => {
      api
        .raw<unknown>(
          'PUT',
          `/me/lessons/${encodeURIComponent(lesson.id)}/scorm`,
          { cmi: changes, finish },
          { keepalive: hiding || finish },
        )
        .then((raw) => {
          const r = camelize<ScormCommitResult>(raw);
          setSaveError(false);
          if (r.completed && !lesson.completed) patchLessonDone(qc, lesson.id, lesson.courseSlug, true);
          qc.setQueryData<Lesson>(learningKeys.lesson(lesson.id), (l) =>
            l?.scorm ? { ...l, completed: l.completed || r.completed, scorm: { ...l.scorm, state: r.state } } : l,
          );
          if (r.completed) afterProgress(qc, lesson.courseSlug);
        })
        .catch(() => setSaveError(true));
    };
    const model = new ScormDataModel(data.runtime === 'scorm12' ? '1.2' : '2004', data.cmi ?? {}, commit);
    modelRef.current = model;
    if (data.runtime === 'scorm12') window.API = scorm12Api(model);
    else window.API_1484_11 = scorm2004Api(model);
    frame.src = data.launchUrl;

    const timer = window.setInterval(() => {
      if (model.initialized && model.pending) model.flush(false);
    }, COMMIT_EVERY_MS);
    const onHide = () => {
      if (!model.initialized) return;
      hiding = true;
      model.flush(true);
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', onHide);
      // Leaving the lesson without Finish/Terminate: save what changed and close the session.
      if (model.initialized && !hiding) {
        hiding = true;
        model.flush(true);
      }
      delete window.API;
      delete window.API_1484_11;
      modelRef.current = null;
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps -- one runtime per launch

  // Long sessions: the content token expires after 4 h — offer a relaunch shortly before.
  useEffect(() => {
    if (!data) return;
    const timer = window.setTimeout(() => setStale(true), RELAUNCH_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [data]);

  // xAPI: the package reports to the LRS; pick up completion while it is open and when leaving.
  useEffect(() => {
    if (!data || isScorm) return;
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: learningKeys.lesson(lesson.id) });
      afterProgress(qc, lesson.courseSlug);
    };
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.clearInterval(timer);
      refresh();
    };
  }, [data, isScorm, lesson.id, lesson.courseSlug, qc]);

  const state = lesson.scorm?.state;
  return (
    <section className={styles.scorm} aria-label={t('scormLabel', { standard: lesson.scorm?.standard ?? '' })}>
      <div className={styles.scormHead}>
        <span className="tag tag-soft">{lesson.scorm?.standard}</span>
        <span className={styles.scormState} role="status">
          {state?.completed ? t('scormDone') : state ? t('scormInProgress') : t('scormNotStarted')}
        </span>
      </div>
      {stale && (
        <div className="alert" role="status">
          {t('scormStale')}{' '}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              modelRef.current?.flush(false);
              setStale(false);
              setLaunchNo((n) => n + 1);
            }}
          >
            {t('scormRelaunch')}
          </button>
        </div>
      )}
      {saveError && (
        <p className="alert alert-bad" role="alert">
          {t('scormSaveFailed')}
        </p>
      )}
      {launch.isError ? (
        <div className="alert alert-bad" role="alert">
          {t('scormLaunchFailed')}{' '}
          <button type="button" className="link-btn" onClick={() => setLaunchNo((n) => n + 1)}>
            {t('retry')}
          </button>
        </div>
      ) : data ? (
        // `src` is set by the effect above, once the run-time API is installed.
        <iframe
          key={launchNo}
          ref={frameRef}
          className={styles.scormFrame}
          title={lesson.title}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          allow="fullscreen; autoplay"
          allowFullScreen
        />
      ) : (
        <div className={`skeleton ${styles.scormFrame}`} />
      )}
    </section>
  );
}
