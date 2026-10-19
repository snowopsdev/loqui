const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent } = require("../helpers/harness/mountComponent");

const { listenerBus } = require("../helpers/harness/listenerBus");

const { MIGRATED_STORAGE } = require("../lib/routeStateFixture");

const PREVIEW = { step: "welcome", scenario: "ready", platform: "linux" };
const SETTINGS_PAGE = {
  "/SettingsPage": "export default function SettingsPage() { return null; }",
};

async function mountFlow(t, props = {}, options = {}) {
  const completed = [];
  const ui = await mountComponent(t, "/components/OnboardingFlow.tsx", {
    props: {
      onComplete: (opts) => completed.push(opts ?? null),
      previewConfig: PREVIEW,
      initialStep: "welcome",
      ...props,
    },
    mocks: SETTINGS_PAGE,
    ...options,
    storage: { ...MIGRATED_STORAGE, ...options.storage },
  });
  return { ui, completed: () => completed };
}

const primary = (ui) => ui.byAttr("data-onb-primary")[0];
const buttonWithText = (ui, text) =>
  ui.findAll((node) => node.tagName === "BUTTON" && node.textContent.includes(text))[0];
const currentStep = (ui) =>
  ui.byAttr("aria-current", "step")[0]?.attributes["aria-label"] ?? "ready";

// The footer primary when there is one. Say something has none (its band owns the
// next step), so the walk skips it. Ready ends through its own Open workspace (Task 18).
async function advance(ui) {
  const target =
    primary(ui) ??
    buttonWithText(ui, "setupFlow.skipStep") ??
    buttonWithText(ui, "setupFlow.ready.openWorkspace");
  await ui.click(target);
}

test("Continue walks both phases and completes once without accounts or implicit downloads", async (t) => {
  const { ui, completed } = await mountFlow(
    t,
    { initialStep: "welcome" },
    {
      api: voiceApi(["en-US"], { checkParakeetModelStatus: async () => ({ downloaded: true }) }),
    }
  );
  const seen = [];
  for (let guard = 0; guard < 8 && completed().length === 0; guard++) {
    if (currentStep(ui) === "ready") {
      assert.ok(ui.text().includes("setupFlow.privacy.historyTitle"));
      assert.ok(ui.text().includes("setupFlow.privacy.updatesTitle"));
    } else {
      assert.equal(ui.text().includes("setupFlow.privacy.historyTitle"), false);
    }
    seen.push(currentStep(ui));
    await advance(ui);
  }
  assert.deepEqual(seen, [
    "setupFlow.progress.goTo(step=setupFlow.steps.welcome)",
    "setupFlow.progress.goTo(step=setupFlow.steps.speech)",
    "setupFlow.progress.goTo(step=setupFlow.steps.try)",
    "setupFlow.progress.goTo(step=setupFlow.steps.cleanup)",
    "setupFlow.progress.goTo(step=setupFlow.steps.shortcuts)",
    "ready",
  ]);
  assert.equal(completed().length, 1);
  const accountish = ui.calls.filter(([name]) => /auth|signIn|login|account|cloud/i.test(name));
  assert.deepEqual(
    ui.calls.filter(([name]) => /^(download|start.*Download)/i.test(name)),
    []
  );
  assert.deepEqual(
    accountish,
    [],
    "setup never touches accounts (restores the old personalWorkspace check)"
  );
});

test("Finish later exits from any step and remembers where you were", async (t) => {
  const { ui, completed } = await mountFlow(t, { initialStep: "cleanup" });
  await ui.click("setupFlow.finishLater");
  assert.equal(completed().length, 1);
  const stored = JSON.parse(ui.storage.getItem("loqui.onboarding.preview.linux.ready"));
  assert.deepEqual([stored.step, stored.explored, stored.visited], ["cleanup", true, ["cleanup"]]);
});

test("Back goes to the previous step in the new order", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "cleanup" });
  await ui.click("setupFlow.back");
  assert.equal(currentStep(ui), "setupFlow.progress.goTo(step=setupFlow.steps.try)");
});

test("production ignores the preview config global and stores its own visited steps", async (t) => {
  const { ui } = await mountFlow(
    t,
    { initialStep: undefined, previewConfig: undefined },
    {
      api: { getPlatform: () => "linux" },
      windowProps: {
        loquiBrowserPreviewConfig: { step: "finish", scenario: "ready", platform: "macos" },
      },
    }
  );
  assert.equal(currentStep(ui), "setupFlow.progress.goTo(step=setupFlow.steps.welcome)");
  await advance(ui);
  const stored = JSON.parse(ui.storage.getItem("loqui.onboarding.progress"));
  assert.deepEqual(stored.visited, ["welcome", "speech"]);
  assert.equal(ui.byAttr("data-platform")[0].attributes["data-platform"], "linux");
  assert.equal(ui.byAttr("data-onb-announcer").length, 1, "one hoisted announcer");
});

test("Hello offers Look around first instead of a dead Back", async (t) => {
  const { ui, completed } = await mountFlow(t);
  assert.equal(ui.text().includes("setupFlow.back"), false);
  await ui.click("setupFlow.lookAroundFirst");
  assert.equal(completed().length, 1);
});

const React = require("react");

function mediaFixture(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis.navigator, "mediaDevices");
  const previousContext = globalThis.AudioContext;
  const opened = [],
    stopped = [];
  let inputs = [
    { kind: "audioinput", deviceId: "mbp", label: "MacBook Pro Microphone" },
    { kind: "audioinput", deviceId: "usb", label: "USB Mic" },
  ];
  const listeners = new Set();
  const media = {
    async getUserMedia(constraints) {
      opened.push(constraints);
      const number = opened.length;
      const deviceId = constraints.audio?.deviceId?.exact ?? "mbp";
      const track = {
        label: inputs.find((device) => device.deviceId === deviceId)?.label,
        stop: () => stopped.push(number),
      };
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    },
    enumerateDevices: async () => inputs,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  Object.defineProperty(globalThis.navigator, "mediaDevices", { configurable: true, value: media });
  globalThis.AudioContext = class {
    createAnalyser() {
      return { fftSize: 1024, getFloatTimeDomainData: (buf) => buf.fill(0), disconnect() {} };
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    close() {
      return Promise.resolve();
    }
  };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis.navigator, "mediaDevices", previous);
    else delete globalThis.navigator.mediaDevices;
    globalThis.AudioContext = previousContext;
  });
  return {
    opened,
    stopped,
    listeners,
    async devices(next) {
      inputs = next;
      await React.act(async () => {
        for (const listener of listeners) void listener();
      });
    },
  };
}

for (const boundary of ["absent", "undefined", "rejected"]) {
  test(`Hello never captures or grants when permission IPC is ${boundary}`, async (t) => {
    const media = mediaFixture(t);
    const method =
      boundary === "absent"
        ? undefined
        : boundary === "undefined"
          ? async () => undefined
          : async () => {
              throw new Error("unsupported");
            };
    const { ui } = await mountFlow(
      t,
      {},
      { api: { checkMicrophoneAccess: method, requestMicrophoneAccess: method } }
    );
    assert.equal(media.opened.length, 0);
    assert.equal(
      ui.calls.filter(([name]) => name === "requestMicrophoneAccess").length,
      0,
      "mount only observes permission"
    );
    await ui.click("setupFlow.hello.allowMic");
    assert.equal(media.opened.length, 0);
    assert.equal(ui.findAll((node) => node.tagName === "SELECT").length, 0);
    assert.ok(ui.text().includes("setupFlow.hello.allowMic"));
  });
}

test("Hello writes the existing dictation selection, follows replug/missing input, and releases on Get started", async (t) => {
  const media = mediaFixture(t);
  const { ui } = await mountFlow(
    t,
    {},
    {
      api: {
        checkMicrophoneAccess: async () => ({ granted: true }),
        requestMicrophoneAccess: undefined,
      },
      storage: { microphoneSelectionMode: "system" },
      windowProps: { clearInterval() {} },
    }
  );
  const { useSettingsStore } = await ui.vite.ssrLoadModule("/stores/settingsStore.ts");
  const pick = async (value) => {
    const [select] = ui.findAll((node) => node.tagName === "SELECT");
    await React.act(async () => ui.props(select).onChange({ target: { value } }));
  };
  assert.deepEqual(media.opened[0], { audio: true });
  await pick("usb");
  assert.deepEqual(media.opened.at(-1), { audio: { deviceId: { exact: "usb" } } });
  let settings = useSettingsStore.getState();
  assert.deepEqual(
    [
      settings.microphoneSelectionMode,
      settings.selectedMicDeviceId,
      settings.selectedMicDeviceLabel,
    ],
    ["specific", "usb", "USB Mic"]
  );
  await media.devices([
    { kind: "audioinput", deviceId: "usb-new", label: "USB Mic" },
    { kind: "audioinput", deviceId: "mbp", label: "MacBook Pro Microphone" },
  ]);
  assert.deepEqual(media.opened.at(-1), { audio: { deviceId: { exact: "usb-new" } } });
  await media.devices([{ kind: "audioinput", deviceId: "mbp", label: "MacBook Pro Microphone" }]);
  assert.deepEqual(media.opened.at(-1), { audio: true });
  assert.ok(ui.text().includes("setupFlow.hello.savedMicMissing"));
  await pick("__built-in__");
  assert.equal(useSettingsStore.getState().microphoneSelectionMode, "built-in");
  assert.deepEqual(media.opened.at(-1), { audio: { deviceId: { exact: "mbp" } } });
  await pick("__system__");
  assert.equal(useSettingsStore.getState().microphoneSelectionMode, "system");
  assert.deepEqual(media.opened.at(-1), { audio: true });
  await ui.click("setupFlow.hello.start");
  assert.equal(currentStep(ui), "setupFlow.progress.goTo(step=setupFlow.steps.speech)");
  assert.equal(media.listeners.size, 0);
  assert.deepEqual(
    media.stopped,
    media.opened.map((_, index) => index + 1)
  );
  assert.equal(
    ui.calls.some(([name]) => name === "requestMicrophoneAccess"),
    false
  );
});

