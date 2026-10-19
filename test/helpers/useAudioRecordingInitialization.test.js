const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("useAudioRecording accepts an onboarding event handler on its initial render", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-audio-recording-initialization-",
    mockModules: {
      "/helpers/audioManager": "export default class AudioManager {}",
    },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");

  function InitialRenderProbe() {
    useAudioRecording({ onDemoEvent: () => {} });
    return React.createElement("div");
  }

  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(InitialRenderProbe)));
});

test("the actual recording hook exposes live meeting presence without starting audio", async (t) => {
  const { createRoot } = require("react-dom/client");
  const { installHookDom } = require("../lib/rendererTestHarness");
  let root, api, changed;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const noop = () => () => {};
  const meeting = { sessionId: "m1", startedAt: 1000, quiet: false, interruption: null };
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onToggleDictation: noop,
        onToggleVoiceAgent: noop,
        onToggleTranslation: noop,
        onStartDictation: noop,
        onPrepareDictation: noop,
        onCancelDictationPreparation: noop,
        onStopDictation: noop,
        onCancelDictation: noop,
        getMeetingRecordingPresence: async () => meeting,
        onMeetingRecordingPresenceChanged: (cb) => {
          changed = cb;
          return () => {};
        },
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-meeting-audio-hook-",
    mockModules: {
      "/helpers/audioManager":
        "export default class {setCallbacks(){} getState(){return {}} shouldUseStreaming(){return false} cleanup(){} }",
    },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  function Probe() {
    api = useAudioRecording({});
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  assert.deepEqual(api.meetingRecording, meeting);
  assert.equal(api.isRecording, false);
  await React.act(async () => changed(null));
  assert.equal(api.meetingRecording, null);
});
