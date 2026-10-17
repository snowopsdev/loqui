const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");

const preview = (patch = {}) => ({
  status: "off",
  deviceLabel: null,
  heardVoice: false,
  silent: false,
  inputs: [],
  readLevel: () => 0,
  retry: () => {},
  ...patch,
});
const usb = { deviceId: "usb", label: "USB Mic", isBuiltIn: false };
const picker = (patch = {}) => ({
  value: "__system__",
  previewDeviceId: null,
  hasBuiltIn: false,
  devices: [usb],
  missing: false,
  ...patch,
});

async function hello(t, props) {
  const actions = [];
  const ui = await mountComponent(t, "/components/onboarding/HelloStep.tsx", {
    exportName: "HelloStep",
    windowProps: { clearInterval() {} },
    props: {
      platform: "darwin",
      access: "unknown",
      preview: preview(),
      picker: picker(),
      onPickMicrophone: (value) => actions.push(["pick", value]),
      onAllow: () => actions.push("allow"),
      onRecheck: () => actions.push("recheck"),
      ...props,
    },
  });
  return { ui, actions };
}

test("before permission, one live button asks for the microphone", async (t) => {
  const { ui, actions } = await hello(t);
  const [allow] = ui.byAttr("data-variant", "live");
  assert.ok(allow.textContent.includes("setupFlow.hello.allowMic"));
  await ui.click(allow);
  assert.deepEqual(actions, ["allow"]);
  assert.equal(
    ui.findAll((node) => node.tagName === "SELECT").length,
    0,
    "no picker before permission"
  );
});

test("with permission, the meter shows which microphone is listening", async (t) => {
  const { ui } = await hello(t, {
    access: "granted",
    preview: preview({ status: "live", deviceLabel: "MacBook Pro Microphone" }),
  });
  assert.equal(ui.byAttr("data-level-bar").length, 5);
  expectKey(ui, "setupFlow.hello.micReady", { device: "MacBook Pro Microphone" });
});

test("the picker lists the system default and each input, and picking one reports it", async (t) => {
  const { ui, actions } = await hello(t, {
    access: "granted",
    preview: preview({ status: "live", inputs: [usb] }),
  });
  const [select] = ui.findAll((node) => node.tagName === "SELECT");
  const options = ui.findAll((node) => node.tagName === "OPTION").map((node) => node.textContent);
  assert.deepEqual(options, ["setupFlow.hello.systemDefault", "USB Mic"]);
  await React.act(async () => ui.props(select).onChange({ target: { value: "usb" } }));
  assert.deepEqual(actions, [["pick", "usb"]]);
});

test("hearing nothing highlights the picker; a missing saved device is said", async (t) => {
  const { ui } = await hello(t, {
    access: "granted",
    preview: preview({ status: "live", silent: true }),
    picker: picker({ missing: true }),
  });
  assert.equal(ui.byAttr("data-attention", "true").length, 1);
  assert.ok(ui.text().includes("setupFlow.hello.notHearing"));
  assert.ok(ui.text().includes("setupFlow.hello.savedMicMissing"));
});

test("a denied microphone gets one recovery card with a deep link and a re-check", async (t) => {
  const opened = [];
  const { ui, actions } = await hello(t, { access: "denied" });
  assert.equal(ui.byAttr("role", "alert").length, 1);
  globalThis.window.electronAPI.openMicrophoneSettings = async () => opened.push("privacy");
  await ui.click("setupFlow.hello.openSettings");
  await ui.click("setupFlow.hello.recheck");
  assert.deepEqual([opened, actions], [["privacy"], ["recheck"]]);
});