test("Ready retains saved privacy/update defaults and writes each explicit toggle through its existing API", async (t) => {
  const preferences = [];
  const { ui } = await mountFlow(
    t,
    { initialStep: "finish" },
    {
      storage: { dataRetentionEnabled: "false" },
      api: {
        updates: {
          status: async () => ({ enabled: false }),
          preferences: async (patch) => preferences.push(patch),
        },
      },
    }
  );
  const { useSettingsStore } = await ui.vite.ssrLoadModule("/stores/settingsStore.ts");
  const [history, updates] = ui.byAttr("role", "switch");
  assert.equal(history.attributes["aria-label"], "setupFlow.privacy.historyTitle");
  assert.equal(history.attributes["aria-checked"], "false");
  assert.equal(updates.attributes["aria-checked"], "false");
  assert.deepEqual(preferences, [], "reading defaults is not a write");
  await ui.click(history);
  await ui.click(updates);
  assert.equal(useSettingsStore.getState().dataRetentionEnabled, true);
  assert.deepEqual(preferences, [{ enabled: true }]);
});

const LANGUAGE_SELECTOR_MOCK = `
import React from "react";
export default function LanguageSelector({ value, onChange }) {
  return React.createElement("select", { "data-language": "", value, onChange: (event) => onChange(event.target.value) });
}`;
const voiceApi = (locales, extra = {}) => ({
  getSystemProfile: async () => ({
    locales,
    freeDiskBytes: 5e11,
    gpu: { kind: "unknown", name: null },
  }),
  getTotalMemory: async () => 16e9,
  checkParakeetModelStatus: async () => ({ success: true, downloaded: false }),
  modelGetActiveDownloads: async () => [],
  downloadParakeetModel: () => new Promise(() => {}),
  ...extra,
});

