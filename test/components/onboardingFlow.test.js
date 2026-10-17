const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent } = require("../helpers/harness/mountComponent");

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
  const { ui, completed } = await mountFlow(t, { initialStep: "welcome" });
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
  assert.equal(ui.byAttr("data-onb-announcer").length, 0, "T14 owns announcements");
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
