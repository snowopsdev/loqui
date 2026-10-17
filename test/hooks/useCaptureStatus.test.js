const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

async function mount(t) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  let resolveInitial;
  const initial = new Promise((resolve) => {
    resolveInitial = resolve;
  });
  let push;
  let levelPush;
  let offCount = 0;
  let offLevelCount = 0;
  const order = [];
  const intervals = new Map();
  const focusHandlers = new Map();
  let micGranted = true;
  let micChecks = 0;
  let nextTimer = 0;
  const window = {
    electronAPI: {
      onDictationLifecycleChanged: (listener) => {
        order.push("subscribe");
        push = listener;
        return () => {
          offCount++;
        };
      },
      getDictationLifecycleState: () => {
        order.push("pull");
        return initial;
      },
      onDictationLevelChanged: (listener) => {
        levelPush = listener;
        return () => {
          offLevelCount++;
        };
      },
      toggleDictationFromControlPanel: async () => {
        order.push("toggle");
      },
      checkMicrophoneAccess: async () => {
        micChecks++;
        return { granted: micGranted };
      },
    },
    addEventListener: (name, handler) => {
      if (name === "focus") focusHandlers.set(name, handler);
    },
    removeEventListener: (name) => focusHandlers.delete(name),
    setInterval: (fn, ms) => {
      const id = ++nextTimer;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
  };
  installBrowserGlobals(t, { window });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-capture-status-hook-",
    mockModules: {
      "stores/meetingRecordingStore": `
        import React from "react";
        const listeners = new Set();
        let meeting = { isRecording: false, recordingStartedAt: null, micCaptureStatus: "inactive", currentMicLevel: 0.25 };
        globalThis.__setCaptureMeeting = (patch) => { meeting = { ...meeting, ...patch }; for (const listener of listeners) listener(meeting); };
        export const useMeetingRecordingStore = Object.assign((selector) => React.useSyncExternalStore((notify) => { listeners.add(notify); return () => listeners.delete(notify); }, () => selector(meeting)), { getState: () => meeting, setState: (patch) => { meeting = { ...meeting, ...patch }; for (const listener of listeners) listener(meeting); }, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } });
        export const stopRecording = async () => { globalThis.__stops = (globalThis.__stops || 0) + 1; };
      `,
    },
  });
  const { useCaptureStatus, useLiveClock } = await vite.ssrLoadModule("/hooks/useCaptureStatus.ts");
  let status;
  let now;
  function Harness({ active = false }) {
    status = useCaptureStatus();
    now = useLiveClock(active);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  return {
    order,
    status: () => status,
    now: () => now,
    intervals,
    push: async (snapshot) => React.act(async () => push(snapshot)),
    setMeeting: async (patch) => React.act(async () => globalThis.__setCaptureMeeting(patch)),
    meetingStops: () => globalThis.__stops || 0,
    pushLevel: (level) => levelPush(level),
    pull: async (snapshot) =>
      React.act(async () => {
        resolveInitial(snapshot);
        await initial;
      }),
    unmount: async () => {
      await React.act(async () => root.unmount());
      root = null;
    },
    offCount: () => offCount,
    offLevelCount: () => offLevelCount,
    setActive: async (active) =>
      React.act(async () => root.render(React.createElement(Harness, { active }))),
    refreshMicOnFocus: async (granted) => {
      micGranted = granted;
      await React.act(async () => focusHandlers.get("focus")());
    },
    micChecks: () => micChecks,
    tickClock: async (timer) => React.act(async () => timer.fn()),
  };
}

test("subscribes before pull and applies initial state when no push arrives", async (t) => {
  const h = await mount(t);
  assert.deepEqual(h.order, ["subscribe", "pull"]);
  await h.pull({ state: "recording", inputKind: "assistant" });
  assert.equal(h.status().kind, "listening");
  assert.equal(h.status().inputKind, "assistant");
  assert.equal(typeof h.status().startedAt, "number");
});

