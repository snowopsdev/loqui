const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { resolveTokens } = require("../helpers/harness/cssTokens");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

test("quiet requires four continuous seconds and resets on speech or invalid samples", async () => {
  const { createQuietDetector, MEETING_LEVEL_SAMPLE_MS } =
    await import("../../src/utils/meetingQuiet.ts");
  assert.equal(MEETING_LEVEL_SAMPLE_MS, 84);
  assert.ok(1000 / MEETING_LEVEL_SAMPLE_MS <= 12);
  const quiet = createQuietDetector();
  assert.equal(quiet(0.001, 0), false);
  assert.equal(quiet(0.001, 3999), false);
  assert.equal(quiet(0.001, 4000), true);
  assert.equal(quiet(0.01, 4100), false);
  assert.equal(quiet(0, 4200), false);
  assert.equal(quiet(NaN, 8200), false);
  assert.equal(quiet(0, 8300), false);
  assert.equal(quiet(0, 12299), false);
  assert.equal(quiet(0, 12300), true);
  assert.equal(quiet(Infinity, 12400), false);
  const custom = createQuietDetector({ threshold: 0.2, holdMs: 100 });
  assert.equal(custom(0.1, 0), false);
  assert.equal(custom(0.1, 100), true);
  assert.equal(custom(0.2, 101), false);
});

test("every migrated voice meter uses LevelBars; fake wave modules and importers are gone", () => {
  for (const file of [
    "src/components/notes/NoteRecordControl.tsx",
    "src/components/notes/MeetingRecordingPill.tsx",
    "src/components/chat/ChatInput.tsx",
  ]) {
    assert.match(read(file), /<LevelBars/, file);
    assert.doesNotMatch(read(file), /LiveWaveform|ow-wave|computeBarHeight/, file);
  }
  assert.match(read("src/components/notes/NoteRecordControl.tsx"), /export function RecordingWave/);
  assert.doesNotMatch(read("src/components/notes/MeetingRecordingPill.tsx"), /currentMicLevel/);
  assert.doesNotMatch(
    read("src/components/MeetingRecordingMount.tsx"),
    /requestAnimationFrame\(tick\)/
  );
  assert.doesNotMatch(read("src/index.css"), /@keyframes ow-wave/);
  for (const file of ["LiveWaveform.tsx", "liveWaveformMath.ts"])
    assert.equal(fs.existsSync(path.join(repoRoot, "src/components/ui", file)), false);
});

test("all eight literal speaker roles pass every surface in Light and Plum Night", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(read("src/index.css"));
  const chat = read("src/components/notes/MeetingTranscriptChat.tsx");
  for (let i = 1; i <= 8; i++) {
    assert.ok(chat.includes(`"text-speaker-${i}"`));
    assert.ok(chat.includes(`"border-s-speaker-${i}/50"`));
    for (const [theme, map] of [
      ["light", light],
      ["dark", dark],
    ]) {
      const fg = map[`--color-speaker-${i}`];
      assert.ok(fg, `${theme} speaker ${i}`);
      for (const bg of [
        "--color-background",
        "--color-surface-1",
        "--color-surface-2",
        "--color-card",
        "--color-popover",
      ]) {
        assert.ok(
          contrastRatio(fg, map[bg]) >= 4.5,
          `${theme} speaker ${i} on ${bg}: ${contrastRatio(fg, map[bg])}`
        );
      }
    }
  }
  assert.doesNotMatch(chat, /text-(purple|orange|red)-400|border-s-(purple|orange|red)-400/);
});