test("a microphone that will not open says so, and Try again reopens it (I01)", async (t) => {
  let retried = 0;
  const { ui, actions } = await hello(t, {
    access: "granted",
    preview: preview({ status: "failed", retry: () => retried++ }),
  });
  expectKey(ui, "setupFlow.hello.unavailableTitle");
  assert.equal(ui.byAttr("data-level-bar").length, 0);
  await ui.click("setupFlow.hello.retryOpen");
  assert.equal(retried, 1);
  assert.deepEqual(actions, [], "retrying an open is not a permission re-check");
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Faithful in-memory boundaries: real hook, real RMS, no native acquisition.
async function mountPreview(t, options = {}) {
  let root = null;
  const unmount = async () => {
    if (!root) return;
    const current = root;
    root = null;
    await React.act(async () => current.unmount());
  };
  t.after(async () => {
    await unmount();
    t.mock.restoreAll();
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const opened = [],
    stopped = [],
    closed = [],
    disconnected = [],
    requests = [],
    enumerations = [];
  const listeners = new Set();
  const setup = { failAt: null, amplitude: 0, ...options };
  const maybeFail = (point) => {
    if (setup.failAt === point) throw new Error(point);
  };
  const previousDevices = Object.getOwnPropertyDescriptor(globalThis.navigator, "mediaDevices");
  const mediaDevices = {
    getUserMedia(constraints) {
      opened.push(constraints);
      const index = opened.length;
      const pending = deferred();
      const tracks = [1, 2].map((n) => ({
        label: `Mic ${index}`,
        stop: () => stopped.push(`${index}.${n}`),
      }));
      const stream = { getTracks: () => tracks, getAudioTracks: () => [tracks[0]] };
      requests.push({
        grant: () => pending.resolve(stream),
        fail: () => pending.reject(new Error("busy")),
      });
      return pending.promise;
    },
    enumerateDevices() {
      const pending = deferred();
      enumerations.push(pending);
      if (!setup.deferEnumeration)
        pending.resolve([
          { kind: "audioinput", deviceId: "default", label: "Default" },
          { kind: "audioinput", deviceId: "usb", label: "USB Mic" },
        ]);
      return pending.promise;
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
      maybeFail("listener");
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: mediaDevices,
  });
  const previousContext = globalThis.AudioContext;
  globalThis.AudioContext = class {
    constructor() {
      maybeFail("context");
    }
    createAnalyser() {
      maybeFail("analyser");
      return {
        fftSize: 1024,
        getFloatTimeDomainData(buf) {
          maybeFail("sample");
          buf.fill(setup.amplitude);
        },
        disconnect() {
          disconnected.push("analyser");
        },
      };
    }
    createMediaStreamSource() {
      maybeFail("source");
      return {
        connect() {
          maybeFail("connect");
        },
        disconnect() {
          disconnected.push("source");
        },
      };
    }
    close() {
      closed.push("context");
      return setup.closeRejects ? Promise.reject(new Error("close")) : Promise.resolve();
    }
  };
  t.after(() => {
    globalThis.AudioContext = previousContext;
    if (previousDevices)
      Object.defineProperty(globalThis.navigator, "mediaDevices", previousDevices);
    else delete globalThis.navigator.mediaDevices;
  });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-mic-preview-test-" });
  const { useMicLevelPreview } = await vite.ssrLoadModule(
    "/components/onboarding/useMicLevelPreview.ts"
  );
  const { SILENCE_HINT_MS, VOICE_LEVEL_FLOOR } = await vite.ssrLoadModule(
    "/utils/onboardingTrial.ts"
  );
  const timers = new Map();
  let now = 0,
    nextTimer = 0;
  for (const [name, repeat] of [
    ["setInterval", true],
    ["setTimeout", false],
  ]) {
    t.mock.method(globalThis, name, (fn, delay) => {
      maybeFail(name);
      const id = ++nextTimer;
      timers.set(id, { fn, delay, at: now + delay, repeat });
      return id;
    });
  }
  for (const name of ["clearInterval", "clearTimeout"])
    t.mock.method(globalThis, name, (id) => timers.delete(id));
  let current;
  const renders = [];
  function Harness({ active, deviceId }) {
    current = useMicLevelPreview(active, deviceId);
    renders.push(current);
    return null;
  }
  root = createRoot(container);
  const settle = () => React.act(async () => {});
  const render = async (props) => {
    await React.act(async () =>
      root.render(
        options.strict
          ? React.createElement(React.StrictMode, null, React.createElement(Harness, props))
          : React.createElement(Harness, props)
      )
    );
    await settle();
  };
  const grant = async (index) => {
    await React.act(async () => requests[index].grant());
  };
  const fail = async (index) => {
    await React.act(async () => requests[index].fail());
  };
  const advance = async (ms) =>
    React.act(async () => {
      const until = now + ms;
      for (;;) {
        const next = [...timers]
          .filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.at;
        if (timer.repeat) timer.at += timer.delay;
        else timers.delete(id);
        timer.fn();
      }
      now = until;
    });
  const devicechange = async () => {
    await React.act(async () => {
      for (const listener of listeners) void listener();
    });
  };
  return {
    render,
    grant,
    fail,
    advance,
    devicechange,
    unmount,
    settle,
    current: () => current,
    opened,
    stopped,
    closed,
    disconnected,
    listeners,
    timers,
    enumerations,
    setup,
    renders,
    SILENCE_HINT_MS,
    VOICE_LEVEL_FLOOR,
  };
}

test("the preview lists inputs and reopens on the picked device", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true, deviceId: null });
  await mic.grant(0);
  assert.equal(mic.current().status, "live");
  assert.deepEqual(
    mic.current().inputs.map((input) => input.deviceId),
    ["usb"]
  );
  await mic.render({ active: true, deviceId: "usb" });
  assert.deepEqual(mic.opened, [{ audio: true }, { audio: { deviceId: { exact: "usb" } } }]);
  assert.deepEqual(
    mic.stopped,
    ["1.1", "1.2"],
    "the first stream is released before the second opens"
  );
});

test("leaving Hello stops the microphone", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true, deviceId: null });
  await mic.grant(0);
  await mic.render({ active: false, deviceId: null });
  assert.deepEqual(
    [mic.stopped, mic.closed, mic.current().status],
    [["1.1", "1.2"], ["context"], "off"]
  );
});

