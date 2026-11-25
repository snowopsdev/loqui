const i18next = require("i18next");

const SUPPORTED_UI_LANGUAGES = [
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
];

function normalizeUiLanguage(language) {
  const candidate = (language || "").trim();

  // Check full language-region code first (e.g. "zh-CN", "zh-TW")
  const normalized = candidate.replace(/_/g, "-");
  const fullMatch = SUPPORTED_UI_LANGUAGES.find(
    (lang) => lang.toLowerCase() === normalized.toLowerCase()
  );
  if (fullMatch) return fullMatch;

  // Chinese is the only UI language that is not the primary subtag. OS/browser
  // tags are zh-Hans-CN, zh-Hant-TW, zh-HK, zh_Hant_TW, or bare zh — none of
  // those equal zh-CN/zh-TW, and falling through to "zh" is not in the list.
  const lower = normalized.toLowerCase();
  if (lower === "zh" || lower.startsWith("zh-")) {
    const parts = lower.split("-");
    if (parts.some((part) => part === "hant" || part === "tw" || part === "hk" || part === "mo")) {
      return "zh-TW";
    }
    return "zh-CN";
  }

  // Fall back to base language code (e.g. "en" from "en-US")
  const base = lower.split("-")[0];
  return SUPPORTED_UI_LANGUAGES.includes(base) ? base : "en";
}

// Only English (the fallback) and the active UI language are loaded. Each
// translation bundle is ~250 KB of JSON, so requiring all 22 files at startup
// costs parse time and heap for languages the user never sees.
function readLocaleBundle(language, namespace) {
  return require(`../locales/${language}/${namespace}.json`);
}

function ensureLanguageLoaded(instance, language) {
  for (const namespace of ["translation", "prompts"]) {
    if (!instance.hasResourceBundle(language, namespace)) {
      instance.addResourceBundle(language, namespace, readLocaleBundle(language, namespace));
    }
  }
}

function buildInitialResources(language) {
  const resources = {};
  for (const lng of new Set(["en", language])) {
    resources[lng] = {
      translation: readLocaleBundle(lng, "translation"),
      prompts: readLocaleBundle(lng, "prompts"),
    };
  }
  return resources;
}

const i18nMain = i18next.createInstance();
const initialLanguage = normalizeUiLanguage(process.env.UI_LANGUAGE);

void i18nMain.init({
  initAsync: false,
  resources: buildInitialResources(initialLanguage),
  lng: initialLanguage,
  fallbackLng: "en",
  ns: ["translation", "prompts"],
  defaultNS: "translation",
  interpolation: {
    escapeValue: false,
  },
  returnEmptyString: false,
  returnNull: false,
});

function changeLanguage(language) {
  const normalized = normalizeUiLanguage(language);

  if (i18nMain.language !== normalized) {
    // Bundles load synchronously so callers observe the new language at once.
    ensureLanguageLoaded(i18nMain, normalized);
    void i18nMain.changeLanguage(normalized);
  }

  return normalized;
}

module.exports = {
  i18nMain,
  changeLanguage,
  normalizeUiLanguage,
  SUPPORTED_UI_LANGUAGES,
};
