const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const PERSONAL = { id: 1, kind: "private", name: "Personal", emoji: null };

async function renderOverview(t, space) {
  installBrowserGlobals(t);
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: { notes: { spaces: { changeEmoji: "Change emoji" } } } } },
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-space-emoji-",
    mockModules: {
      "/stores/noteStore": `
        export const useNotes = () => [];
        export const useNotesByContainer = () => ({});
        export const useFolders = () => [];
        export const useFolderCounts = () => ({});
        export const useSpaceRootCounts = () => ({});
        export const updateSpaceMeta = async () => ({ success: true });
      `,
      "/hooks/useContainerChat": "export const useContainerChat = () => ({});",
      "/ui/useToast": "export const useToast = () => ({ toast() {} });",
      "/OverviewExplainerBanner": "export const OverviewExplainerBanner = () => null;",
      "/OverviewAskSection": "export const OverviewAskSection = () => null;",
      "/OverviewNoteList": "export const OverviewNoteList = () => null;",
    },
  });
  const { I18nextProvider } = await vite.ssrLoadModule("react-i18next");
  const { ContainerOverview } = await vite.ssrLoadModule(
    "/components/notes/overview/ContainerOverview.tsx"
  );
  return renderToStaticMarkup(
    React.createElement(
      I18nextProvider,
      { i18n },
      React.createElement(ContainerOverview, {
        space,
        folder: null,
        onOpenNote: () => {},
        onNewNote: () => {},
      })
    )
  );
}

test("the Personal space icon is a button that opens the emoji picker", async (t) => {
  const html = await renderOverview(t, PERSONAL);
  assert.match(html, /<button[^>]*aria-label="Change emoji"[^>]*><svg/);
});

test("a chosen emoji replaces the Personal lock icon", async (t) => {
  const html = await renderOverview(t, { ...PERSONAL, emoji: "🚀" });
  assert.match(html, /<button[^>]*aria-label="Change emoji"[^>]*>.*🚀/);
});
