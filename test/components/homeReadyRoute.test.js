const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { mountComponent } = require("../helpers/harness/mountComponent");

// Full-app I1: after "Finish later" the workspace must not say Ready over a
// dictation route that still needs its model. The real HistoryView reads the
// real resolved dictationStt route; only route facts are fixtures.
const finishedLater = JSON.stringify({
  version: 2,
  step: "speech",
  explored: true,
  completed: false,
  visited: ["welcome", "speech"],
});
const LOCAL_WHISPER = {
  transcriptionMode: "local",
  useLocalWhisper: true,
  localTranscriptionProvider: "whisper",
  whisperModel: "base",
};

async function mountHome(t, installedWhisper) {
  const opened = [];
  const ui = await mountComponent(t, "/components/HistoryView.tsx", {
    storage: { "loqui.onboarding.progress": finishedLater },
    api: { getTranscriptions: async () => [], getNotes: async () => [] },
    props: {
      capture: { kind: "ready", source: null, startedAt: null, offlineReason: null },
      history: [],
      isLoading: false,
      hotkey: "Control+Super",
      aiCTADismissed: true,
      useCleanupModel: true,
      showDiscarded: false,
      setAiCTADismissed() {},
      copyToClipboard() {},
      deleteTranscription() {},
      clearAllTranscriptions() {},
      onOpenSettings: (section) => opened.push(section),
      onOpenIntegrations() {},
      onShowAudioInFolder() {},
      onRetryTranscription: async () => {},
      onToggleDiscarded() {},
    },
  });
  const { useSettingsStore } = await ui.vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteFactsStore } = await ui.vite.ssrLoadModule("/stores/routeFactsStore.ts");
  await React.act(async () => {
    useSettingsStore.setState(LOCAL_WHISPER);
    useRouteFactsStore.setState(({ facts }) => ({
      facts: {
        ...facts,
        installed: { ...facts.installed, whisper: installedWhisper },
      },
    }));
  });
  const strip = () => ui.byAttr("aria-label", "home.ready.region")[0];
  return { ui, strip, opened, useRouteFactsStore };
}

test("Finish later with no model: the strip asks to set up dictation, never Ready", async (t) => {
  const { ui, strip, opened } = await mountHome(t, new Set());
  assert.equal(strip().attributes["data-state"], "setUp");
  const text = strip().textContent;
  assert.match(text, /home\.ready\.setUp/);
  assert.doesNotMatch(text, /home\.ready\.ready|home\.ready\.press|home\.ready\.hold/);
  await ui.click("home.ready.setUp");
  assert.deepEqual(opened, ["stt/dictation"], "the action opens the route's settingsPath");
});

test("Finish later before main reports models: Checking…, then Ready once installed", async (t) => {
  const { ui, strip, useRouteFactsStore } = await mountHome(t, null);
  assert.equal(strip().attributes["data-state"], "checking");
  assert.match(strip().textContent, /routes\.state\.checking/);
  assert.doesNotMatch(strip().textContent, /home\.ready\.ready|home\.ready\.press/);
  await React.act(async () =>
    useRouteFactsStore.setState(({ facts }) => ({
      facts: { ...facts, installed: { ...facts.installed, whisper: new Set(["base"]) } },
    }))
  );
  assert.equal(strip().attributes["data-state"], "ready");
  assert.match(strip().textContent, /home\.ready\.ready/);
  assert.equal(ui.byAttr("aria-label", "home.ready.region").length, 1);
});
