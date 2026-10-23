const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("the actual mount reports live store presence and handles only session-bound Stop without changing interruption delivery", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const reports = [],
    outcomes = [],
    native = [],
    stopped = [];
  let stopRequest;
  const api = {
    reportMeetingRecordingPresence: (p) => reports.push(p),
    reportMeetingRecordingOutcome: (o) => outcomes.push(o),
    onMeetingRecordingStopRequested: (cb) => {
      stopRequest = cb;
      return () => {
        stopRequest = null;
      };
    },
    meetingTranscriptionStop: async (id) => {
      stopped.push(id);
      return { success: true };
    },
    showSystemNotification: async (payload) => {
      native.push(payload);
      return true;
    },
  };
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-meeting-presence-mount-",
    mockModules: {
      "/utils/logger": "export default {error(){},warn(){},info(){},debug(){}}",
      "/stores/settingsStore":
        "export const getSettings=()=>({}); export const selectResolvedMeetingTranscription=()=>({});",
      "react-i18next": "const t=(key)=>key;export const useTranslation=()=>({t});",
      "/ui/notices": "export const notify=()=>'';export const dismissNotice=()=>{};",
    },
  });
  const store = await vite.ssrLoadModule("/stores/meetingRecordingStore.ts");
  const Mount = (await vite.ssrLoadModule("/components/MeetingRecordingMount.tsx")).default;
  assert.equal(store.useMeetingRecordingStore.getState().micQuiet, false);
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Mount)));
  assert.equal(reports.at(-1).recording, false);
  await React.act(async () =>
    store.__primeRecordingForTests({ sessionId: "A", noteId: 11, startedAt: 1000, segments: [] })
  );
  assert.deepEqual(reports.at(-1), {
    recording: true,
    sessionId: "A",
    startedAt: 1000,
    interruption: null,
    quiet: false,
  });
  await React.act(async () =>
    store.useMeetingRecordingStore.setState({ micCaptureStatus: "unavailable" })
  );
  assert.equal(reports.at(-1).interruption, "mic");
  assert.equal(native.length, 1);
  assert.equal("actions" in native[0], false, "Plan02 native interruptions stay action-free");
  await React.act(async () =>
    store.useMeetingRecordingStore.setState({
      systemAudioInterrupted: { recovering: false, reason: "gone_quiet" },
      systemAudioInterruptedNonce: 1,
      micQuiet: true,
    })
  );
  assert.equal(reports.at(-1).interruption, "systemAudio");
  assert.equal(reports.at(-1).quiet, true);
  assert.equal(native.length, 2);
  assert.equal("actions" in native[1], false);
  await React.act(async () => {
    stopRequest("stale");
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(store.getActiveRecordingSessionId(), "A");
  assert.equal(stopped.length, 0);
  await React.act(async () => {
    stopRequest("A");
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.deepEqual(stopped, ["A"]);
  assert.equal(reports.at(-1).recording, false);
  assert.equal(reports.at(-1).sessionId, "A", "Stop/timer-reset false reports stay bound to A");
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].kind, "saved");
  await React.act(async () => root.unmount());
  root = null;
  assert.equal(stopRequest, null, "stop subscription removed on unmount");
});
