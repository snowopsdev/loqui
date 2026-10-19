const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { mediaContents } = require("../helpers/harness/cssMedia");
const { renderStatic } = require("../helpers/harness/reactSsr");

const i18next = require("i18next");
i18next.use(require("react-i18next").initReactI18next).init({
  lng: "en",
  resources: { en: { translation: require("../../src/locales/en/translation.json") } },
  initImmediate: false,
});

const repoRoot = path.join(__dirname, "../..");
const load = () => import("../../src/components/dictation/MeetingCapsule.tsx");

test("the capsule shows a dot, mm:ss and a labelled Stop", async () => {
  const { MeetingCapsule } = await load();
  const html = renderStatic(MeetingCapsule, {
    presence: { sessionId: "m1", startedAt: 1_000, interruption: null, quiet: false },
    now: 1_000 + 761_000,
    onStop() {},
  });
  assert.match(html, /data-rs="recording"/);
  assert.match(html, /class="meeting-capsule__dot"/);
  assert.match(html, />12:41</);
  assert.match(html, /<button[^>]*aria-label="[^"]+"/);
});

test("quiet pales the dot; a lost source is labelled and amber", async () => {
  const { meetingCapsuleState, MeetingCapsule } = await load();
  assert.equal(meetingCapsuleState({ startedAt: 1, interruption: null, quiet: true }), "quiet");
  assert.equal(
    meetingCapsuleState({ startedAt: 1, interruption: "systemAudio", quiet: true }),
    "lost"
  );
  const lost = renderStatic(MeetingCapsule, {
    presence: { sessionId: "m1", startedAt: 1, interruption: "systemAudio", quiet: false },
    now: 2,
    onStop() {},
  });
  assert.match(lost, /data-rs="lost"/);
  assert.match(lost, /meeting-capsule__note/);
});

test("the pill uses the wider footprint while a source is lost and becomes a group", async () => {
  const { VoicePill } = await import("../../src/components/dictation/VoicePill.tsx");
  const { VOICE_PILL_FOOTPRINT } = await import("../../src/helpers/voicePillPresentation.js");
  const html = renderStatic(VoicePill, {
    variant: "floating",
    state: "meeting",
    getAudioLevel: () => 0,
    label: "capsule",
    meetingInterrupted: true,
    role: "group",
  });
  const { width, height } = VOICE_PILL_FOOTPRINT.meetingInterrupted;
  assert.match(html, new RegExp(`style="width:${width}px;height:${height}px`));
  assert.match(html, /role="group"/);
});

test("the dot pulses only while recording, and not under reduced motion", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/dictation-panel.css"), "utf8");
  assert.match(
    css,
    /\.meeting-capsule\[data-rs="recording"\] \.meeting-capsule__dot\s*\{[^}]*animation:\s*meeting-dot var\(--motion-meeting-dot\) var\(--motion-ease-ambient\) infinite/
  );
  assert.match(
    css,
    /prefers-reduced-motion: reduce[\s\S]*\.meeting-capsule__dot\s*\{\s*animation:\s*none/
  );
});

test("a notification click reveals the capsule for that session only, while it records (D2)", async () => {
  const { isMeetingRecorderRevealed } =
    await import("../../src/hooks/useMeetingRecordingPresence.ts");
  const m1 = { sessionId: "m1", startedAt: 1, interruption: null, quiet: false };
  assert.equal(isMeetingRecorderRevealed("m1", m1), true);
  assert.equal(isMeetingRecorderRevealed("m0", m1), false, "a stale click for an ended session");
  assert.equal(isMeetingRecorderRevealed("m1", null), false, "presence ended");
  assert.equal(isMeetingRecorderRevealed(null, m1), false);
});

test("the on-screen recorder setting defaults to on", () => {
  const src = fs.readFileSync(path.join(repoRoot, "src/stores/settingsStore.ts"), "utf8");
  assert.match(
    src,
    /showMeetingRecorderOnScreen:\s*readBoolean\("showMeetingRecorderOnScreen", true\)/
  );
});