test("any push supersedes the initial snapshot", async (t) => {
  for (const [initialState, pushedState, expectedKind] of [
    ["recording", "idle", "ready"],
    ["idle", "recording", "listening"],
    ["recording", "processing", "processing"],
  ]) {
    await t.test(`${initialState} pull after ${pushedState} push`, async (t) => {
      const h = await mount(t);
      await h.push({ state: pushedState, inputKind: "translation" });
      const before = h.status();
      await h.pull({ state: initialState, inputKind: "assistant" });
      assert.equal(h.status().kind, expectedKind);
      assert.equal(h.status().inputKind, before.inputKind);
      assert.equal(h.status().startedAt, before.startedAt);
      assert.equal(h.status().source, before.source);
    });
  }
});

test("unmount unsubscribes and ignores late results", async (t) => {
  const h = await mount(t);
  const before = h.status();
  await h.unmount();
  assert.equal(h.offCount(), 1);
  assert.equal(h.offLevelCount(), 1);
  await h.pull({ state: "recording", inputKind: "assistant" });
  assert.equal(h.status(), before);
  assert.equal(
    before.readLevel(),
    0.25,
    "late recording pull cannot redirect retained level reader"
  );
});

test("explicit dictation toggle can start while stop only stops a live dictation", async (t) => {
  const h = await mount(t);
  await h.status().toggleDictation();
  assert.equal(h.order.filter((entry) => entry === "toggle").length, 1);
  await h.push({ state: "recording", inputKind: "dictation" });
  const retainedStop = h.status().stop;
  h.pushLevel(0.6);
  assert.equal(h.status().readLevel(), 0.6);
  await retainedStop();
  assert.equal(h.order.filter((entry) => entry === "toggle").length, 2);
  await h.push({ state: "idle", inputKind: "dictation" });
  assert.equal(h.status().readLevel(), 0.25, "idle reads the meeting microphone level");
});

test("stop is a no-op in ready, permission-offline, and processing states", async (t) => {
  const h = await mount(t);
  await h.status().stop();
  assert.equal(h.order.filter((entry) => entry === "toggle").length, 0);
  await h.refreshMicOnFocus(false);
  await h.status().stop();
  assert.equal(h.order.filter((entry) => entry === "toggle").length, 0);
  await h.push({ state: "processing", inputKind: "dictation" });
  await h.status().stop();
  assert.equal(h.order.filter((entry) => entry === "toggle").length, 0);
});

test("a retained stop callback cannot start capture after an idle push", async (t) => {
  const h = await mount(t);
  await h.push({ state: "recording", inputKind: "dictation" });
  const retainedStop = h.status().stop;
  await h.push({ state: "idle", inputKind: "dictation" });
  await retainedStop();
  assert.equal(h.order.filter((entry) => entry === "toggle").length, 0);
});

test("stop dispatches live meeting stop even when its mic is lost", async (t) => {
  for (const micCaptureStatus of ["active", "unavailable", "reconnecting"]) {
    await t.test(micCaptureStatus, async (t) => {
      const h = await mount(t);
      await h.setMeeting({ isRecording: true, recordingStartedAt: 123, micCaptureStatus });
      const retainedStop = h.status().stop;
      const stopsBefore = h.meetingStops();
      await retainedStop();
      assert.equal(h.meetingStops(), stopsBefore + 1);
      assert.equal(h.order.filter((entry) => entry === "toggle").length, 0);
    });
  }
});

test("microphone permission refreshes on focus", async (t) => {
  const h = await mount(t);
  await React.act(async () => new Promise((resolve) => setImmediate(resolve)));
  assert.equal(h.micChecks(), 1);
  await h.refreshMicOnFocus(false);
  assert.equal(h.micChecks(), 2);
  assert.equal(h.status().kind, "offline");
  assert.equal(h.status().offlineReason, "permission");
});

test("live clock owns one interval only while active", async (t) => {
  const h = await mount(t);
  assert.equal(h.intervals.size, 0);
  const idleNow = h.now();
  await h.setActive(true);
  assert.equal(h.intervals.size, 1);
  const [timer] = h.intervals.values();
  assert.equal(timer.ms, 1000);
  await h.tickClock(timer);
  assert.ok(h.now() >= idleNow);
  await h.setActive(false);
  assert.equal(h.intervals.size, 0);
});