test("viewing Voice writes nothing; its primary makes dictation local, even from self-hosted (I02)", async (t) => {
  const { ui } = await mountFlow(
    t,
    { initialStep: "speech" },
    {
      api: voiceApi(["es-ES", "en-US"]),
      storage: {
        transcriptionMode: "self-hosted",
        remoteTranscriptionUrl: "http://10.0.0.5:9000",
        meetingTranscriptionMode: "self-hosted",
        meetingUseLocalWhisper: "false",
        uploadTranscriptionMode: "providers",
        uploadUseLocalWhisper: "false",
        uploadCloudTranscriptionMode: "byok",
        uploadCloudTranscriptionProvider: "groq",
        uploadCloudTranscriptionModel: "whisper-large-v3",
      },
    }
  );
  await React.act(async () => {});
  const store = (await ui.vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore;
  assert.equal(
    store.getState().transcriptionMode,
    "self-hosted",
    "viewing has not committed dictation"
  );
  const otherRoutes = () =>
    Object.fromEntries(
      Object.entries(store.getState()).filter(
        ([key]) => /^(meeting|upload)/.test(key) && typeof store.getState()[key] !== "function"
      )
    );
  const before = otherRoutes();
  assert.equal(ui.storage.getItem("parakeetModel"), null);
  assert.equal(ui.calls.filter(([name]) => name === "downloadParakeetModel").length, 0);
  await ui.click(primary(ui));
  const settings = (
    await ui.vite.ssrLoadModule("/stores/settingsStore.ts")
  ).useSettingsStore.getState();
  assert.deepEqual(
    [
      settings.transcriptionMode,
      settings.useLocalWhisper,
      settings.localTranscriptionProvider,
      settings.parakeetModel,
    ],
    ["local", true, "nvidia", "orukeet-v0.1.0"]
  );
  assert.deepEqual(settings.spokenLanguages, ["es-ES", "en-US"]);
  assert.equal(
    settings.meetingTranscriptionMode,
    "self-hosted",
    "note recording keeps its own route"
  );
  assert.deepEqual(otherRoutes(), before, "every meeting/upload setting retains its own route");
  const { resolveTranscriptionRoute } = await ui.vite.ssrLoadModule(
    "/helpers/transcriptionRoute.ts"
  );
  assert.equal(
    resolveTranscriptionRoute({ settings }).transport,
    "local",
    "the real resolver no longer routes to the old server"
  );
  assert.deepEqual(
    ui.calls.filter(([name]) => name === "downloadParakeetModel"),
    [["downloadParakeetModel", "orukeet-v0.1.0"]]
  );
});

test("a supported secondary OS locale remains committable without manual language changes", async (t) => {
  const { ui } = await mountFlow(
    t,
    { initialStep: "speech" },
    { api: voiceApi(["he-IL", "fr-FR"]) }
  );
  await React.act(async () => {});
  await ui.click(ui.byAttr("aria-expanded", "false")[0]); // F09c: the compatible picker starts closed.
  assert.equal(ui.byAttr("aria-checked", "true")[0].attributes["data-value"], "orukeet-v0.1.0");
  assert.equal("disabled" in primary(ui).attributes, false);
  await ui.click(primary(ui));
  const settings = (
    await ui.vite.ssrLoadModule("/stores/settingsStore.ts")
  ).useSettingsStore.getState();
  assert.deepEqual(settings.spokenLanguages, ["fr-FR"]);
  assert.equal(settings.preferredLanguage, "fr-FR");
  assert.deepEqual(
    ui.calls.filter(([name]) => name === "downloadParakeetModel"),
    [["downloadParakeetModel", "orukeet-v0.1.0"]]
  );
});

test("a language change never leaves an incompatible voice committable (I03)", async (t) => {
  const { ui } = await mountFlow(
    t,
    { initialStep: "speech" },
    {
      api: voiceApi(["en-US"]),
      mocks: {
        "/SettingsPage": "export default function SettingsPage() { return null; }",
        "ui/LanguageSelector": LANGUAGE_SELECTOR_MOCK,
      },
    }
  );
  await React.act(async () => {});
  await ui.click(ui.byAttr("aria-expanded", "false")[0]);
  const choose = (value) =>
    React.act(async () => ui.props(ui.byAttr("data-language")[0]).onChange({ target: { value } }));
  await choose("ja-JP");
  assert.equal(
    ui.byAttr("aria-checked", "true")[0].attributes["data-value"],
    "nemotron-3.5-asr-streaming-0.6b"
  );
  assert.equal("disabled" in primary(ui).attributes, false);
  await choose("he-IL");
  assert.equal(ui.byAttr("aria-checked", "true").length, 0, "no voice is selected");
  assert.ok("disabled" in primary(ui).attributes);
  assert.equal(primary(ui).attributes["aria-describedby"], "onb-voice-blocked");
  await ui.click(primary(ui));
  assert.equal(
    ui.calls.filter(([name]) => name === "downloadParakeetModel").length,
    0,
    "nothing downloads or commits"
  );
});

test("language is locked while a transfer runs (I03)", async (t) => {
  const progress = listenerBus();
  const { ui } = await mountFlow(
    t,
    { initialStep: "speech" },
    {
      api: voiceApi(["en-US"], { onParakeetDownloadProgress: progress.subscribe }),
      mocks: {
        "/SettingsPage": "export default function SettingsPage() { return null; }",
        "ui/LanguageSelector": LANGUAGE_SELECTOR_MOCK,
      },
    }
  );
  await React.act(async () => {});
  await ui.click(primary(ui));
  await React.act(async () =>
    progress.emit(
      {},
      {
        type: "progress",
        model: "parakeet-unified-en-0.6b",
        percentage: 10,
        downloaded_bytes: 6e7,
        total_bytes: 6.31e8,
      }
    )
  );
  await ui.click("setupFlow.back");
  await ui.click(ui.byAttr("aria-expanded", "false")[0]);
  await React.act(async () =>
    ui.props(ui.byAttr("data-language")[0]).onChange({ target: { value: "ja-JP" } })
  );
  assert.equal(
    ui.byAttr("aria-checked", "true")[0].attributes["data-value"],
    "parakeet-unified-en-0.6b",
    "the flow ignores the change"
  );
  await ui.click(
    ui.byAttr("role", "radio").find((r) => r.attributes["data-value"] === "orukeet-v0.1.0")
  );
  assert.equal(
    ui.byAttr("aria-checked", "true")[0].attributes["data-value"],
    "parakeet-unified-en-0.6b",
    "busy model edits are ignored too"
  );
});

for (const mode of ["self-hosted", "providers"]) {
  test(`an installed candidate skipped with retained ${mode} dictation never admits a local trial (F04)`, async (t) => {
    const { ui } = await mountFlow(
      t,
      { initialStep: "speech", previewConfig: undefined },
      {
        api: voiceApi(["en-US"], { checkParakeetModelStatus: async () => ({ downloaded: true }) }),
        storage: {
          transcriptionMode: mode,
          remoteTranscriptionUrl: "http://10.0.0.5:9000",
          useLocalWhisper: "false",
        },
      }
    );
    assert.ok(ui.text().includes("setupFlow.voice.installed"));
    await ui.click("setupFlow.skipStep");
    assert.equal(buttonWithText(ui, "Start recording"), undefined);
    assert.equal(ui.text().includes("setupFlow.tour.readyTitle"), false);
    assert.ok(buttonWithText(ui, "setupFlow.tour.chooseVoice"));
    assert.equal(
      ui.calls.filter(([name]) => /beginOnboardingDemo|toggleDictation|startDictation/.test(name))
        .length,
      0
    );
    const settings = (
      await ui.vite.ssrLoadModule("/stores/settingsStore.ts")
    ).useSettingsStore.getState();
    assert.equal(settings.transcriptionMode, mode, "Skip never commits the candidate");
    await ui.click("setupFlow.skipStep"); // Try -> Cleanup
    await ui.click(primary(ui)); // Cleanup -> Shortcut
    await ui.click(primary(ui)); // Shortcut -> Ready
    assert.notEqual(ui.byAttr("data-status")[0].attributes["data-status"], "ready");
    assert.equal(ui.text().includes("setupFlow.ready.titleProven"), false);
    assert.equal(ui.text().includes("setupFlow.ready.subAllLocal"), false);
  });
}

test("installed and matching local settings still wait for Plan03 route facts", async (t) => {
  const { ui } = await mountFlow(
    t,
    { initialStep: "try", previewConfig: undefined },
    {
      api: voiceApi(["en-US"], {
        checkParakeetModelStatus: async () => ({ downloaded: true }),
        listParakeetModels: undefined,
        checkParakeetInstallation: undefined,
      }),
      storage: {
        transcriptionMode: "local",
        localTranscriptionProvider: "nvidia",
        parakeetModel: "parakeet-unified-en-0.6b",
        useLocalWhisper: "true",
      },
    }
  );
  assert.equal(buttonWithText(ui, "Start recording"), undefined);
  assert.equal(ui.calls.filter(([name]) => name === "beginOnboardingDemo").length, 0);
});

test("an installed matching voice admits the overlay trial only with actual ready route facts", async (t) => {
  const { ui } = await mountFlow(
    t,
    { initialStep: "speech", previewConfig: undefined },
    {
      api: voiceApi(["en-US"], {
        beginOnboardingDemo: async () => true,
        checkParakeetModelStatus: async () => ({ downloaded: true }),
        checkParakeetInstallation: async () => ({ supported: true }),
        listParakeetModels: async () => ({
          success: true,
          models: [{ model: "parakeet-unified-en-0.6b", downloaded: true }],
        }),
      }),
      storage: { transcriptionMode: "self-hosted", remoteTranscriptionUrl: "http://10.0.0.5:9000" },
    }
  );
  await ui.click(primary(ui));
  assert.ok(buttonWithText(ui, "setupFlow.try.useButton"));
  assert.equal(ui.calls.filter(([name]) => name === "beginOnboardingDemo").length, 1);
});

test("opening the picker and choosing a candidate write no voice settings or downloads", async (t) => {
  const { ui } = await mountFlow(
    t,
    { initialStep: "speech" },
    {
      api: voiceApi(["en-US"]),
      storage: { transcriptionMode: "self-hosted", remoteTranscriptionUrl: "http://10.0.0.5:9000" },
    }
  );
  await ui.click(ui.byAttr("aria-expanded", "false")[0]);
  await ui.click(
    ui.byAttr("role", "radio").find((r) => r.attributes["data-value"] === "orukeet-v0.1.0")
  );
  assert.equal(ui.byAttr("aria-checked", "true")[0].attributes["data-value"], "orukeet-v0.1.0");
  const settings = (
    await ui.vite.ssrLoadModule("/stores/settingsStore.ts")
  ).useSettingsStore.getState();
  assert.equal(settings.transcriptionMode, "self-hosted");
  for (const key of ["parakeetModel", "spokenLanguages", "preferredLanguage"])
    assert.equal(ui.storage.getItem(key), null, key);
  assert.equal(ui.calls.filter(([name]) => name === "downloadParakeetModel").length, 0);
});

// Records notices whichever notifier variant (Task 7 A or B) is installed.
const NOTIFIER_MOCK = `
export function useOnboardingNotifier() {
  return (notice) => (globalThis.__onbNotices ??= []).push(notice);
}`;

test("a download that finishes or fails off-step sends one §5.3 notice; on Voice and Say something it does not", async (t) => {
  globalThis.__onbNotices = [];
  t.after(() => delete globalThis.__onbNotices);
  const progress = listenerBus();
  const pending = [];
  const { ui } = await mountFlow(
    t,
    { initialStep: "speech" },
    {
      api: voiceApi(["en-US"], {
        onParakeetDownloadProgress: progress.subscribe,
        downloadParakeetModel: () => new Promise((resolve) => pending.push(resolve)),
      }),
      mocks: {
        "/SettingsPage": "export default function SettingsPage() { return null; }",
        "onboarding/useOnboardingNotifier": NOTIFIER_MOCK,
      },
    }
  );
  await React.act(async () => {});
  await ui.click(primary(ui)); // commit + download → Say something
  const emit = (data) =>
    React.act(async () => progress.emit({}, { model: "parakeet-unified-en-0.6b", ...data }));
  await emit({ type: "progress", percentage: 30, downloaded_bytes: 19e7, total_bytes: 6.31e8 });
  assert.equal(globalThis.__onbNotices.length, 0, "Say something shows the download inline");
  await ui.click("setupFlow.skipStep"); // → Cleanup
  await emit({ type: "error", error: "Network timeout", code: "NETWORK" });
  await React.act(async () =>
    pending.shift()({ success: false, downloaded: false, error: "Network timeout" })
  );
  assert.equal(globalThis.__onbNotices.length, 1);
  const [failed] = globalThis.__onbNotices;
  assert.deepEqual(
    [failed.kind, failed.title, failed.persistent],
    ["alert", "setupFlow.download.failedTitle", true]
  );
  assert.equal(failed.actions[0].label, "setupFlow.download.retry");
});

function observeAnnouncements(announcer) {
  const updates = [];
  const textContent = Object.getOwnPropertyDescriptor(announcer, "textContent");
  const observeText = (node) => {
    const descriptor = Object.getOwnPropertyDescriptor(node, "nodeValue");
    Object.defineProperty(node, "nodeValue", {
      ...descriptor,
      set(value) {
        if (String(value).includes("setupFlow.download.announce")) updates.push(value);
        descriptor.set.call(node, value);
      },
    });
  };
  Object.defineProperty(announcer, "textContent", {
    ...textContent,
    set(value) {
      if (String(value).includes("setupFlow.download.announce")) updates.push(value);
      textContent.set.call(announcer, value);
      for (const node of announcer.childNodes) if (node.nodeType === 3) observeText(node);
    },
  });
  return updates;
}

test("milestones reach one polite live region, once each", async (t) => {
  const progress = listenerBus();
  const { ui } = await mountFlow(
    t,
    { initialStep: "speech" },
    {
      api: voiceApi(["en-US"], { onParakeetDownloadProgress: progress.subscribe }),
    }
  );
  await React.act(async () => {});
  await ui.click(primary(ui));
  const live = () =>
    ui
      .byAttr("aria-live", "polite")
      .filter((node) => node.attributes["data-onb-announcer"] !== undefined);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const updates = observeAnnouncements(live()[0]);
  for (const percentage of [10, 26, 27, 26, 50, 75, 99]) {
    t.mock.timers.tick(101);
    await React.act(async () =>
      progress.emit(
        {},
        {
          type: "progress",
          model: "parakeet-unified-en-0.6b",
          percentage,
          downloaded_bytes: 1,
          total_bytes: 100,
        }
      )
    );
  }
  assert.equal(live().length, 1);
  assert.ok(live()[0].textContent.includes("setupFlow.download.announcePercent(percent=75)"));
  assert.deepEqual(
    updates,
    [25, 50, 75].map((percent) => `setupFlow.download.announcePercent(percent=${percent})`)
  );
});

// Real ToastProvider + real useToast/useDialogs/download hooks: do not infer visible
// alert ownership from a notifier mock. useModelDownload's private dialog state is
// not exposed/rendered by this flow; this boundary catches any future dialog host.
async function realNoticeFlow(t, initialStep = "speech", extra = {}) {
  const { createRoot } = require("react-dom/client");
  const {
    createRendererServer,
    installBrowserGlobals,
    installHookDom,
  } = require("../lib/rendererTestHarness");
  const { installTree } = require("../helpers/harness/fakeDomTree");
  const { rendererOptions } = require("../helpers/harness/rendererMocks");
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const progress = listenerBus(),
    pending = [];
  let installed = false;
  const globals = installBrowserGlobals(t, {
    initialStorage: { ...MIGRATED_STORAGE, ...extra.storage },
    window: {
      electronAPI: voiceApi(["en-US"], {
        onParakeetDownloadProgress: progress.subscribe,
        checkParakeetModelStatus: async () => ({ downloaded: installed }),
        downloadParakeetModel: () => new Promise((resolve) => pending.push(resolve)),
        ...extra.api,
      }),
      location: { search: "" },
      innerHeight: 560,
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      dispatchEvent() {},
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
    },
  });
  installHookDom(t);
  const ui = installTree();
  const createElement = globalThis.document.createElement;
  globalThis.document.createElement = (tag) => {
    const node = createElement(tag);
    node.getBoundingClientRect = () => ({ top: 496, height: 64, width: 640 });
    return node;
  };
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-real-onboarding-notices-", SETTINGS_PAGE)
  );
  const Flow = (await vite.ssrLoadModule("/components/OnboardingFlow.tsx")).default;
  const { ToastProvider } = await vite.ssrLoadModule("/components/ui/Toast.tsx");
  root = createRoot(ui.container);
  await React.act(async () =>
    root.render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(Flow, { initialStep, onComplete() {} })
      )
    )
  );
  return {
    ...ui,
    vite,
    storage: globals.storage,
    pending,
    install: () => {
      installed = true;
    },
    emit: (data) =>
      React.act(async () => progress.emit({}, { model: "parakeet-unified-en-0.6b", ...data })),
    settle: (result) => React.act(async () => pending.shift()(result)),
  };
}