const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  installBrowserGlobals,
  installHookDom,
  createRendererServer,
} = require("../lib/rendererTestHarness");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const act = (fn) =>
  React.act(async () => {
    await fn();
    await new Promise((r) => setImmediate(r));
  });
const m1 = { sessionId: "m1", startedAt: 1000, interruption: null, quiet: false };
const m2 = { ...m1, sessionId: "m2" };

for (const newer of [null, m2]) {
  test(`mounted presence subscribes before getter and fences its late m1 against ${newer?.sessionId ?? "stop"}`, async (t) => {
    let root,
      observed,
      event,
      off = 0;
    const read = deferred();
    t.after(async () => {
      if (root) await act(() => root.unmount());
    });
    installBrowserGlobals(t, {
      window: {
        electronAPI: {
          onMeetingRecordingPresenceChanged: (cb) => {
            event = cb;
            return () => {
              off++;
            };
          },
          getMeetingRecordingPresence: () => {
            assert.equal(typeof event, "function");
            return read.promise;
          },
        },
      },
    });
    const container = installHookDom(t);
    const hooks = await import("../../src/hooks/useMeetingRecordingPresence.ts");
    function Probe() {
      observed = hooks.useMeetingRecordingPresence();
      return null;
    }
    root = createRoot(container);
    await act(() => root.render(React.createElement(Probe)));
    await act(() => event(newer));
    await act(() => read.resolve(m1));
    assert.deepEqual(observed, newer);
    await act(() => root.unmount());
    root = null;
    assert.equal(off, 1);
  });
}
for (const eventFirst of [false, true])
  for (const authoritative of [m1, m2, null]) {
    test(`mounted early reveal waits for authoritative ${eventFirst ? "event" : "read"} ${authoritative?.sessionId ?? "absence"}, then retires on end`, async (t) => {
      let root,
        presence,
        revealed,
        event,
        reveal,
        off = 0;
      const read = deferred();
      t.after(async () => {
        if (root) await act(() => root.unmount());
      });
      installBrowserGlobals(t, {
        window: {
          electronAPI: {
            onMeetingRecordingPresenceChanged: (cb) => {
              event = cb;
              return () => {
                off++;
              };
            },
            onMeetingRecorderRevealRequested: (cb) => {
              reveal = cb;
              return () => {
                off++;
              };
            },
            getMeetingRecordingPresence: () => read.promise,
          },
        },
      });
      const container = installHookDom(t);
      const hooks = await import("../../src/hooks/useMeetingRecordingPresence.ts");
      function Probe() {
        presence = hooks.useMeetingRecordingPresence();
        revealed = hooks.useMeetingRecorderRevealed(presence);
        return null;
      }
      root = createRoot(container);
      await act(() => root.render(React.createElement(Probe)));
      await act(() => reveal("m1"));
      assert.equal(revealed, false, "unknown presence never renders a phantom recorder");
      if (eventFirst) {
        await act(() => event(authoritative));
        await act(() => read.resolve(m2));
      } else await act(() => read.resolve(authoritative));
      assert.equal(revealed, authoritative === m1);
      await act(() => event(null));
      assert.equal(revealed, false);
      await act(() => event(m1));
      assert.equal(revealed, false, "an ended or rejected reveal cannot reclaim a later presence");
      await act(() => reveal("m0"));
      assert.equal(revealed, false);
      await act(() => reveal("m1"));
      assert.equal(revealed, true);
      await act(() => event(m2));
      assert.equal(revealed, false);
      await act(() => root.unmount());
      root = null;
      assert.equal(off, 2, "shared hooks remove both subscriptions once");
      await act(() => {
        event(m1);
        reveal("m1");
      });
    });
  }
