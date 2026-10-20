const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { deferred } = require("../helpers/harness/deferred");

for (const transition of ["hide", "hide/reopen", "unmount"]) {
  test(`a synthetic pending mic admission cannot outlive ${transition}`, async (t) => {
    let root;
    let unmounted = false;
    t.after(async () => {
      if (root && !unmounted) await React.act(async () => root.unmount());
    });
    installBrowserGlobals(t);
    const container = installHookDom(t);
    const pending = deferred();
    const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { mediaDevices: { getUserMedia: () => pending.promise } },
    });
    t.after(() =>
      oldNavigator
        ? Object.defineProperty(globalThis, "navigator", oldNavigator)
        : delete globalThis.navigator
    );
    const vite = await createRendererServer(t, {
      mockModules: {
        "/hooks/useSettings": `export const useSettings = () => ({ useLocalWhisper: true });`,
        "/stores/settingsStore": `export const useSettingsStore = (select) => select({});`,
      },
    });
    const { useVoiceDraft } = await vite.ssrLoadModule("/components/chat/useVoiceDraft.ts");
    let hook;
    const errors = [];
    function Probe({ active }) {
      hook = useVoiceDraft({
        active,
        onTranscript: () => assert.fail("no transcript"),
        onError: (error) => errors.push(error),
      });
      return null;
    }
    root = createRoot(container);
    await React.act(async () => root.render(React.createElement(Probe, { active: true })));
    const starting = hook.start();
    await React.act(async () => {
      if (transition === "unmount") {
        root.unmount();
        unmounted = true;
      } else root.render(React.createElement(Probe, { active: false }));
    });
    if (transition === "hide/reopen")
      await React.act(async () => root.render(React.createElement(Probe, { active: true })));
    let stopped = 0;
    // No real capture or permissions: only a pending synthetic boundary promise.
    await React.act(async () => {
      pending.resolve({ getTracks: () => [{ stop: () => stopped++ }] });
      await starting;
    });
    assert.equal(
      stopped,
      1,
      "the late synthetic stream is released before constructing audio resources"
    );
    assert.deepEqual(errors, [], "obsolete admissions cannot toast into the current host");
  });
}

for (const reopen of [false, true]) {
  test(`an in-flight synthetic transcription stays obsolete after hide${reopen ? "/reopen" : ""}`, async (t) => {
    let root;
    t.after(async () => {
      if (root) await React.act(async () => root.unmount());
    });
    installBrowserGlobals(t, {
      window: {
        electronAPI: {
          saveTempAudio: async () => ({ path: "/synthetic/task16.webm" }),
          deleteTempAudio: async (path) => deleted.push(path),
        },
      },
    });
    const container = installHookDom(t);
    const pending = deferred();
    const deleted = [];
    const transcripts = [];
    const errors = [];
    let recorder;
    const globals = new Map();
    const replace = (key, value) => {
      globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    };
    t.after(() => {
      for (const [key, descriptor] of globals)
        descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
    });
    replace("__task16Transcribe", () => pending.promise);
    replace("navigator", {
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    replace(
      "AudioContext",
      class {
        destination = {};
        createMediaStreamSource() {
          return { connect() {} };
        }
        createAnalyser() {
          return { connect() {} };
        }
        createGain() {
          return { gain: {}, connect() {} };
        }
        close() {
          return Promise.resolve();
        }
      }
    );
    replace(
      "MediaRecorder",
      class {
        constructor() {
          recorder = this;
        }
        start() {}
        stop() {
          this.onstop();
        }
      }
    );
    const vite = await createRendererServer(t, {
      mockModules: {
        "/hooks/useSettings": `export const useSettings = () => ({ useLocalWhisper: true });`,
        "/stores/settingsStore": `export const useSettingsStore = (select) => select({});`,
        "/services/fileTranscription": `export const resolveFileTranscriptionRoute = () => null; export const transcribeFile = (...args) => globalThis.__task16Transcribe(...args);`,
      },
    });
    const { useVoiceDraft } = await vite.ssrLoadModule("/components/chat/useVoiceDraft.ts");
    let hook;
    function Probe({ active }) {
      hook = useVoiceDraft({
        active,
        onTranscript: (text) => transcripts.push(text),
        onError: (error) => errors.push(error),
      });
      return null;
    }
    root = createRoot(container);
    await React.act(async () => root.render(React.createElement(Probe, { active: true })));
    await React.act(async () => hook.start());
    await React.act(async () => {
      recorder.ondataavailable({ data: new Blob(["synthetic audio bytes"]) });
      hook.stop();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(hook.status, "transcribing");
    await React.act(async () => root.render(React.createElement(Probe, { active: false })));
    if (reopen)
      await React.act(async () => root.render(React.createElement(Probe, { active: true })));
    await React.act(async () => {
      pending.resolve({ success: true, text: "Obsolete synthetic words" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(transcripts, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(deleted, ["/synthetic/task16.webm"]);
    assert.equal(hook.status, "idle");
  });
}
