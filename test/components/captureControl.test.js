const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

async function mount(t, { initialStorage = {}, storageThrows = false } = {}) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const intervals = new Map();
  let timerId = 0;
  const { storage } = installBrowserGlobals(t, {
    initialStorage,
    window: {
      setInterval: (fn, ms) => {
        const id = ++timerId;
        intervals.set(id, { fn, ms });
        return id;
      },
      clearInterval: (id) => intervals.delete(id),
    },
  });
  if (storageThrows)
    Object.defineProperty(globalThis.window, "localStorage", {
      get() {
        throw new Error("fixture denied");
      },
    });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    mockModules: {
      "/stores/meetingRecordingStore": `export const useMeetingRecordingStore = () => ({}); export const stopRecording = async () => {};`,
    },
  });
  const { default: Control } = await vite.ssrLoadModule("/components/CaptureControl.tsx");
  const { WorkspaceNavigationProvider } = await vite.ssrLoadModule(
    "/components/workspaceNavigation.tsx"
  );
  const calls = [];
  const navigation = Object.fromEntries(
    ["recordMeeting", "openUpload", "newNote", "startChat"].map((key) => [
      key,
      (...args) => calls.push([key, ...args]),
    ])
  );
  let menu;
  const capture = {
    kind: "ready",
    source: null,
    startedAt: null,
    readLevel: () => 0.4,
    toggleDictation: async () => {
      calls.push(["dictate"]);
    },
    stop: async () => {
      calls.push(["stop"]);
    },
  };
  function Probe({ capture }) {
    menu = Control({ capture, hotkey: "Fn,CommandOrControl+Shift+D", showChat: true });
    return null;
  }
  async function render(value) {
    await React.act(async () =>
      root.render(
        React.createElement(
          WorkspaceNavigationProvider,
          { value: navigation },
          React.createElement(Probe, { capture: value })
        )
      )
    );
  }
  root = createRoot(container);
  await render(capture);
  return {
    menu: () => menu.props,
    storage,
    calls,
    capture,
    intervals,
    render,
    unmount: async () => {
      await React.act(async () => root.unmount());
      root = null;
    },
  };
}

test("Capture dispatches each path, persists the primary action, and forwards the shared status/level/Stop", async (t) => {
  const h = await mount(t, { initialStorage: { "capture.lastAction": "upload" } });
  assert.equal(h.menu().lastAction, "upload");
  assert.equal(h.menu().hotkeyLabel, "Globe/Fn");
  assert.equal(h.menu().status, h.capture);
  assert.equal(h.menu().readLevel, h.capture.readLevel);
  for (const [action, destination] of [
    ["dictate", "dictate"],
    ["recordMeeting", "recordMeeting"],
    ["upload", "openUpload"],
    ["newNote", "newNote"],
    ["newChat", "startChat"],
  ]) {
    await React.act(async () => h.menu().onRun(action));
    assert.deepEqual(h.calls.at(-1), [destination], "no chat draft or implicit send");
    assert.equal(h.menu().lastAction, action);
    assert.equal(h.storage.getItem("capture.lastAction"), action);
  }
  await React.act(async () => h.menu().onStop());
  assert.deepEqual(h.calls.at(-1), ["stop"]);
  assert.equal(
    h.storage.getItem("capture.lastAction"),
    "newChat",
    "Stop does not overwrite the remembered action"
  );
});

test("Capture storage denial keeps actions usable", async (t) => {
  const h = await mount(t, { storageThrows: true });
  assert.equal(h.menu().lastAction, "dictate");
  await React.act(async () => h.menu().onRun("upload"));
  assert.equal(h.menu().lastAction, "upload");
  assert.deepEqual(h.calls, [["openUpload"]]);
});

test("Capture clock exists only while live and is cleared on processing/unmount", async (t) => {
  const h = await mount(t);
  assert.equal(h.intervals.size, 0);
  await h.render({ ...h.capture, kind: "listening", source: "dictation", startedAt: 0 });
  assert.equal(h.intervals.size, 1);
  assert.equal([...h.intervals.values()][0].ms, 1000);
  await h.render({ ...h.capture, kind: "processing" });
  assert.equal(h.intervals.size, 0);
  await h.render({ ...h.capture, kind: "listening" });
  await h.unmount();
  assert.equal(h.intervals.size, 0);
});
