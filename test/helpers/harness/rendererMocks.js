const path = require("node:path");

// react-i18next mock for Vite SSR renderer tests. Keys render verbatim so
// assertions match keys, not copy; interpolation options are appended as
// key(name=value,...) so they are visible too. initReactI18next, Trans and
// I18nextProvider exist because src/i18n.ts and a few components import them,
// and the module graph fails to load without them. It only applies with
// noExternal: ["react-i18next"], which rendererOptions sets.
const I18N_KEYS_MOCK = `
const format = (key, options) =>
  options
    ? key + "(" + Object.entries(options).map(([name, value]) => name + "=" + value).join(",") + ")"
    : key;
export const useTranslation = () => ({
  t: format,
  i18n: { language: "en", dir: () => globalThis.__i18nDir ?? "ltr" },
});
export const initReactI18next = { type: "3rdParty", init() {} };
export const Trans = ({ i18nKey }) => i18nKey;
export const I18nextProvider = ({ children }) => children;
`;

function rendererOptions(cachePrefix, mockModules = {}) {
  return {
    cachePrefix,
    noExternal: ["react-i18next"],
    resolveAlias: { "@": path.resolve(__dirname, "../../../src") },
    mockModules: { "react-i18next": I18N_KEYS_MOCK, ...mockModules },
  };
}

module.exports = { I18N_KEYS_MOCK, rendererOptions };
