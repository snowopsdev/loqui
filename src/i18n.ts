import i18n, { type BackendModule, type ResourceLanguage } from "i18next";
import { initReactI18next } from "react-i18next";
import { PROMPTS_BY_LOCALE } from "./locales/prompts";
import { EN_TRANSLATION, hasTranslationLoader, loadTranslation } from "./locales/translations";

export const SUPPORTED_UI_LANGUAGES = [
  "en",
  "ar",
  "es",
  "fr",
  "de",
  "pt",
  "it",
  "ru",
  "ja",
  "zh-CN",
  "zh-TW",
] as const;
export type UiLanguage = (typeof SUPPORTED_UI_LANGUAGES)[number];

export function normalizeUiLanguage(language: string | null | undefined): UiLanguage {
  const candidate = (language || "").trim();

  // Check full language-region code first (e.g. "zh-CN", "zh-TW")
  const normalized = candidate.replace(/_/g, "-");
  const fullMatch = SUPPORTED_UI_LANGUAGES.find(
    (lang) => lang.toLowerCase() === normalized.toLowerCase()
  );
  if (fullMatch) return fullMatch;

  // Keep in sync with src/helpers/i18nMain.js. Chinese is the only UI language
  // that is not the primary subtag; OS/browser tags must map onto zh-CN/zh-TW.
  const lower = normalized.toLowerCase();
  if (lower === "zh" || lower.startsWith("zh-")) {
    const parts = lower.split("-");
    if (parts.some((part) => part === "hant" || part === "tw" || part === "hk" || part === "mo")) {
      return "zh-TW";
    }
    return "zh-CN";
  }

  // Fall back to base language code (e.g. "en" from "en-US")
  const base = lower.split("-")[0] as UiLanguage;
  if (SUPPORTED_UI_LANGUAGES.includes(base)) {
    return base;
  }

  return "en";
}

// Prompts are small (~5 KB per locale) and resolved synchronously for any
// locale (see config/prompts), so every locale's prompts stay bundled. UI
// translations are ~250 KB per locale: only English ships eagerly as the
// fallback and the rest load on demand through the backend below.
const resources: Record<string, ResourceLanguage> = Object.fromEntries(
  SUPPORTED_UI_LANGUAGES.map((lng) => [lng, { prompts: PROMPTS_BY_LOCALE[lng] }])
);
resources.en = { translation: EN_TRANSLATION, prompts: PROMPTS_BY_LOCALE.en };

// i18next calls read() for any (language, namespace) pair it has no bundle
// for, and changeLanguage() resolves only after it completes, so a language
// switch never renders untranslated keys.
const lazyTranslationBackend: BackendModule = {
  type: "backend",
  init() {},
  read(language, namespace, callback) {
    if (namespace !== "translation" || !hasTranslationLoader(language)) {
      callback(null, {});
      return;
    }
    loadTranslation(language).then(
      (bundle) => callback(null, bundle),
      (error: Error) => callback(error, false)
    );
  },
};

const browserLanguage =
  typeof navigator !== "undefined" ? navigator.language || navigator.languages?.[0] : undefined;

const storageLanguage =
  typeof window !== "undefined" ? window.localStorage?.getItem("uiLanguage") : undefined;

/**
 * The UI language this window starts in. i18n.language stays unset until its
 * bundle loads, so startup code reads this instead of falling back to "en".
 */
export const initialUiLanguage: UiLanguage = normalizeUiLanguage(
  storageLanguage || browserLanguage || "en"
);

/** Resolves once the initial UI language bundle is loaded. */
export const i18nReady: Promise<unknown> = i18n
  .use(lazyTranslationBackend)
  .use(initReactI18next)
  .init({
    resources,
    partialBundledLanguages: true,
    lng: initialUiLanguage,
    fallbackLng: "en",
    ns: ["translation", "prompts"],
    defaultNS: "translation",
    interpolation: {
      escapeValue: false,
    },
    returnEmptyString: true,
    returnNull: false,
    // Never suspend: renderApp already waits for i18nReady, and a locale chunk
    // that fails to load must fall back to bundled English rather than throw a
    // promise outside any Suspense boundary.
    react: { useSuspense: false },
  });

export default i18n;