test("real setup failure has one persistent visible alert, no legacy dialog, and its actual Retry starts the same transfer model", async (t) => {
  const ui = await realNoticeFlow(t);
  await ui.click(primary(ui));
  await ui.click("setupFlow.skipStep");
  await ui.emit({
    type: "progress",
    percentage: 35,
    downloaded_bytes: 220e6,
    total_bytes: 631e6,
    sequence: 1,
  });
  await ui.emit({
    type: "error",
    error: "Network timeout",
    code: "NETWORK",
    keptBytes: 220e6,
    sequence: 2,
  });
  assert.equal(
    ui.byAttr("role", "alert").length,
    0,
    "owned request settles once its result arrives"
  );
  await ui.settle({
    success: false,
    downloaded: false,
    error: "Network timeout",
    code: "NETWORK",
    keptBytes: 220e6,
  });
  const alert = ui.byAttr("role", "alert")[0];
  assert.ok(alert.textContent.includes("setupFlow.download.failedTitle"));
  assert.equal(ui.byAttr("role", "alert").length, 1);
  assert.equal(ui.byAttr("role", "alertdialog").length, 0);
  for (let i = 0; i < 2; i++)
    await ui.emit({
      type: "error",
      error: "Network timeout",
      code: "NETWORK",
      keptBytes: 220e6,
      sequence: 2,
    });
  assert.equal(ui.byAttr("role", "alert").length, 1, "terminal fan-out does not duplicate alerts");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await React.act(async () => t.mock.timers.tick(60000));
  assert.equal(ui.byAttr("role", "alert").length, 1, "persistent failure never times out");
  const retry = ui
    .findAll((n) => n.tagName === "BUTTON" && n.textContent.includes("setupFlow.download.retry"))
    .find((n) => {
      for (let parent = n.parentNode; parent; parent = parent.parentNode)
        if (parent === alert) return true;
      return false;
    });
  assert.ok(retry, "actual toast action, not footer chip Retry");
  await ui.click(retry);
  assert.equal(ui.pending.length, 1, "one explicit retry request");
  await ui.emit({
    type: "progress",
    percentage: 40,
    downloaded_bytes: 250e6,
    total_bytes: 631e6,
    sequence: 3,
  });
  ui.install();
  await ui.emit({ type: "complete", sequence: 4 });
  await ui.settle({ success: true, downloaded: true });
  assert.equal(
    ui
      .byAttr("role", "status")
      .filter((n) => n.textContent.includes("setupFlow.download.readyTitle")).length,
    1
  );
  await ui.emit({ type: "complete", sequence: 4 });
  assert.equal(
    ui
      .byAttr("role", "status")
      .filter((n) => n.textContent.includes("setupFlow.download.readyTitle")).length,
    1
  );
});

for (const step of ["speech", "try"])
  test(`real ${step} failure stays inline with no visible alert or dialog`, async (t) => {
    const ui = await realNoticeFlow(t);
    await ui.click(primary(ui));
    if (step === "speech") await ui.click("setupFlow.back");
    await ui.emit({
      type: "error",
      error: "Network timeout",
      code: "NETWORK",
      keptBytes: 0,
      sequence: 1,
    });
    await ui.settle({
      success: false,
      downloaded: false,
      error: "Network timeout",
      code: "NETWORK",
    });
    assert.equal(ui.byAttr("role", "alert").length, 0);
    assert.equal(ui.byAttr("role", "alertdialog").length, 0);
    assert.ok(ui.text().includes("setupFlow.download.retry"));
  });

test("reduced preference changes preserve flow hook order and clean up subscriptions across navigation", async (t) => {
  const listeners = new Set();
  const query = {
    matches: false,
    addEventListener: (_type, cb) => listeners.add(cb),
    removeEventListener: (_type, cb) => listeners.delete(cb),
  };
  const { ui } = await mountFlow(
    t,
    { initialStep: "speech" },
    {
      api: voiceApi(["en-US"]),
      windowProps: {
        matchMedia: (q) =>
          q.includes("reduce")
            ? query
            : { matches: false, addEventListener() {}, removeEventListener() {} },
      },
    }
  );
  await ui.click(primary(ui));
  assert.equal(ui.byAttr("data-demo", "true").length, 1);
  await React.act(async () => {
    query.matches = true;
    for (const cb of listeners) cb();
  });
  assert.equal(ui.byAttr("data-demo", "true").length, 0);
  await ui.click("setupFlow.skipStep");
  await ui.click("setupFlow.back");
  await React.act(async () => {
    query.matches = false;
    for (const cb of listeners) cb();
  });
  assert.equal(ui.byAttr("data-demo", "true").length, 1);
  assert.equal(
    listeners.size,
    2,
    "one hoisted flow subscription plus the existing rail subscription"
  );
  await ui.unmount();
  assert.equal(listeners.size, 0);
});

test("refused cancellation does not settle the notice identity; actual completion still announces and receipts once", async (t) => {
  globalThis.__onbNotices = [];
  t.after(() => delete globalThis.__onbNotices);
  const progress = listenerBus(),
    pending = [];
  let installed = false;
  let settleCancel;
  const { ui } = await mountFlow(
    t,
    { initialStep: "speech" },
    {
      api: voiceApi(["en-US"], {
        onParakeetDownloadProgress: progress.subscribe,
        cancelParakeetDownload: () =>
          new Promise((resolve) => {
            settleCancel = resolve;
          }),
        downloadParakeetModel: () => new Promise((resolve) => pending.push(resolve)),
        checkParakeetModelStatus: async () => ({ downloaded: installed }),
      }),
      mocks: { ...SETTINGS_PAGE, "onboarding/useOnboardingNotifier": NOTIFIER_MOCK },
    }
  );
  await ui.click(primary(ui));
  await ui.click("setupFlow.download.cancel");
  assert.ok(ui.text().includes("setupFlow.download.chipCancelling"));
  await React.act(async () => settleCancel({ success: false, code: "INSTALLATION_IN_PROGRESS" }));
  await ui.click("setupFlow.skipStep");
  installed = true;
  await React.act(async () =>
    progress.emit({}, { type: "complete", model: "parakeet-unified-en-0.6b", sequence: 2 })
  );
  await React.act(async () => pending.shift()({ success: true, downloaded: true }));
  assert.equal(globalThis.__onbNotices.length, 1);
  assert.equal(globalThis.__onbNotices[0].kind, "receipt");
  assert.equal(ui.byAttr("data-onb-announcer")[0].textContent, "setupFlow.download.announceReady");
});

