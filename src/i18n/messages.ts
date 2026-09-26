import type en from '../../messages/en.json';

/**
 * UI message catalogues, one JSON file per language (and optionally per region) in /messages.
 *
 * Adding a language = add `messages/<lang>.json` (same keys as en.json; partial files are fine) and register it here.
 * Resolution for `pt-BR`: en → pt → pt-BR, deep-merged, so a missing key falls back to the nearest available
 * translation and finally English — a half-translated catalogue never breaks a page.
 */
export type Messages = typeof en;
type Catalog = Record<string, unknown>;

const catalogues: Record<string, () => Promise<{ default: Catalog }>> = {
  en: () => import('../../messages/en.json'),
  // es: () => import('../../messages/es.json'),
  // 'pt-BR': () => import('../../messages/pt-BR.json'),
};

/** Languages with a UI catalogue (tenant content languages can exist before their UI catalogue does). */
export const UI_LANGUAGES = Object.keys(catalogues);

function merge(base: Catalog, over: Catalog): Catalog {
  const out: Catalog = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' ? merge(b as Catalog, v as Catalog) : v;
  }
  return out;
}

export async function loadMessages(locale: string): Promise<Messages> {
  const chain = ['en', locale.split('-')[0]!.toLowerCase(), locale].filter((k, i, a) => a.indexOf(k) === i && k in catalogues);
  let messages: Catalog = {};
  for (const key of chain) messages = merge(messages, (await catalogues[key]!()).default);
  return messages as Messages;
}
