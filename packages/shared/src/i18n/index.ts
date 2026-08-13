import { en, type Catalogue, type MessageKey } from './en.js';

export { en };
export type { Catalogue, MessageKey };

/**
 * A catalogue in progress. Only English is complete; a partial translation
 * falls back key by key rather than showing a blank.
 */
export type PartialCatalogue = Partial<Catalogue>;

const catalogues = new Map<string, PartialCatalogue>([['en', en]]);

export function registerCatalogue(locale: string, catalogue: PartialCatalogue): void {
  catalogues.set(locale, catalogue);
}

/**
 * Resolves a key, with `{placeholder}` interpolation.
 *
 * Falls back to English, then to the key itself — a missing translation shows
 * something meaningful and greps cleanly, rather than rendering "undefined" at
 * a parent.
 */
export function translate(
  key: MessageKey,
  values?: Readonly<Record<string, string | number>>,
  locale = 'en',
): string {
  const template = catalogues.get(locale)?.[key] ?? en[key] ?? key;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/** Bind a locale once, at the top of a request or a React tree. */
export function translatorFor(locale: string) {
  return (key: MessageKey, values?: Readonly<Record<string, string | number>>): string =>
    translate(key, values, locale);
}
