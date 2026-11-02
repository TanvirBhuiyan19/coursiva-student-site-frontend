import type { Page } from '@playwright/test';

/**
 * Replaces Daily (daily-js + Daily Prebuilt need the network and a platform key) with a local double before the page
 * loads: `createFrame` draws a labelled frame, `join` records the room URL and token on `window.__dailyJoins`, and the
 * test can fire Daily events with `window.__dailyEmit(name)`.
 */
export async function installDailyDouble(page: Page) {
  await page.addInitScript(() => {
    type Handler = (e?: unknown) => void;
    const w = window as unknown as {
      __DAILY_TEST_DOUBLE__: unknown;
      __dailyJoins: { url: string; token: string }[];
      __dailyEmit: (name: string) => void;
    };
    const handlers: Record<string, Handler> = {};
    w.__dailyJoins = [];
    w.__dailyEmit = (name) => handlers[name]?.();
    w.__DAILY_TEST_DOUBLE__ = {
      supportedBrowser: () => ({ supported: true }),
      createFrame(parent: HTMLElement) {
        const iframe = document.createElement('iframe');
        iframe.setAttribute('srcdoc', '<p>Daily test double</p>');
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        parent.appendChild(iframe);
        return {
          join: (o: { url: string; token: string }) => {
            w.__dailyJoins.push(o);
            setTimeout(() => handlers['joined-meeting']?.(), 0);
            return Promise.resolve({});
          },
          on: (name: string, handler: Handler) => {
            handlers[name] = handler;
          },
          destroy: () => {
            iframe.remove();
            return Promise.resolve();
          },
          iframe: () => iframe,
        };
      },
    };
  });
}
