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
 * Picks the plural form for a count, using the locale's own rules.
 *
 * When `values.count` is present, a key may carry variants — `key.one`,
 * `key.other`, and in some languages `key.few`, `key.many`, `key.two`,
 * `key.zero`. `Intl.PluralRules` chooses; the bare key is the fallback, so a
 * message that does not care about plurals needs no variants at all.
 *
 * Doing this properly now rather than writing "1 guardians" and fixing it later
 * is the point: English hides the problem behind two forms, and Arabic — which
 * this product is sold into — has six. A catalogue built on string
 * concatenation cannot be retrofitted into one that pluralises.
 */
function resolveTemplate(
  key: MessageKey,
  locale: string,
  values?: Readonly<Record<string, string | number>>,
): string | undefined {
  const catalogue = catalogues.get(locale);
  const lookup = (candidate: string): string | undefined =>
    (catalogue as Record<string, string> | undefined)?.[candidate] ??
    (en as Record<string, string>)[candidate];

  const count = values?.count;
  if (typeof count === 'number') {
    let category: string;
    try {
      category = new Intl.PluralRules(locale).select(count);
    } catch {
      category = new Intl.PluralRules('en').select(count);
    }
    const plural = lookup(`${key}.${category}`);
    if (plural !== undefined) return plural;
  }

  return lookup(key);
}

/**
 * Resolves a key, with `{placeholder}` interpolation and plural selection.
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
  const template = resolveTemplate(key, locale, values) ?? key;
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
