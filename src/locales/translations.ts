import enTranslation from "./en/translation.json";

// Locales differ in shape (plural forms vary by language), so bundles are
// typed structurally rather than as the English bundle.
export type TranslationBundle = Record<string, unknown>;

// English ships in the entry chunk as the fallback. Every other locale is its
// own lazily loaded chunk (~250 KB each), fetched only when it becomes active.
// Plain import() (not import.meta.glob) keeps this module loadable outside Vite.
export const EN_TRANSLATION: TranslationBundle = enTranslation;

type TranslationModule = { default: TranslationBundle };

const LAZY_TRANSLATIONS: Record<string, () => Promise<TranslationModule>> = {
  ar: () => import("./ar/translation.json"),
  de: () => import("./de/translation.json"),
  es: () => import("./es/translation.json"),
  fr: () => import("./fr/translation.json"),
  it: () => import("./it/translation.json"),
  ja: () => import("./ja/translation.json"),
  pt: () => import("./pt/translation.json"),
  ru: () => import("./ru/translation.json"),
  "zh-CN": () => import("./zh-CN/translation.json"),
  "zh-TW": () => import("./zh-TW/translation.json"),
};

export function hasTranslationLoader(locale: string): boolean {
  return locale === "en" || Object.hasOwn(LAZY_TRANSLATIONS, locale);
}

export async function loadTranslation(locale: string): Promise<TranslationBundle> {
  if (locale === "en") return enTranslation;
  const loader = Object.hasOwn(LAZY_TRANSLATIONS, locale) ? LAZY_TRANSLATIONS[locale] : undefined;
  if (!loader) throw new Error(`No translation bundle for locale "${locale}"`);
  const mod = await loader();
  return mod.default;
}
