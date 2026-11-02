'use client';
import { useSyncExternalStore } from 'react';
import { consentSnapshot, onConsentChange, serverSnapshot, type ConsentSnapshot } from './store';

const subscribe = (cb: () => void) => onConsentChange(() => cb());

/** The visitor's consent, live (server render and hydration: not ready, nothing granted). */
export function useConsent(): ConsentSnapshot {
  return useSyncExternalStore(subscribe, consentSnapshot, serverSnapshot);
}