test("installed snapshots and a different selected model cannot replay or retarget an old failure notice", async (t) => {
  globalThis.__onbNotices = [];
  t.after(() => delete globalThis.__onbNotices);
  const progress = listenerBus(),
    pending = [];
  const { ui } = await mountFlow(
    t,
    { initialStep: "speech" },
    {
      windowProps: { dispatchEvent() {} },
      api: voiceApi(["en-US"], {
        onParakeetDownloadProgress: progress.subscribe,
        checkParakeetModelStatus: async (id) => ({ downloaded: id === "orukeet-v0.1.0" }),
        downloadParakeetModel: () => new Promise((resolve) => pending.push(resolve)),
      }),
      mocks: { ...SETTINGS_PAGE, "onboarding/useOnboardingNotifier": NOTIFIER_MOCK },
    }
  );
  await ui.click(primary(ui));
  await ui.click("setupFlow.skipStep");
  await React.act(async () =>
    progress.emit(
      {},
      { type: "error", model: "parakeet-unified-en-0.6b", error: "Network timeout", sequence: 1 }
    )
  );
  await React.act(async () =>
    pending.shift()({ success: false, downloaded: false, error: "Network timeout" })
  );
  assert.equal(globalThis.__onbNotices.length, 1);
  const retry = globalThis.__onbNotices[0].actions[0].onClick;
  await ui.click("setupFlow.back");
  await ui.click("setupFlow.back");
  await ui.click(ui.byAttr("aria-expanded", "false")[0]);
  await ui.click(
    ui.byAttr("role", "radio").find((n) => n.attributes["data-value"] === "orukeet-v0.1.0")
  );
  assert.ok(ui.text().includes("setupFlow.voice.installed"));
  assert.equal(globalThis.__onbNotices.length, 1, "installed B is not A completing");
  await React.act(async () => retry());
  assert.equal(pending.length, 0, "stale Retry never downloads the current uncommitted candidate");
  await React.act(async () =>
    progress.emit({}, { type: "complete", model: "parakeet-unified-en-0.6b", sequence: 1 })
  );
  assert.equal(globalThis.__onbNotices.length, 1, "late A result never relabels installed B");
});

test("a cold installed snapshot has no download receipt or new live announcement", async (t) => {
  globalThis.__onbNotices = [];
  t.after(() => delete globalThis.__onbNotices);
  const { ui } = await mountFlow(
    t,
    { initialStep: "cleanup" },
    {
      api: voiceApi(["en-US"], { checkParakeetModelStatus: async () => ({ downloaded: true }) }),
      mocks: { ...SETTINGS_PAGE, "onboarding/useOnboardingNotifier": NOTIFIER_MOCK },
    }
  );
  assert.equal(globalThis.__onbNotices.length, 0);
  assert.equal(ui.byAttr("data-onb-announcer")[0].textContent, "");
});

test("a same-model observed restart clears old live progress and publishes every new milestone once", async (t) => {
  const ui = await realNoticeFlow(t);
  await ui.click(primary(ui));
  const announcer = ui.byAttr("data-onb-announcer")[0];
  const updates = observeAnnouncements(announcer);
  t.mock.timers.enable({ apis: ["Date"], now: 100000 });
  let sequence = 0;
  const progress = async (percentage) => {
    t.mock.timers.tick(101);
    await ui.emit({
      type: "progress",
      percentage,
      downloaded_bytes: percentage * 10,
      total_bytes: 1000,
      sequence: ++sequence,
    });
  };
  await progress(75);
  assert.equal(announcer.textContent, "setupFlow.download.announcePercent(percent=75)");
  await ui.emit({
    type: "error",
    error: "Network timeout",
    code: "NETWORK",
    keptBytes: 750,
    sequence: ++sequence,
  });
  await ui.settle({
    success: false,
    downloaded: false,
    error: "Network timeout",
    code: "NETWORK",
    keptBytes: 750,
  });
  assert.ok(ui.text().includes("setupFlow.download.retry"), "A has settled with no active entry");
  assert.equal(ui.pending.length, 0);
  updates.length = 0;

  // Another owner starts B: actual sequenced native fan-out, no flow Retry/start.
  const lowProgressText = [];
  for (const percentage of [0, 10]) {
    await progress(percentage);
    lowProgressText.push(announcer.textContent);
  }
  for (const percentage of [25, 25, 20, 50, 50, 40, 75, 75, 70]) await progress(percentage);
  assert.equal(ui.pending.length, 0, "observing B never starts a download request here");
  assert.equal(ui.byAttr("data-onb-announcer").length, 1);
  assert.deepEqual(
    { lowProgressText, updates, finalText: announcer.textContent },
    {
      lowProgressText: ["", ""],
      updates: [25, 50, 75].map(
        (percent) => `setupFlow.download.announcePercent(percent=${percent})`
      ),
      finalText: "setupFlow.download.announcePercent(percent=75)",
    },
    "old 75 must neither publish early nor poison B's milestone set; duplicates/regressions stay quiet"
  );
});

async function realTrialFlow(t, options = {}) {
  const { bridgeFixture } = require("../helpers/harness/onboardingBridgeFixture");
  const f = bridgeFixture();
  f.manager.hotkeyManager.slots = new Map([["dictation", { hotkeys: ["F7"], callback() {} }]]);
  f.manager._cachedActivationMode = "tap";
  const names = [
    "beginOnboardingDemo",
    "endOnboardingDemo",
    "toggleOnboardingDemo",
    "cancelOnboardingDemo",
    "onOnboardingDemoEvent",
    "onDictationHotkeyEvent",
    "getDictationBinding",
    "retryOnboardingCleanup",
  ];
  const { ui } = await mountFlow(
    t,
    { initialStep: "speech", previewConfig: undefined },
    {
      ...options,
      windowProps: {
        setInterval: (cb, ms) => setInterval(cb, ms),
        clearInterval: (id) => clearInterval(id),
        ...options.windowProps,
      },
      storage: { dictationKey: "F7", activeDictationKey: "F7", ...options.storage },
      api: voiceApi(["en-US"], {
        getPlatform: () => "linux",
        checkParakeetModelStatus: async () => ({ downloaded: true }),
        checkParakeetInstallation: async () => ({ supported: true }),
        listParakeetModels: async () => ({
          success: true,
          models: [{ model: "parakeet-unified-en-0.6b", downloaded: true }],
        }),
        ...Object.fromEntries(names.map((name) => [name, f.setupApi[name]])),
        ...options.api,
      }),
    }
  );
  await ui.click(primary(ui)); // The explicit Voice commit, never status alone.
  const take = () => f.sent.findLast(([name]) => name === "prepare-dictation")?.[1]?.onboardingTake;
  const publish = (event) =>
    React.act(async () => {
      await f.overlayApi.publishOnboardingDemoEvent({
        ...take(),
        context: f.manager._onboardingDemoSession.context,
        kind: "dictation",
        ...event,
      });
    });
  return { ui, f, take, publish };
}