test("an initial read resolving after disposal cannot pollute a fresh mounted owner", async (t) => {
  let root, observed, event;
  const read = deferred();
  let reads = 0;
  t.after(async () => {
    if (root) await act(() => root.unmount());
  });
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onMeetingRecordingPresenceChanged: (cb) => {
          event = cb;
          return () => {};
        },
        getMeetingRecordingPresence: () => (++reads === 1 ? read.promise : Promise.resolve(m2)),
      },
    },
  });
  const container = installHookDom(t);
  const hooks = await import("../../src/hooks/useMeetingRecordingPresence.ts");
  function Probe() {
    observed = hooks.useMeetingRecordingPresence();
    return null;
  }
  root = createRoot(container);
  await act(() => root.render(React.createElement(Probe)));
  await act(() => root.unmount());
  root = createRoot(container);
  await act(() => root.render(React.createElement(Probe)));
  await act(() => read.resolve(m1));
  assert.deepEqual(observed, m2);
  await act(() => event(null));
  assert.equal(observed, null);
});

test("meeting setting uses the real store setter, registry toggle and peer boolean synchronization", async (t) => {
  const listeners = {};
  const { window, storage } = installBrowserGlobals(t, {
    window: {
      addEventListener: (name, cb) => {
        listeners[name] = cb;
      },
    },
  });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-meeting-settings-" });
  const { useSettingsStore, initializeSettings } = await vite.ssrLoadModule(
    "/stores/settingsStore.ts"
  );
  const { SETTINGS_REGISTRY } = await vite.ssrLoadModule(
    "/components/settings/settingsRegistry.ts"
  );
  const entry = SETTINGS_REGISTRY.find((e) => e.id === "meetingRecorderOnScreen");
  assert.equal(entry.path, "general");
  assert.equal(useSettingsStore.getState().showMeetingRecorderOnScreen, true);
  useSettingsStore.getState().setShowMeetingRecorderOnScreen(false);
  assert.equal(storage.getItem("showMeetingRecorderOnScreen"), "false");
  window.electronAPI = undefined;
  await initializeSettings();
  listeners.storage({ key: "showMeetingRecorderOnScreen", newValue: "true", storageArea: storage });
  assert.equal(useSettingsStore.getState().showMeetingRecorderOnScreen, true);
  listeners.storage({
    key: "showMeetingRecorderOnScreen",
    newValue: "false",
    storageArea: storage,
  });
  assert.equal(useSettingsStore.getState().showMeetingRecorderOnScreen, false);
  assert.equal(entry.control.get(useSettingsStore.getState()), false);
  entry.control.set(useSettingsStore.getState(), true);
  assert.equal(useSettingsStore.getState().showMeetingRecorderOnScreen, true);
});

test("the recorder boundary stays opaque while only its fill pulses, with a shared cadence", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/dictation-panel.css"), "utf8");
  const dot = css.match(/\.meeting-capsule__dot\s*\{([^}]*)\}/)[1];
  const pulse = css.match(/@keyframes meeting-dot\s*\{\s*50%\s*\{([^}]*)\}/)[1];
  assert.match(dot, /border: 1px solid var\(--color-foreground\)/);
  assert.match(pulse, /background: color-mix/);
  assert.doesNotMatch(pulse, /opacity/);
  assert.match(
    fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8"),
    /--motion-meeting-dot: 1200ms/
  );
});

test("reduced motion overrides the active recording selector at equal specificity", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/dictation-panel.css"), "utf8");
  const reduced = mediaContents(css, "prefers-reduced-motion: reduce");
  assert.match(reduced, /\.meeting-capsule\[data-rs="recording"\] \.meeting-capsule__dot/);
});

test("only the new recorder setting and its search result gain contrast boundaries", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/dictation-panel.css"), "utf8");
  assert.match(css, /\[data-setting-id="meetingRecorderOnScreen"\]/);
  assert.match(css, /\[data-result="meetingRecorderOnScreen"\]/);
  assert.match(
    css,
    /button\[role="switch"\]\s*\{[^}]*outline: 1px solid var\(--color-foreground\)/
  );
  assert.match(
    css,
    /button\[role="switch"\]\[aria-checked="false"\]\s*>\s*span\s*\{[^}]*background: var\(--color-foreground\)/
  );
  assert.match(
    css,
    /button\[role="switch"\]\[aria-checked="true"\]\s*>\s*span\s*\{[^}]*background: var\(--color-primary-foreground\)/
  );
});
