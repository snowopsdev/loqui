const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// Non-English UI bundles load lazily. These tests hold that load open (or fail
// it) to pin what the window does in between: keep the detected language and
// render bundled English instead of suspending.
const CONTROLLED_TRANSLATIONS = `
  import en from "/locales/en/translation.json";
  export const EN_TRANSLATION = en;
  export const hasTranslationLoader = () => true;
  export const loadTranslation = (locale) =>
    locale === "en" ? Promise.resolve(en) : globalThis.__localeGate.promise;
`;

const LOCALE_PROBE = `
  import React from "react";
  import { useTranslation } from "react-i18next";
  export function LocaleProbe() {
    const { t } = useTranslation();
    return React.createElement("span", null, t("common.loading"));
  }
`;

function installLocaleGate(t) {
  const gate = {};
  gate.promise = new Promise((resolve, reject) => {
    gate.resolve = resolve;
    gate.reject = reject;
  });
  globalThis.__localeGate = gate;
  t.after(() => delete globalThis.__localeGate);
  return gate;
}

function installNavigatorLanguage(t, language) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language, languages: [language] },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  });
}

async function loadRenderer(t, cachePrefix) {
  return createRendererServer(t, {
    cachePrefix,
    mockModules: {
      "/locales/translations": CONTROLLED_TRANSLATIONS,
      "/__localeProbe": LOCALE_PROBE,
    },
  });
}

test("a fresh non-English locale is not replaced by English while its bundle loads", async (t) => {
  installNavigatorLanguage(t, "de-DE");
  const gate = installLocaleGate(t);
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getDictionary: async () => [],
        getUiLanguage: async () => "",
        setDictionary: async () => ({ success: true }),
      },
    },
  });
  const vite = await loadRenderer(t, "loqui-lazy-locale-startup-");
  const i18nModule = await vite.ssrLoadModule("/i18n.ts");
  const { initializeSettings, useSettingsStore } = await vite.ssrLoadModule(
    "/stores/settingsStore.ts"
  );

  assert.equal(i18nModule.initialUiLanguage, "de");
  assert.equal(useSettingsStore.getState().uiLanguage, "de", "store starts in the pending locale");

  const hydrated = initializeSettings();
  gate.resolve(require("../../src/locales/de/translation.json"));
  await hydrated;

  assert.equal(useSettingsStore.getState().uiLanguage, "de");
  assert.equal(i18nModule.default.language, "de");
  assert.equal(localStorage.getItem("uiLanguage"), null, "the detected locale stays implicit");
});

test("a pending or failed locale load renders bundled English instead of suspending", async (t) => {
  installNavigatorLanguage(t, "fr-FR");
  const gate = installLocaleGate(t);
  installBrowserGlobals(t);
  const vite = await loadRenderer(t, "loqui-lazy-locale-fallback-");
  const { i18nReady } = await vite.ssrLoadModule("/i18n.ts");
  const { LocaleProbe } = await vite.ssrLoadModule("/__localeProbe");

  // Suspending outside a Suspense boundary throws during a synchronous render.
  assert.equal(renderToStaticMarkup(createElement(LocaleProbe)), "<span>Loading...</span>");

  gate.reject(new Error("chunk failed to load"));
  await i18nReady.catch(() => {});
  assert.equal(renderToStaticMarkup(createElement(LocaleProbe)), "<span>Loading...</span>");
});
