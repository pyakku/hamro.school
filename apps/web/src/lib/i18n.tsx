import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { translatorFor, type MessageKey } from '@hamro/shared';

/**
 * Every user-facing string in this app comes through `t()`.
 *
 * Not one English sentence is typed into a component. The catalogue lives in
 * packages/shared so the API can send the same keys, and adding Arabic later
 * is a file rather than an archaeology project.
 */

type Translator = (key: MessageKey, values?: Record<string, string | number>) => string;

const LocaleContext = createContext<{ locale: string; t: Translator }>({
  locale: 'en',
  t: translatorFor('en'),
});

export function LocaleProvider({ locale, children }: { locale: string; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: translatorFor(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT(): Translator {
  return useContext(LocaleContext).t;
}

export function useLocale(): string {
  return useContext(LocaleContext).locale;
}