// Mount the production effect and real Zustand recording store. Only external
// capture/preload leaves and the clock are synthetic; no device is accessed.
test("mounted sampler atomically publishes at <=12Hz, reports quiet, resets and cleans up", async (t) => {
  let root;
  let root2;
  let store;
  let mounted = false;
  t.after(async () => {
    if (root2) await React.act(async () => root2.unmount());
    if (mounted) await React.act(async () => root.unmount());
    if (store)
      await React.act(async () => store.useMeetingRecordingStore.setState({ isRecording: false }));
    delete globalThis.__meetingMeterAnalyser;
  });
  const noop = () => () => {};
  const reports = [];
  const api = {
    reportMeetingRecordingPresence: (value) => reports.push(value),
    checkSystemAudioAccess: async () => ({
      granted: true,
      status: "granted",
      mode: "native",
      strategy: "native",
    }),
    meetingTranscriptionStart: async () => ({
      success: true,
      systemAudioMode: "native",
      systemAudioStrategy: "native",
    }),
    meetingTranscriptionSetSystemAudioAvailable: async () => ({ success: true }),
    meetingTranscriptionStop: async () => ({ success: true }),
    meetingTranscriptionSend() {},
    onMeetingTranscriptionSegment: noop,
    onMeetingSpeakerIdentified: noop,
    onMeetingSpeakersMerged: noop,
    onMeetingSessionSpeakerConfigUpdated: noop,
    onMeetingTranscriptionError: noop,
    onMeetingTranscriptionFatalError: noop,
    onMeetingSystemAudioSilent: noop,
    onMeetingSystemAudioInterrupted: noop,
    onMeetingSystemAudioResumed: noop,
    onMeetingAutoEndRequested: noop,
  };
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const container = installHookDom(t);
  globalThis.document.visibilityState = "visible";
  globalThis.document.hasFocus = () => true;
  let amplitude = 0;
  const analyser = () => ({ fftSize: 256, getFloatTimeDomainData: (buf) => buf.fill(amplitude) });
  globalThis.__meetingMeterAnalyser = analyser();
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-meeting-meters-",
    mockModules: {
      "/stores/meetingRecordingStore": `
        export * from "/stores/meetingRecordingStore.ts";
        export const getMicAnalyser = () => globalThis.__meetingMeterAnalyser;
      `,
    },
  });
  await vite.ssrLoadModule("/i18n.ts");
  const { default: Mount } = await vite.ssrLoadModule("/components/MeetingRecordingMount.tsx");
  store = await vite.ssrLoadModule("/stores/meetingRecordingStore.ts");
  const { readMeetingMicLevel } = await vite.ssrLoadModule("/utils/meetingMicLevel.ts");
  const state = store.useMeetingRecordingStore;
  root = createRoot(container);
  mounted = true;
  await React.act(async () => root.render(React.createElement(Mount)));
  // Install the sampler clock before setting the real store recording state.
  // The analyser getter is the only audio leaf; capture is never started.
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  const originalNow = Object.getOwnPropertyDescriptor(globalThis.performance, "now");
  const intervals = new Map();
  let now = 0;
  let nextId = 1;
  Object.defineProperty(globalThis.performance, "now", { configurable: true, value: () => now });
  globalThis.setInterval = (fn, ms) => {
    const id = nextId++;
    intervals.set(id, { fn, ms });
    return id;
  };
  globalThis.clearInterval = (id) => {
    intervals.delete(id);
    originalClear(id);
  };
  t.after(() => {
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
    if (originalNow) Object.defineProperty(globalThis.performance, "now", originalNow);
    else delete globalThis.performance.now;
  });
  await React.act(async () =>
    state.setState({ isRecording: true, recordingStartedAt: 0, micCaptureStatus: "active" })
  );
  assert.equal(intervals.size, 1);
  const sampler = [...intervals.values()][0];
  assert.equal(sampler.ms, 84);
  const publications = [];
  const unsubscribe = state.subscribe((value, previous) =>
    publications.push({
      at: now,
      level: value.currentMicLevel,
      quiet: value.micQuiet,
      previousQuiet: previous.micQuiet,
    })
  );
  t.after(unsubscribe);
  const tick = async (at) => {
    now = at;
    const before = publications.length;
    await React.act(async () => sampler.fn());
    assert.ok(publications.length - before <= 1, `atomic tick at ${at}`);
  };
  assert.equal(readMeetingMicLevel(), 0);
  await tick(84);
  const afterFirstSample = publications.length;
  await tick(168);
  assert.equal(publications.length, afterFirstSample, "unchanged samples do not publish");
  await tick(4083);
  assert.equal(state.getState().micQuiet, false);
  await tick(4084);
  assert.equal(state.getState().micQuiet, true);
  assert.equal(reports.at(-1).quiet, true);
  amplitude = 0.8;
  assert.ok(readMeetingMicLevel() > 0.79, "meters read analyser before a store publication");
  const beforeSpeech = publications.length;
  await tick(4168);
  assert.equal(
    publications.length,
    beforeSpeech + 1,
    "level and quiet reset share one publication"
  );
  assert.equal(state.getState().micQuiet, false);
  assert.ok(state.getState().currentMicLevel > 0.39);
  assert.equal(reports.at(-1).quiet, false);
  publications.length = 0;
  for (let at = 4252; at < 5252; at += 84) {
    amplitude = Math.round((at - 4252) / 84) % 2 ? 0.1 : 0.8;
    await tick(at);
  }
  assert.ok(publications.length <= 12);
  assert.ok(publications.length >= 10, "exercise moving levels, not a vacuous rate count");
  // A missing/replaced analyser and invalid samples reset measured silence.
  amplitude = 0;
  globalThis.__meetingMeterAnalyser = analyser();
  await tick(6000);
  await tick(10000);
  assert.equal(state.getState().micQuiet, true);
  globalThis.__meetingMeterAnalyser = null;
  await tick(10084);
  assert.equal(state.getState().micQuiet, false, "unknown input clears an already quiet state");
  assert.equal(state.getState().currentMicLevel, 0);
  // Separate sharp threshold control; keep the quiet-to-unknown control above.
  amplitude = 0.2;
  globalThis.__meetingMeterAnalyser = analyser();
  await tick(10168);
  amplitude = 0.006;
  globalThis.__meetingMeterAnalyser = analyser();
  await tick(10252);
  assert.ok(state.getState().currentMicLevel > 0 && state.getState().currentMicLevel <= 0.005);
  const beforeMissing = publications.length;
  globalThis.__meetingMeterAnalyser = null;
  await tick(10336);
  assert.equal(
    publications.length,
    beforeMissing + 1,
    "tiny finite to missing publishes one exact reset"
  );
  assert.equal(state.getState().micQuiet, false);
  assert.equal(state.getState().currentMicLevel, 0);
  amplitude = 0;
  state.setState({ currentMicLevel: 0.25 });
  assert.equal(readMeetingMicLevel(), 0.25, "missing analyser uses fallback");
  state.setState({ currentMicLevel: 0 });
  globalThis.__meetingMeterAnalyser = analyser();
  await tick(20000);
  await tick(23999);
  assert.equal(state.getState().micQuiet, false);
  await tick(24000);
  assert.equal(state.getState().micQuiet, true);
  globalThis.__meetingMeterAnalyser = analyser();
  await tick(24084);
  assert.equal(state.getState().micQuiet, false, "replacement owns fresh quiet history");
  await tick(28084);
  assert.equal(state.getState().micQuiet, true);
  await React.act(async () =>
    state.setState({ micCaptureStatus: "reconnecting", currentMicLevel: 0 })
  );
  await tick(28168);
  assert.equal(state.getState().micQuiet, false, "retained analyser during recovery is unknown");
  await React.act(async () => state.setState({ micCaptureStatus: "active" }));
  await tick(30000);
  assert.equal(state.getState().micQuiet, false);
  await React.act(async () => state.setState({ micCaptureStatus: "unavailable" }));
  await tick(30084);
  assert.equal(state.getState().micQuiet, false);
  await React.act(async () => state.setState({ micCaptureStatus: "active" }));
  amplitude = 0.2;
  await tick(30832);
  amplitude = 0.006;
  globalThis.__meetingMeterAnalyser = analyser();
  await tick(30916);
  assert.ok(state.getState().currentMicLevel > 0 && state.getState().currentMicLevel <= 0.005);
  const beforeInvalid = publications.length;
  amplitude = NaN;
  await tick(31000);
  assert.equal(
    publications.length,
    beforeInvalid + 1,
    "tiny finite to NaN publishes one exact reset"
  );
  assert.equal(state.getState().currentMicLevel, 0);
  assert.equal(state.getState().micQuiet, false);
  amplitude = 0;
  await tick(32000);
  await tick(35999);
  assert.equal(state.getState().micQuiet, false);
  await tick(36000);
  assert.equal(state.getState().micQuiet, true);
  amplitude = 0.8;
  globalThis.__meetingMeterAnalyser = analyser();
  await tick(36084);
  assert.ok(state.getState().currentMicLevel > 0.39, "finite input recovers after NaN");
  assert.equal(state.getState().micQuiet, false);
  amplitude = 0;
  globalThis.__meetingMeterAnalyser = analyser();
  await tick(37000);
  globalThis.__meetingMeterAnalyser = null;
  await tick(41000);
  globalThis.__meetingMeterAnalyser = analyser();
  await tick(42000);
  assert.equal(state.getState().micQuiet, false, "unknown gap never counts as silence");
  await React.act(async () => root.unmount());
  mounted = false;
  assert.equal(intervals.size, 0);
  assert.equal(state.getState().currentMicLevel, 0);
  assert.equal(state.getState().micQuiet, false);
  // Restarting the owner gets a fresh four-second quiet history.
  amplitude = 0;
  root2 = createRoot(container);
  await React.act(async () => root2.render(React.createElement(Mount)));
  const restarted = [...intervals.values()][0];
  now = 43000;
  await React.act(async () => restarted.fn());
  assert.equal(state.getState().micQuiet, false);
  now = 47000;
  await React.act(async () => restarted.fn());
  assert.equal(state.getState().micQuiet, true);
  await React.act(async () => state.setState({ isRecording: false }));
  assert.equal(intervals.size, 0);
  assert.equal(state.getState().currentMicLevel, 0);
  assert.equal(state.getState().micQuiet, false);
  await React.act(async () => root2.unmount());
  root2 = null;
});
