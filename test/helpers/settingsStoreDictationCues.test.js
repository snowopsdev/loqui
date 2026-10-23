const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

for (const initialStorage of [
  {},
  { dictationCueSet: "classic", dictationCueVolume: "high" },
  { dictationCueSet: "bad", dictationCueVolume: "LOUD" },
]) {
  test(`cue settings initialize, normalize setters and real peer storage events: ${JSON.stringify(initialStorage)}`, async (t) => {
    const listeners = {};
    const { window, storage } = installBrowserGlobals(t, {
      initialStorage,
      window: {
        addEventListener: (name, cb) => {
          listeners[name] = cb;
        },
      },
    });
    const vite = await createRendererServer(t, { cachePrefix: "loqui-cue-settings-" });
    const { useSettingsStore, initializeSettings } = await vite.ssrLoadModule(
      "/stores/settingsStore.ts"
    );
    const state = () => useSettingsStore.getState();
    assert.equal(
      state().dictationCueSet,
      initialStorage.dictationCueSet === "classic" ? "classic" : "soft"
    );
    assert.equal(
      state().dictationCueVolume,
      initialStorage.dictationCueVolume === "high" ? "high" : "medium"
    );
    state().setDictationCueSet("classic");
    state().setDictationCueVolume("low");
    assert.equal(storage.getItem("dictationCueSet"), "classic");
    assert.equal(state().dictationCueVolume, "low");
    state().setDictationCueSet("invalid");
    state().setDictationCueVolume(null);
    assert.equal(state().dictationCueSet, "soft");
    assert.equal(storage.getItem("dictationCueVolume"), "medium");
    // No main API: initialize only installs renderer listeners; all storage is Map-backed.
    window.electronAPI = undefined;
    await initializeSettings();
    assert.equal(typeof listeners.storage, "function");
    const deliver = (key, newValue, storageArea = storage) =>
      listeners.storage({ key, newValue, storageArea });
    deliver("dictationCueSet", "classic");
    deliver("dictationCueVolume", "high");
    assert.equal(state().dictationCueSet, "classic");
    assert.equal(state().dictationCueVolume, "high");
    deliver("dictationCueSet", "unsupported");
    deliver("dictationCueVolume", "bad");
    assert.equal(state().dictationCueSet, "soft");
    assert.equal(state().dictationCueVolume, "medium");
    deliver("dictationCueSet", "classic");
    deliver("dictationCueVolume", "low");
    deliver("dictationCueSet", null);
    deliver("dictationCueVolume", null);
    assert.equal(state().dictationCueSet, "soft");
    assert.equal(state().dictationCueVolume, "medium");
    deliver("dictationCueSet", "classic", {});
    assert.equal(state().dictationCueSet, "soft");
    assert.equal(window.localStorage, storage);
    assert.equal(storage.getItem("dictationCueSet"), "soft", "peer events don't rewrite storage");
  });
}
