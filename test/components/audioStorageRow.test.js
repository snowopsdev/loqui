const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

async function render(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-audio-storage-row-"));
  const { AudioStorageRow } = await vite.ssrLoadModule("/components/settings/AudioStorageRow.tsx");
  return renderToStaticMarkup(
    createElement(AudioStorageRow, { clearError: false, onClear() {}, onRetry() {}, ...props })
  );
}

test("an unreadable store says so and offers Retry, never 'no audio'", async (t) => {
  const html = await render(t, { usage: { status: "unavailable" } });
  assert.match(html, /settingsPage\.privacy\.audioStorageUnavailable/);
  assert.doesNotMatch(html, /settingsPage\.privacy\.audioStorageEmpty/);
  assert.match(html, />common\.retry</);
  assert.doesNotMatch(html, /settingsPage\.privacy\.clearAllAudio</);
});

test("while checking, Clear is disabled and nothing claims the store is empty", async (t) => {
  const html = await render(t, { usage: { status: "loading" } });
  assert.match(html, /settingsPage\.privacy\.audioStorageChecking/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>settingsPage\.privacy\.clearAllAudio</);
});

test("a known count is shown and a failed clear raises an alert", async (t) => {
  const html = await render(t, {
    usage: { status: "known", fileCount: 3, totalBytes: 2_000_000 },
    clearError: true,
  });
  assert.match(html, /settingsPage\.privacy\.audioStorageFiles\(count=3,size=/);
  assert.match(html, /role="alert"[^>]*>settingsPage\.privacy\.clearAllAudioFailed/);
});
