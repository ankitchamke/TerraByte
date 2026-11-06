import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
  type LanguageOption,
} from "./types";
import { en, type TranslationDictionary } from "./dictionaries/en";
import { hi } from "./dictionaries/hi";
import { mr } from "./dictionaries/mr";

const DICTIONARIES: Record<SupportedLanguage, TranslationDictionary> = {
  en,
  hi,
  mr,
};

interface I18nContextValue {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  languages: LanguageOption[];
  t: (key: string, params?: Record<string, string | number | undefined | null>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getNestedValue(obj: any, path: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

function interpolate(template: string, params?: Record<string, string | number | undefined | null>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = params[key];
    return val != null ? String(val) : `{${key}}`;
  });
}

function getInitialLanguage(): SupportedLanguage {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY) as SupportedLanguage | null;
    if (saved && (saved === "en" || saved === "hi" || saved === "mr")) {
      return saved;
    }
    const navLang = (navigator.language || "").toLowerCase();
    if (navLang.startsWith("mr")) return "mr";
    if (navLang.startsWith("hi")) return "hi";
  } catch {
    // Ignore localStorage access failures
  }
  return DEFAULT_LANGUAGE;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>(getInitialLanguage);

  const setLanguage = useCallback((lang: SupportedLanguage) => {
    setLanguageState(lang);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
        document.documentElement.lang = lang;
      } catch {
        // Ignore
      }
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
    }
  }, [language]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number | undefined | null>): string => {
      const activeDict = DICTIONARIES[language] || DICTIONARIES.en;
      let val = getNestedValue(activeDict, key);
      if (val === undefined && language !== "en") {
        val = getNestedValue(DICTIONARIES.en, key);
      }
      if (val === undefined) {
        return key;
      }
      return interpolate(val, params);
    },
    [language]
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      languages: SUPPORTED_LANGUAGES,
      t,
    }),
    [language, setLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fail-safe fallback when used outside provider (e.g. testing)
    return {
      language: DEFAULT_LANGUAGE,
      setLanguage: () => {},
      languages: SUPPORTED_LANGUAGES,
      t: (key: string, params?: Record<string, string | number | undefined | null>) => {
        const val = getNestedValue(DICTIONARIES.en, key) ?? key;
        return interpolate(val, params);
      },
    };
  }
  return ctx;
}

export { SUPPORTED_LANGUAGES, type SupportedLanguage, type LanguageOption };
