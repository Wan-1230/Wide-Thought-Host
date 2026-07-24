import { createContext, useContext } from "react";
import { zhCN, type TranslationKey } from "./zh-CN";
import { enUS } from "./en-US";

export type Locale = "zh-CN" | "en-US";

const translations: Record<Locale, Record<TranslationKey, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

let currentLocale: Locale = "zh-CN";

export function setLocale(locale: Locale) {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/** Translate a key using the current locale. */
export function t(key: TranslationKey): string {
  return translations[currentLocale]?.[key] ?? translations["zh-CN"][key] ?? key;
}

/** React context for locale-aware re-rendering. */
export const LocaleContext = createContext<Locale>("zh-CN");

/** Hook to get the translation function bound to the current locale. */
export function useI18n() {
  const locale = useContext(LocaleContext);
  const dict = translations[locale] ?? translations["zh-CN"];
  return {
    locale,
    t: (key: TranslationKey) => dict[key] ?? key,
  };
}

export { zhCN, enUS };
export type { TranslationKey };
