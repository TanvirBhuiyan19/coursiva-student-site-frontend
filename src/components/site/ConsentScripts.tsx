'use client';
import { useEffect } from 'react';
import { markInjected } from '@/features/consent/tracking';
import { useConsent } from '@/features/consent/useConsent';
import type { GatedHeadElement } from '@/lib/headCode';

/** Elements already added to <head> on this page (the layout persists across client navigations). */
const done = new Set<string>();
let queue: Promise<void> = Promise.resolve();

/** Whether any of the school's gated head code was added to this document (it keeps running across navigations). */
export const ranSchoolCode = () => done.size > 0;

const keyOf = (el: GatedHeadElement, i: number) => `${i}:${el.tag}:${el.attrs.src ?? el.attrs.href ?? el.content.length}`;

/**
 * Adds one element of the school's head code to <head> as a real element (React never runs scripts it renders on the
 * client). A classic external script (no `async`/`defer`) is waited for before the next element, so inline code that
 * uses it runs after it, as it would in the page's HTML.
 */
function inject(el: GatedHeadElement): Promise<void> {
  const node = document.createElement(el.tag);
  for (const [name, value] of Object.entries(el.attrs)) {
    if (name === 'data-consent') continue;
    // The common "type=text/plain + data-consent" pattern for consent-gated tags: run it as a normal script.
    if (name === 'type' && el.tag === 'script' && value === 'text/plain') continue;
    node.setAttribute(name, value);
  }
  node.dataset.coursivaConsent = el.consent;
  if (el.tag === 'script' || el.tag === 'style') node.textContent = el.content;
  const blocking = el.tag === 'script' && !!el.attrs.src && !('async' in el.attrs) && !('defer' in el.attrs);
  if (!blocking) {
    document.head.append(node);
    return Promise.resolve();
  }
  (node as HTMLScriptElement).async = false;
  return new Promise((resolve) => {
    node.addEventListener('load', () => resolve(), { once: true });
    node.addEventListener('error', () => resolve(), { once: true });
    document.head.append(node);
  });
}

/**
 * The school's consent-gated head code (docs/consent.md): each element is added once the visitor allows its category
 * (`data-consent`, default marketing), in the order the school wrote them. Nothing is added before the site has set
 * the consent mode, on a declined category, or under Global Privacy Control for marketing.
 */
export function ConsentScripts({ elements }: { elements: GatedHeadElement[] }) {
  const consent = useConsent();
  useEffect(() => {
    if (!consent.ready) return;
    elements.forEach((el, i) => {
      const key = keyOf(el, i);
      if (!consent[el.consent] || done.has(key)) return;
      done.add(key);
      markInjected(el.consent);
      queue = queue.then(() => inject(el));
    });
  }, [consent, elements]);
  return null;
}
