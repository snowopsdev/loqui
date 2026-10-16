// react-i18next stub for Vite SSR renderer tests. noExternal makes Vite run
// the package through its plugin pipeline so the mock applies;
// initReactI18next keeps src/i18n.ts's i18n.use(...) working.
const T_KEYS = "(k) => k";
const T_WITH_OPTIONS = "(k, o) => (o ? `${k}${JSON.stringify(o)}` : k)";

function reactI18nextMock({ withOptions = false, t } = {}) {
  const fn = t ?? (withOptions ? T_WITH_OPTIONS : T_KEYS);
  return [
    `export const useTranslation = () => ({ t: ${fn}, i18n: { language: "en", dir: () => "ltr" } });`,
    'export const initReactI18next = { type: "3rdParty", init() {} };',
    "export const Trans = ({ children }) => children ?? null;",
  ].join("\n");
}

function withI18nMock(serverOptions = {}, mockOpts = {}) {
  const noExternal = Array.isArray(serverOptions.noExternal) ? serverOptions.noExternal : [];
  return {
    ...serverOptions,
    noExternal: [...noExternal, "react-i18next"],
    mockModules: {
      ...(serverOptions.mockModules ?? {}),
      "react-i18next": reactI18nextMock(mockOpts),
    },
  };
}

module.exports = { reactI18nextMock, withI18nMock };
