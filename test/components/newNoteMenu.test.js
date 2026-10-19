const test = require("node:test");

// Explicit key-only fixture instance: no missing-instance warning, while
// assertions deliberately keep translation keys instead of product copy.
test.before(async () => {
  const i18n = require("i18next").createInstance();
  const { initReactI18next, setI18n } = await import("react-i18next");
  require("react-i18next").setI18n(i18n);
  setI18n(i18n);
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: {} } },
    initImmediate: false,
  });
});
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// The harness renders i18n keys verbatim (an explicit key-only i18next instance is initialized), so
// assertions match on the raw translation key rather than resolved copy. The dropdown
// primitives are stubbed so the menu's items render inline instead of into a portal.
async function renderMenu(t, { canCreateTeamSpace, withAssistant = true }) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-new-note-menu-test-",
    mockModules: {
      "/ui/dropdown-menu": `
        import { createElement } from "react";
        const passthrough = (props) => createElement("div", null, props.children);
        export const DropdownMenu = passthrough;
        export const DropdownMenuTrigger = passthrough;
        export const DropdownMenuContent = passthrough;
        export const DropdownMenuItem = passthrough;
        export const DropdownMenuSeparator = () => createElement("div", null);
      `,
      "/hooks/useCanCreateTeamSpace": `
        export const useCanCreateTeamSpace = () => globalThis.__canCreateTeamSpace === true;
      `,
      "/CreateSpaceDialog": `
        export default function CreateSpaceDialog() { return null; }
      `,
    },
  });
  globalThis.__canCreateTeamSpace = canCreateTeamSpace;
  t.after(() => {
    delete globalThis.__canCreateTeamSpace;
  });
  const mod = await vite.ssrLoadModule("/components/notes/NewNoteMenu.tsx");
  return renderToStaticMarkup(
    createElement(mod.default, {
      onNewNote: () => {},
      ...(withAssistant ? { onNewChat: () => {} } : {}),
    })
  );
}

test("the New note menu always offers a note and an assistant chat", async (t) => {
  const markup = await renderMenu(t, { canCreateTeamSpace: false });

  assert.match(markup, /notes\.list\.newNote/);
  assert.match(markup, /notes\.createMenu\.note/);
  assert.match(markup, /notes\.createMenu\.assistantChat/);
});

// The Chat tab disappears entirely when an org turns the assistant off, so the
// item that navigates there goes with it.
test("the New note menu hides the assistant chat when the assistant is off", async (t) => {
  const markup = await renderMenu(t, { canCreateTeamSpace: false, withAssistant: false });

  assert.doesNotMatch(markup, /notes\.createMenu\.assistantChat/);
  assert.match(markup, /notes\.createMenu\.note/);
});
