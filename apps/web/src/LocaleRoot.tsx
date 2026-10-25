import type { ReactNode } from 'react';
import { I18nProvider } from 'react-aria-components';
import { locale } from '@oel/i18n';
// Chooses the platform (browser or desktop app) before any island renders.
import './platform';

/** Root of each client island: React Aria's own words (dismiss buttons, date fields…) in the interface language. */
export function LocaleRoot({ children }: { children: ReactNode }) {
  return <I18nProvider locale={locale()}>{children}</I18nProvider>;
}