test("a microphone granted after Hello was left is stopped at once (I01)", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true, deviceId: null });
  await mic.unmount(); // the permission prompt is still open
  await mic.grant(0);
  assert.deepEqual(mic.stopped, ["1.1", "1.2"], "the late stream is released, not left recording");
  assert.deepEqual(mic.closed, [], "no analyser was ever built for it");
});

test("a device change during the prompt releases the stale stream (I01)", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true, deviceId: null });
  await mic.render({ active: true, deviceId: "usb" }); // first request still pending
  await mic.grant(0);
  assert.deepEqual(mic.stopped, ["1.1", "1.2"]);
  await mic.grant(1);
  assert.equal(mic.current().status, "live");
  assert.equal(mic.current().deviceLabel, "Mic 2");
});

test("a failed open can be retried while permission stays granted (I01)", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true, deviceId: null });
  await mic.fail(0);
  assert.equal(mic.current().status, "failed");
  await React.act(async () => mic.current().retry());
  await mic.grant(1);
  assert.equal(mic.current().status, "live");
  assert.equal(mic.opened.length, 2);
});

test("inactive never acquires; active=false releases a late stream and can re-enter", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: false });
  assert.equal(mic.opened.length, 0);
  await mic.render({ active: true });
  await mic.render({ active: false });
  await mic.grant(0);
  assert.deepEqual(mic.stopped, ["1.1", "1.2"]);
  assert.equal(mic.current().status, "off");
  await mic.render({ active: true });
  await mic.grant(1);
  assert.equal(mic.current().deviceLabel, "Mic 2");
});

test("a stale rejected open cannot replace a newer live owner", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true });
  await mic.render({ active: true, deviceId: "usb" });
  await mic.grant(1);
  await mic.fail(0);
  assert.equal(mic.current().status, "live");
  assert.equal(mic.current().deviceLabel, "Mic 2");
  assert.deepEqual(mic.stopped, []);
  assert.deepEqual(mic.closed, []);
});

test("enumeration follows current owner and latest devicechange; failure keeps the last list", async (t) => {
  const mic = await mountPreview(t, { deferEnumeration: true });
  const inputs = (id) => [{ kind: "audioinput", deviceId: id, label: id }];
  await mic.render({ active: true });
  await mic.grant(0);
  await mic.render({ active: true, deviceId: "usb" });
  await mic.grant(1);
  await React.act(async () => mic.enumerations[1].resolve(inputs("new")));
  await React.act(async () => mic.enumerations[0].resolve(inputs("old")));
  assert.equal(mic.current().inputs[0].deviceId, "new");
  await mic.devicechange();
  await mic.devicechange();
  await React.act(async () => mic.enumerations[3].resolve(inputs("latest")));
  await React.act(async () => mic.enumerations[2].resolve(inputs("stale")));
  assert.equal(mic.current().inputs[0].deviceId, "latest");
  await mic.devicechange();
  await React.act(async () => mic.enumerations[4].reject(new Error("enumeration")));
  assert.equal(mic.current().status, "live");
  assert.equal(mic.current().inputs[0].deviceId, "latest");
  await mic.devicechange();
  await mic.render({ active: false });
  await React.act(async () => mic.enumerations[5].resolve(inputs("after-leave")));
  assert.equal(mic.current().inputs[0].deviceId, "latest");
  assert.equal(mic.listeners.size, 0);
  assert.equal(mic.timers.size, 0);
});