test("the actual admitted trial retains one meter through processing/settle, draws, docks once and stays docked on Cleanup", async (t) => {
  const h = await realTrialFlow(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await React.act(async () => h.f.manager.createHotkeyCallback()("F7"));
  await h.publish({ status: "listening" });
  const meter = h.ui.byAttr("data-level-bar");
  assert.equal(meter.length, 5);
  await h.publish({ status: "partial", text: "Remind me" });
  assert.ok(h.ui.text().includes("Remind me"));
  await h.publish({ status: "processing" });
  assert.equal(h.ui.byAttr("data-level-bar")[0], meter[0]);
  await h.publish({
    status: "success",
    text: "Remind me.",
    rawText: "um remind me",
    cleanup: "skipped",
  });
  assert.equal(h.ui.byAttr("data-level-bar")[0], meter[0]);
  assert.ok(h.ui.text().includes("setupFlow.try.shortcutWorks"));
  const shell = () =>
    h.ui.findAll((n) => (n.attributes.class ?? "").split(" ").includes("onb-shell"))[0];
  const instrument = () => h.ui.findAll((n) => n.attributes.class === "onb-instrument")[0];
  assert.equal(instrument().attributes["data-stage"], "settle");
  assert.equal(shell().attributes["data-docked"], undefined);
  await React.act(async () => t.mock.timers.tick(520));
  assert.equal(h.ui.byAttr("data-bubble").length, 1);
  assert.equal(shell().attributes["data-docked"], undefined);
  await React.act(async () => t.mock.timers.tick(360));
  assert.equal(shell().attributes["data-docked"], "true");
  await h.ui.click("setupFlow.try.makeItYours");
  assert.equal(shell().attributes["data-docked"], "true");
  assert.equal(h.f.manager._onboardingDemoSession, null);
});

test("a button take makes no shortcut claim and reduced motion docks immediately", async (t) => {
  const h = await realTrialFlow(t, { reducedMotion: true });
  await h.ui.click("setupFlow.try.useButton");
  await h.ui.click("setupFlow.try.start");
  assert.equal(h.ui.text().includes("setupFlow.try.listening"), false);
  await h.publish({ status: "listening" });
  await h.publish({ status: "processing" });
  await h.publish({ status: "success", text: "Words.", cleanup: "skipped" });
  assert.ok(h.ui.text().includes("setupFlow.try.heardYou"));
  assert.equal(h.ui.text().includes("setupFlow.try.shortcutWorks"), false);
  assert.equal(h.ui.byAttr("data-docked", "true").length, 1);
  assert.equal(h.ui.byAttr("data-level-bar").length, 0);
});

test("Choose voice from an uncommitted trial uses the established progress navigation label (F09b)", async (t) => {
  const { ui } = await mountFlow(
    t,
    { initialStep: "try" },
    { api: voiceApi(["en-US"], { checkParakeetModelStatus: async () => ({ downloaded: false }) }) }
  );
  assert.ok(ui.text().includes("setupFlow.tour.title"));
  await ui.click("setupFlow.tour.chooseVoice");
  assert.equal(currentStep(ui), "setupFlow.progress.goTo(step=setupFlow.steps.speech)");
});

test("Ready never borrows shortcut A or microphone A proof for a new acknowledged/current choice", async (t) => {
  const h = await realTrialFlow(t, { storage: { autoPasteEnabled: "true" } });
  await React.act(async () => h.f.manager.createHotkeyCallback()("F7"));
  await h.publish({ status: "listening" });
  await h.publish({ status: "success", text: "A", rawText: "um A" });
  await h.ui.click("setupFlow.try.startUsing");
  const row = (key) =>
    h.ui.byAttr("data-status")[["speech", "microphone", "shortcut", "cleanup"].indexOf(key)]
      .attributes["data-status"];
  assert.equal(row("shortcut"), "ready");
  assert.equal(row("microphone"), "ready");
  const store = (await h.ui.vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore;
  h.f.manager.hotkeyManager.slots.get("dictation").hotkeys = ["F8"];
  await React.act(async () => store.setState({ dictationKey: "F8", activeDictationKey: "F8" }));
  assert.ok(row("shortcut") === "configured", "acknowledged B is configured but unproven");
  await React.act(async () => store.setState({ dictationKey: "F9", activeDictationKey: "F9" }));
  assert.ok(row("shortcut") === "configured", "failed C acknowledgement is also unproven");
  await React.act(async () =>
    store.setState({ microphoneSelectionMode: "specific", selectedMicDeviceId: "device-B" })
  );
  assert.ok(row("microphone") !== "ready");
  assert.equal(h.f.manager._onboardingDemoSession, null, "Finish makes no recording admission");
});

test("choosing API key without a key names its unmet prerequisite using the real check, independent of preview scenario", async (t) => {
  const { expectKey } = require("../helpers/harness/mountComponent");
  const { ui } = await mountFlow(
    t,
    {
      initialStep: "cleanup",
      previewConfig: { step: "cleanup", scenario: "ready", platform: "linux" },
    },
    { api: { personalInference: { credentialStatus: async () => ({ configured: false }) } } }
  );
  await ui.click(ui.byAttr("data-value", "provider")[0]);
  expectKey(ui, "setupFlow.cleanup.now.needsKey", { provider: "OpenAI" });
  assert.equal(ui.text().includes("setupFlow.cleanup.now.off"), false);
  assert.equal(
    ui.calls.filter(([name]) =>
      /providerTest|describeModels|textGenerate|runTextOperation/.test(name)
    ).length,
    0
  );
  await ui.click(primary(ui));
  await ui.click(primary(ui));
  expectKey(ui, "setupFlow.ready.details.cleanup.needsKey", { provider: "OpenAI" });
  assert.equal(ui.byAttr("data-row", "cleanup").length, 1);
});

test("reuse keeps its existing key/default and never enables cleanup for None or a superseded check", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "cleanup" });
  const settings = (await ui.vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore;
  const originalChatModel = settings.getState().chatAgentModel;
  const checkbox = ui.findAll((n) => n.tagName === "INPUT" && ui.props(n).type === "checkbox")[0];
  assert.equal(checkbox.checked, false);
  await React.act(async () => ui.props(checkbox).onChange({ target: { checked: true } }));
  assert.equal(ui.storage.getItem("loqui.onboarding.preview.linux.ready.reuseCleanup"), "true");
  await ui.click(ui.byAttr("data-value", "none")[0]);
  await advance(ui);
  assert.equal(settings.getState().useCleanupModel, false);
  assert.equal(settings.getState().chatAgentModel, originalChatModel);
});

