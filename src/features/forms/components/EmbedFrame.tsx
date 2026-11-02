'use client';
import { useEffect, useRef } from 'react';
import { embedContext } from '../logic';
import { LeadForm } from './LeadForm';
import styles from './LeadForm.module.css';

/** The protocol between the embed frame and `/embed/forms.js` on the embedding page (docs/api/forms.md). */
export type EmbedMessage =
  { type: 'resize'; height: number } | { type: 'submitted'; submission: string } | { type: 'redirect'; url: string };

/**
 * Posts to the embedding page — only to the `origin` it named, and only when that is a bare http(s) origin. Without
 * one (opened directly, or a bad value) the frame never posts: no `*` target, so nothing leaks to an unknown parent.
 */
export function postToParent(form: string, message: EmbedMessage, search: string = window.location.search): boolean {
  const target = embedContext(search).origin;
  if (!target || window.parent === window) return false;
  window.parent.postMessage({ source: 'coursiva-form', v: 1, form, ...message }, target);
  return true;
}

/**
 * `/embed/forms/{id}`: the form alone, on a transparent page, sized by its parent. Hidden fields read the embedding
 * page's URL, referrer and campaign parameters (forwarded in the query by the script); its height, submissions and
 * redirects go to the parent by postMessage.
 */
export function EmbedFrame({ formId }: { formId: string }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = -1;
    const report = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      postToParent(formId, { type: 'resize', height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [formId]);

  return (
    <div ref={box} className={styles.embed}>
      {/* The embedding page shows through (the page's own background is the site's). */}
      <style dangerouslySetInnerHTML={{ __html: 'html,body{background:transparent}' }} />
      <LeadForm
        formId={formId}
        variant="embed"
        getContext={() => embedContext(window.location.search)}
        // Like the `coursiva:lead` event: only for stored submissions (a honeypot answer has no id).
        onSubmitted={(r) => {
          if (r.submissionId !== null) postToParent(formId, { type: 'submitted', submission: r.submissionId });
        }}
        redirect={(url) => postToParent(formId, { type: 'redirect', url })}
      />
    </div>
  );
}