for (const failAt of [
  "context",
  "analyser",
  "source",
  "connect",
  "listener",
  "setTimeout",
  "setInterval",
  "sample",
]) {
  test(`partial setup failure at ${failAt} releases tracks, context, nodes, timers and listener`, async (t) => {
    const mic = await mountPreview(t, { failAt, closeRejects: true });
    await mic.render({ active: true });
    await mic.grant(0);
    if (failAt === "sample") await mic.advance(80);
    assert.equal(mic.current().status, "failed");
    assert.deepEqual(mic.stopped, ["1.1", "1.2"]);
    assert.equal(mic.closed.length, failAt === "context" ? 0 : 1);
    assert.equal(mic.listeners.size, 0);
    assert.equal(mic.timers.size, 0);
    assert.deepEqual(
      mic.disconnected,
      ["context", "analyser"].includes(failAt)
        ? []
        : failAt === "source"
          ? ["analyser"]
          : ["source", "analyser"]
    );
    mic.setup.failAt = null;
    await React.act(async () => mic.current().retry());
    await mic.grant(1);
    assert.equal(mic.current().status, "live");
    await mic.unmount();
    assert.equal(mic.timers.size, 0);
    assert.equal(mic.listeners.size, 0);
    assert.deepEqual(mic.stopped, ["1.1", "1.2", "2.1", "2.2"]);
  });
}

test("real RMS floor and silence timer highlight only until voice; new device has no old proof even on first render", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true });
  await mic.grant(0);
  mic.setup.amplitude = mic.VOICE_LEVEL_FLOOR / 2;
  await mic.advance(mic.SILENCE_HINT_MS - 1);
  assert.equal(mic.current().heardVoice, false);
  assert.equal(mic.current().silent, false);
  await mic.advance(1);
  assert.equal(mic.current().silent, true);
  mic.setup.amplitude = mic.VOICE_LEVEL_FLOOR * 2;
  await mic.advance(80);
  assert.equal(mic.current().heardVoice, true);
  assert.equal(mic.current().silent, false);
  assert.ok(mic.current().readLevel() > mic.VOICE_LEVEL_FLOOR);
  const count = mic.renders.length;
  await mic.render({ active: true, deviceId: "usb" });
  assert.equal(
    mic.renders[count].heardVoice,
    false,
    "render cannot relabel the previous owner's proof before effects reset"
  );
  assert.equal(mic.renders[count].deviceLabel, null);
  assert.equal(mic.current().readLevel(), 0);
  await mic.grant(1);
  mic.setup.amplitude = 0;
  await mic.advance(mic.SILENCE_HINT_MS);
  assert.equal(mic.current().heardVoice, false);
  assert.equal(mic.current().silent, true);
  await mic.render({ active: false });
  assert.equal(mic.current().heardVoice, false);
  assert.equal(mic.current().readLevel(), 0);
  assert.deepEqual(mic.disconnected, ["source", "analyser", "source", "analyser"]);
  assert.equal(mic.timers.size, 0);
  assert.equal(mic.listeners.size, 0);
});

test("granted permission while opening does not claim a microphone is listening", async (t) => {
  const { ui } = await hello(t, { access: "granted", preview: preview({ status: "starting" }) });
  assert.ok(ui.text().includes("setupFlow.hello.starting"));
  assert.equal(ui.text().includes("setupFlow.hello.micReady"), false);
  assert.equal(ui.byAttr("data-level-bar").length, 0);
});

test("sound settings help is optional; retry remains available without an IPC method", async (t) => {
  const { ui } = await hello(t, { access: "granted", preview: preview({ status: "failed" }) });
  globalThis.window.electronAPI = {};
  await ui.click("setupFlow.hello.openSound");
  assert.ok(ui.text().includes("setupFlow.hello.retryOpen"));
});

test("StrictMode's discarded effect releases its late stream without replacing the live effect", async (t) => {
  const mic = await mountPreview(t, { strict: true });
  await mic.render({ active: true });
  assert.equal(mic.opened.length, 2);
  await mic.grant(1);
  await mic.grant(0);
  assert.equal(mic.current().deviceLabel, "Mic 2");
  assert.deepEqual(mic.stopped, ["1.1", "1.2"]);
  await mic.unmount();
  assert.deepEqual(mic.stopped, ["1.1", "1.2", "2.1", "2.2"]);
  assert.equal(mic.closed.length, 1);
});

test("a stale enumeration rejection cannot fail the new device owner", async (t) => {
  const mic = await mountPreview(t, { deferEnumeration: true });
  await mic.render({ active: true });
  await mic.grant(0);
  await mic.render({ active: true, deviceId: "usb" });
  await mic.grant(1);
  await React.act(async () =>
    mic.enumerations[1].resolve([{ kind: "audioinput", deviceId: "usb", label: "USB" }])
  );
  await React.act(async () => mic.enumerations[0].reject(new Error("old enumeration")));
  assert.equal(mic.current().status, "live");
  assert.equal(mic.current().deviceLabel, "Mic 2");
  assert.equal(mic.current().inputs[0].deviceId, "usb");
});