test("explicit reuse of the checked choice fills only unconfigured text scopes and preserves existing choices", async (t) => {
  const { ui } = await mountFlow(
    t,
    { initialStep: "cleanup" },
    {
      storage: {
        chatAgentModel: "keep-existing",
        translationModel: "",
        dictationAgentModel: "",
        noteFormattingModel: "",
      },
      api: { personalInference: { credentialStatus: async () => ({ configured: true }) } },
    }
  );
  const settings = (await ui.vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore;
  await ui.click(ui.byAttr("data-value", "provider")[0]);
  const source = settings.getState().cleanupModel;
  const checkbox = ui.findAll((n) => n.tagName === "INPUT" && ui.props(n).type === "checkbox")[0];
  await React.act(async () => ui.props(checkbox).onChange({ target: { checked: true } }));
  await advance(ui);
  assert.equal(settings.getState().chatAgentModel, "keep-existing");
  for (const key of ["translationModel", "dictationAgentModel", "noteFormattingModel"])
    assert.equal(settings.getState()[key], source, key);
  assert.equal(settings.getState().useCleanupModel, true);
});

test("cleanup keyboard choice keeps focus on the selected radio while its availability check changes context", async (t) => {
  const { ui } = await mountFlow(
    t,
    { initialStep: "cleanup" },
    {
      api: {
        personalInference: {
          codexStatus: async () => ({ available: true, account: { type: "chatgpt" } }),
          codexModels: async () => ({ data: [{ model: "fixture", isDefault: true }] }),
          onTextEvent: () => () => {},
        },
      },
    }
  );
  const local = ui.byAttr("data-value", "local")[0];
  local.focus();
  await ui.press(local, "ArrowRight");
  assert.ok(
    globalThis.document.activeElement === ui.byAttr("data-value", "codex")[0],
    "focus stays on the live selected radio"
  );
});

for (const outcome of ["failed", "pending", "successful"]) {
  test(`Cleanup retains only delivery history across leave/Back after an admitted ${outcome} remote request`, async (t) => {
    const { expectKey } = require("../helpers/harness/mountComponent");
    const SENTENCE = "um remind me to book the room";
    const RESULT = "Remind me to book the room.";
    const NEXT_RESULT = "Freshly admitted cleanup result.";
    let bridge;
    let settle;
    const pending = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    const requests = [];
    const h = await realTrialFlow(t, {
      reducedMotion: true,
      api: {
        credentials: {
          list: async () => [{ id: "openai", present: true, generation: 1 }],
          onChanged: () => () => {},
        },
        personalInference: {
          credentialStatus: async () => ({ configured: true }),
          captureTextOperation: (...args) => bridge.captureTextOperation(...args),
          runTextOperation: (...args) => bridge.runTextOperation(...args),
          retireTextOperation: (...args) => bridge.retireTextOperation(...args),
        },
      },
    });
    const { ui } = h;
    const writes = [];
    const setItem = ui.storage.setItem;
    ui.storage.setItem = (key, value) => {
      writes.push([key, value]);
      return setItem(key, value);
    };
    await ui.vite.ssrLoadModule("/services/capturedCleanupOperation.ts");
    const { createCapturedTextBridge } = await ui.vite.ssrLoadModule(
      "/preview/capturedTextBridge.ts"
    );
    bridge = createCapturedTextBridge(async (descriptor, sentence) => {
      requests.push({ provider: descriptor.provider, sentence });
      return requests.length === 1 ? pending : NEXT_RESULT;
    });
    await React.act(async () => h.f.manager.createHotkeyCallback()("F7"));
    await h.publish({ status: "listening" });
    await h.publish({ status: "success", text: SENTENCE, rawText: SENTENCE, cleanup: "skipped" });
    await ui.click("setupFlow.try.makeItYours");
    await ui.click(ui.byAttr("data-value", "provider")[0]);
    expectKey(ui, "setupFlow.cleanup.tryMine", { count: 7, provider: "OpenAI" });
    assert.equal(requests.length, 0);
    await ui.click("setupFlow.cleanup.tryMine");
    // Exercise the real setup runner/captured operation and production in-memory IPC fixture.
    assert.equal(requests.length, 1, "the first request really reached execution");
    assert.equal(requests[0].provider, "openai");
    assert.ok(requests[0].sentence.includes(SENTENCE));
    const firstInput = ui.calls.find(([name]) => name === "personalInference.runTextOperation")[1];
    assert.equal(firstInput.request.wordCount, 7);
    if (outcome === "failed")
      await React.act(async () =>
        settle.reject(Object.assign(new Error("fixture failure"), { code: "CLEANUP_FAILED" }))
      );
    if (outcome === "successful") await React.act(async () => settle.resolve(RESULT));
    if (outcome === "successful") assert.ok(ui.text().includes(RESULT));
    if (outcome === "failed") assert.equal(ui.byAttr("role", "alert").length, 1);
    if (outcome === "pending") expectKey(ui, "setupFlow.cleanup.running");
    await advance(ui);
    assert.equal(currentStep(ui), "setupFlow.progress.goTo(step=setupFlow.steps.shortcuts)");
    const retirements = ui.calls.filter(
      ([name]) => name === "personalInference.retireTextOperation"
    );
    assert.ok(retirements.length >= 1, "departure retires the admitted capability");
    if (outcome === "successful") {
      await advance(ui); // History also survives another step, not only Shortcuts.
      await ui.click("setupFlow.back");
    }
    await ui.click("setupFlow.back");
    expectKey(ui, "setupFlow.cleanup.previousAttemptNotice", { count: 7, provider: "OpenAI" });
    expectKey(ui, "setupFlow.cleanup.tryMine", { count: 7, provider: "OpenAI" });
    assert.equal(ui.text().includes("setupFlow.cleanup.exampleNotice"), false);
    assert.equal(ui.text().includes(RESULT), false);
    assert.equal(ui.text().includes("setupFlow.cleanup.running"), false);
    assert.equal(requests.length, 1, "unchanged-route re-entry requires fresh consent too");
    const nextSentence = outcome === "successful" ? "uh another sentence" : SENTENCE;
    const nextCount = outcome === "successful" ? 3 : 7;
    if (outcome === "successful") {
      // A newer admitted take changes the current words, never the historical count.
      await ui.click("setupFlow.back");
      await React.act(async () => h.f.manager.createHotkeyCallback()("F7"));
      await h.publish({ status: "listening" });
      await h.publish({
        status: "success",
        text: nextSentence,
        rawText: nextSentence,
        cleanup: "skipped",
      });
      await ui.click("setupFlow.try.makeItYours");
      expectKey(ui, "setupFlow.cleanup.previousAttemptNotice", { count: 7, provider: "OpenAI" });
      expectKey(ui, "setupFlow.cleanup.tryMine", { count: nextCount, provider: "OpenAI" });
      assert.equal(requests.length, 1);
    }
    await advance(ui);
    // Change the current recipient while Cleanup is unmounted. History must still name A.
    const settings = (await ui.vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore;
    await React.act(async () =>
      settings.setState({
        cleanupMode: "self-hosted",
        cleanupRemoteUrl: "http://10.0.0.8:9000/v1",
        cleanupModel: "server-b",
      })
    );
    await ui.click("setupFlow.back");
    expectKey(ui, "setupFlow.cleanup.previousAttemptNotice", { count: 7, provider: "OpenAI" });
    assert.equal(ui.text().includes("setupFlow.cleanup.exampleNotice"), false);
    assert.equal(ui.text().includes(RESULT), false, "results do not survive departure");
    assert.equal(ui.text().includes("setupFlow.cleanup.running"), false);
    assert.equal(ui.byAttr("role", "alert").length, 0, "errors are not session history");
    assert.equal(requests.length, 1, "Back never reissues the old request");
    if (outcome === "pending") {
      await React.act(async () => settle.resolve("Stale A result."));
      assert.equal(ui.text().includes("Stale A result."), false);
      assert.equal(requests.length, 1);
    }
    expectKey(ui, "setupFlow.cleanup.previousAttemptNotice", { count: 7, provider: "OpenAI" });
    expectKey(ui, "setupFlow.cleanup.tryMine", { count: nextCount, provider: "10.0.0.8:9000" });
    assert.equal(requests.length, 1);
    await ui.click("setupFlow.cleanup.tryMine");
    assert.equal(requests.length, 2, "fresh named consent positively executes a new operation");
    assert.equal(requests[1].provider, "lan");
    assert.ok(requests[1].sentence.includes(nextSentence));
    assert.ok(ui.text().includes(NEXT_RESULT));
    assert.equal(ui.text().includes(RESULT), false);
    const captures = ui.calls.filter(([name]) => name === "personalInference.captureTextOperation");
    assert.equal(captures.length, 2, "no automatic capture/renewal on re-entry");
    const inputs = ui.calls.filter(([name]) => name === "personalInference.runTextOperation");
    assert.equal(
      inputs[0][1].token === inputs[1][1].token,
      false,
      "new operation, no reused capability"
    );
    assert.equal(inputs[1][1].request.wordCount, nextCount);
    for (const content of [SENTENCE, nextSentence, RESULT, NEXT_RESULT, "preview-cleanup-"])
      assert.equal(
        JSON.stringify(writes).includes(content),
        false,
        "no content or capability is persisted"
      );
    assert.equal(
      writes.some(([key]) => /attempt/i.test(key)),
      false,
      "history has no storage key"
    );
  });
}

test("Shortcut offers push only after the current key capabilities load, and observes paste settings (ONB-19)", async (t) => {
  const { expectKey } = require("../helpers/harness/mountComponent");
  const { bridgeFixture } = require("../helpers/harness/onboardingBridgeFixture");
  const f = bridgeFixture();
  f.manager.hotkeyManager.slots = new Map([["dictation", { hotkeys: ["F7"], callback() {} }]]);
  f.manager._cachedActivationMode = "tap";
  const pending = new Map();
  const { ui } = await mountFlow(
    t,
    { initialStep: "shortcuts" },
    {
      storage: {
        dictationKey: "F7",
        activeDictationKey: "F7",
        activationMode: "tap",
        autoPasteEnabled: "true",
      },
      api: {
        ...f.setupApi,
        getHotkeyModeInfo: (key) => new Promise((resolve) => pending.set(key, resolve)),
      },
    }
  );
  const held = async () => {
    const now = Date.now;
    try {
      Date.now = () => 0;
      await React.act(async () => f.manager.reportDictationHotkey("down", "F7"));
      Date.now = () => 600;
      await React.act(async () => f.manager.reportDictationHotkey("up", "F7"));
    } finally {
      Date.now = now;
    }
  };
  assert.equal(f.manager._onboardingDemoKind, "shortcut");
  await held();
  expectKey(ui, "setupFlow.shortcut.detected.hold");
  assert.equal(ui.text().includes("setupFlow.shortcut.switch"), false);
  await React.act(async () => pending.get("F7")({ supportsPushToTalk: true }));
  expectKey(ui, "setupFlow.shortcut.switch");
  await ui.click("setupFlow.shortcut.switch");
  const store = (await ui.vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore;
  assert.equal(store.getState().activationMode, "push");
  assert.equal(
    ui.text().includes("setupFlow.shortcut.works"),
    false,
    "mode changes need a new matching press"
  );
  const paste = ui.byAttr("aria-label", "setupFlow.shortcut.autoPaste")[0];
  await ui.click(paste);
  assert.equal(store.getState().autoPasteEnabled, false);
  assert.equal(
    ui.byAttr("aria-label", "setupFlow.shortcut.autoPaste")[0].attributes["aria-checked"],
    "false"
  );
  await React.act(async () => store.setState({ autoPasteEnabled: true }));
  assert.equal(
    ui.byAttr("aria-label", "setupFlow.shortcut.autoPaste")[0].attributes["aria-checked"],
    "true"
  );
  assert.equal(
    f.sent.some(([name]) => /^(start|toggle)-dictation$/.test(name)),
    false,
    "shortcut never records"
  );
});

test("Shortcut proof follows requested key, real main acknowledgement and mode; capture never proves a change", async (t) => {
  const { expectKey } = require("../helpers/harness/mountComponent");
  const { bridgeFixture } = require("../helpers/harness/onboardingBridgeFixture");
  const f = bridgeFixture();
  f.manager.hotkeyManager.slots = new Map([["dictation", { hotkeys: ["F7"], callback() {} }]]);
  f.manager._cachedActivationMode = "tap";
  const requested = [];
  const { ui } = await mountFlow(
    t,
    { initialStep: "shortcuts" },
    {
      storage: {
        dictationKey: "F7",
        activeDictationKey: "F7",
        activationMode: "tap",
        autoPasteEnabled: "true",
      },
      api: {
        ...f.setupApi,
        notifyHotkeyChanged: (key) => requested.push(key),
        getHotkeyModeInfo: async () => ({ supportsPushToTalk: true }),
      },
    }
  );
  const store = (await ui.vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore;
  await React.act(async () => f.manager.createHotkeyCallback()("F7"));
  expectKey(ui, "setupFlow.shortcut.works");
  await React.act(async () => store.getState().setDictationKey("F8"));
  assert.deepEqual(requested, ["F8"]);
  assert.equal(
    ui.text().includes("setupFlow.shortcut.works"),
    false,
    "pending B cannot borrow active A proof"
  );
  expectKey(ui, "setupFlow.shortcut.hint", { key: "F8" });
  // Main registration acknowledgement is configured, not a test.
  f.manager.hotkeyManager.slots.get("dictation").hotkeys = ["F8"];
  await React.act(async () => store.setState({ activeDictationKey: "F8" }));
  assert.equal(ui.text().includes("setupFlow.shortcut.works"), false);
  f.setListening(true);
  await React.act(async () => f.manager.createHotkeyCallback()("F8"));
  assert.equal(ui.text().includes("setupFlow.shortcut.works"), false);
  f.setListening(false);
  await React.act(async () => f.manager.createHotkeyCallback()("F8"));
  expectKey(ui, "setupFlow.shortcut.works");
  await React.act(async () => store.getState().setActivationMode("push"));
  assert.equal(ui.text().includes("setupFlow.shortcut.works"), false);
  await React.act(async () => f.manager.reportDictationHotkey("tap", "F8"));
  assert.equal(
    ui.text().includes("setupFlow.shortcut.works"),
    false,
    "old actual mode is not the new mode acknowledgement"
  );
  f.manager._cachedActivationMode = "push";
  await React.act(async () => f.manager.reportDictationHotkey("tap", "F8"));
  expectKey(ui, "setupFlow.shortcut.works");
  await React.act(async () => store.getState().setDictationKey("F9"));
  await React.act(async () => f.manager.reportDictationHotkey("tap", "F8"));
  assert.equal(
    ui.text().includes("setupFlow.shortcut.works"),
    false,
    "failed C leaves actual B unable to prove C"
  );
  await advance(ui);
  assert.equal(ui.byAttr("data-status")[2].attributes["data-status"], "configured");
  assert.equal(f.context._onboardingDemoSession, null);
});

test("Ready without a trial is configured, has no footer completion and resumes only three configured rows", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "finish" }, { api: voiceApi(["en-US"]) });
  assert.equal(ui.text().includes("setupFlow.ready.titleProven"), false);
  assert.equal(ui.byAttr("data-onb-primary").length, 0);
  assert.equal(ui.text().includes("setupFlow.finishLater"), false);
  assert.deepEqual(
    ui.byAttr("data-row").map((n) => n.attributes["data-row"]),
    ["speech", "microphone", "shortcut"]
  );
});

test("self-hosted notes are blocked on their own route and hand off the exact Settings destination", async (t) => {
  const { ui, completed } = await mountFlow(
    t,
    { initialStep: "finish" },
    {
      api: voiceApi(["en-US"]),
      storage: {
        meetingTranscriptionMode: "self-hosted",
        remoteTranscriptionUrl: "http://10.0.0.5:9000",
      },
    }
  );
  const [dictate] = ui.byAttr("data-variant", "live");
  assert.ok(dictate, "Ready renders the note action");
  assert.ok("disabled" in dictate.attributes);
  assert.ok(ui.text().includes("setupFlow.ready.noteBlocked.unsupported"));
  await ui.click("setupFlow.ready.fixNote");
  assert.deepEqual(completed(), [{ next: { kind: "open-settings", path: "stt/noteRecording" } }]);
});

const noteReadyOptions = {
  storage: {
    meetingTranscriptionMode: "local",
    meetingUseLocalWhisper: "true",
    meetingLocalTranscriptionProvider: "whisper",
    meetingWhisperModel: "base",
  },
  api: {
    listWhisperModels: async () => ({
      success: true,
      models: [{ model: "base", downloaded: true }],
    }),
  },
};

test("Ready click revalidates the current note route even before React renders the settings change", async (t) => {
  const { ui, completed } = await mountFlow(t, { initialStep: "finish" }, noteReadyOptions);
  const [button] = ui.byAttr("data-variant", "live");
  assert.equal("disabled" in button.attributes, false);
  const staleClick = ui.props(button).onClick;
  const store = (await ui.vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore;
  await React.act(async () => {
    store.setState({
      meetingTranscriptionMode: "self-hosted",
      meetingUseLocalWhisper: false,
      meetingRemoteTranscriptionUrl: "http://10.0.0.5:9000",
    });
    staleClick();
  });
  assert.deepEqual(completed(), []);
  assert.ok(ui.text().includes("setupFlow.ready.noteBlocked.unsupported"));
  await React.act(async () =>
    store.setState({ meetingTranscriptionMode: "local", meetingUseLocalWhisper: true })
  );
  await ui.click("setupFlow.ready.dictateNote");
  assert.deepEqual(completed(), [{ next: { kind: "dictate-note" } }]);
});

test("Ready unknown note route cannot complete, unknown microphone may reach the existing recorder prompt", async (t) => {
  const { ui, completed } = await mountFlow(
    t,
    { initialStep: "finish" },
    { ...noteReadyOptions, api: { checkMicrophoneAccess: undefined, listWhisperModels: undefined } }
  );
  assert.ok(ui.text().includes("setupFlow.ready.noteChecking"));
  const disabled = ui.byAttr("data-variant", "live")[0];
  assert.ok("disabled" in disabled.attributes);
  await React.act(async () => ui.props(disabled).onClick());
  assert.equal(completed().length, 0);
  const facts = (await ui.vite.ssrLoadModule("/stores/routeFactsStore.ts")).useRouteFactsStore;
  await React.act(async () =>
    facts.setState((s) => ({
      facts: { ...s.facts, installed: { ...s.facts.installed, whisper: new Set(["base"]) } },
    }))
  );
  assert.equal("disabled" in ui.byAttr("data-variant", "live")[0].attributes, false);
  await ui.click("setupFlow.ready.dictateNote");
  assert.deepEqual(completed(), [{ next: { kind: "dictate-note" } }]);
  assert.equal(
    ui.calls.some(([name]) => name === "requestMicrophoneAccess"),
    false
  );
});

test("Ready known microphone denial overrides even an admitted successful historical take", async (t) => {
  const h = await realTrialFlow(t, {
    api: { checkMicrophoneAccess: async () => ({ status: "denied" }) },
  });
  await React.act(async () => h.f.manager.createHotkeyCallback()("F7"));
  await h.publish({ status: "listening" });
  await h.publish({ status: "success", text: "A", rawText: "um A" });
  await h.ui.click("setupFlow.try.startUsing");
  assert.equal(h.ui.byAttr("data-status")[1].attributes["data-status"], "pending");
  assert.ok(h.ui.text().includes("setupFlow.ready.details.microphone.denied"));
  assert.ok("disabled" in h.ui.byAttr("data-variant", "live")[0].attributes);
  await h.ui.click("setupFlow.ready.fixNote");
  assert.equal(currentStep(h.ui), "setupFlow.progress.goTo(step=setupFlow.steps.welcome)");
});

test("Ready observes Accessibility on entry; an unresolved macOS answer never masquerades as granted", async (t) => {
  let resolve;
  const { ui } = await mountFlow(
    t,
    {
      initialStep: "finish",
      previewConfig: { step: "finish", scenario: "ready", platform: "macos" },
    },
    { api: { checkAccessibilityPermission: () => new Promise((r) => (resolve = r)) } }
  );
  assert.ok(ui.text().includes("setupFlow.ready.details.shortcut.checkAccessibility"));
  assert.equal(typeof resolve, "function", "Ready starts its own observation");
  await React.act(async () => resolve(true));
  assert.equal(ui.byAttr("data-status")[2].attributes["data-status"], "configured");
});

test("Ready invalidates voice proof when the admitted model/route changes, while keeping historical words for Cleanup", async (t) => {
  const h = await realTrialFlow(t);
  await React.act(async () => h.f.manager.createHotkeyCallback()("F7"));
  await h.publish({ status: "listening" });
  await h.publish({ status: "success", text: "A", rawText: "um A" });
  await h.ui.click("setupFlow.try.startUsing");
  assert.equal(h.ui.byAttr("data-status")[0].attributes["data-status"], "ready");
  const store = (await h.ui.vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore;
  await React.act(async () => store.setState({ parakeetModel: "orukeet-v0.1.0" }));
  assert.notEqual(h.ui.byAttr("data-status")[0].attributes["data-status"], "ready");
  assert.equal(h.ui.text().includes("setupFlow.ready.titleProven"), false);
  await React.act(async () =>
    store.setState({
      transcriptionMode: "providers",
      useLocalWhisper: false,
      cloudTranscriptionProvider: "openai",
    })
  );
  assert.equal(h.ui.text().includes("setupFlow.ready.subAllLocal"), false);
  await h.ui.click("setupFlow.back");
  await h.ui.click("setupFlow.back");
  assert.ok(h.ui.text().includes("um A"), "historical words stay in RAM for Cleanup");
});
