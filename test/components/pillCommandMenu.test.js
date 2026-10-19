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

// The harness renders i18n keys verbatim (an explicit key-only i18next instance is initialized),
// so assertions match on the raw translation key rather than resolved copy.
async function renderMenu(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-pill-command-menu-test-",
  });
  const mod = await vite.ssrLoadModule("/components/dictation/PillCommandMenu.tsx");
  return renderToStaticMarkup(
    createElement(mod.PillCommandMenu, {
      buttonRef: { current: null },
      isRecording: false,
      agentAllowed: true,
      meetingAllowed: true,
      isHovered: false,
      setWindowInteractivity: () => {},
      onToggleListening: () => {},
      onAskAssistant: () => {},
      onStartMeeting: () => {},
      onHide: () => {},
      onClose: () => {},
      ...props,
    })
  );
}

test("the command menu hides Ask Assistant while a recording is active", async (t) => {
  const idleMarkup = await renderMenu(t, { isRecording: false });
  assert.match(idleMarkup, /askAssistant/);

  const recordingMarkup = await renderMenu(t, { isRecording: true });
  assert.doesNotMatch(recordingMarkup, /askAssistant/);
});

test("the command menu offers a meeting recording only while idle and allowed", async (t) => {
  assert.match(await renderMenu(t, {}), /startMeetingRecording/);
  assert.doesNotMatch(await renderMenu(t, { isRecording: true }), /startMeetingRecording/);
  assert.doesNotMatch(await renderMenu(t, { meetingAllowed: false }), /startMeetingRecording/);
});
