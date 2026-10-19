const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
i18next.use(initReactI18next).init({
  lng: "en",
  resources: { en: { translation: require("../../src/locales/en/translation.json") } },
  initImmediate: false,
});

const repoRoot = path.join(__dirname, "../..");

test("the prompt names the app and says detection is local (VO-R11)", async () => {
  const { getMeetingNotificationPresentation } =
    await import("../../src/components/meetingNotificationModel.ts");
  const p = getMeetingNotificationPresentation({
    detectionId: "d",
    source: "audio",
    key: "k",
    event: null,
    variant: "detected",
    joinUrl: null,
    appName: "Zoom",
  });
  assert.equal(p.bodyKey, "meetingNotification.bodyApp");
  assert.deepEqual(p.bodyParams, { app: "Zoom" });
  assert.equal(p.privacyKey, "meetingNotification.privacy");
  const noApp = getMeetingNotificationPresentation({
    detectionId: "d",
    source: "audio",
    key: "k",
    event: null,
    variant: "detected",
    joinUrl: null,
  });
  assert.equal(noApp.bodyKey, "meetingNotification.body.detected");
});

test("the accept hotkey is labelled per platform", async () => {
  const { acceptHotkeyLabel, MEETING_PROMPT_MINI_AFTER_MS } =
    await import("../../src/components/meetingNotificationModel.ts");
  assert.equal(acceptHotkeyLabel("darwin"), "⌥⌘M");
  assert.equal(acceptHotkeyLabel("linux"), "Ctrl+Alt+M");
  assert.equal(MEETING_PROMPT_MINI_AFTER_MS, 8000);
});

test("mini phase folds to a one-line pill with the hotkey; close is always visible", async () => {
  const { MeetingNotificationCard } =
    await import("../../src/components/MeetingNotificationCard.tsx");
  const mini = renderStatic(MeetingNotificationCard, {
    title: "Meeting detected",
    body: "Meeting in Zoom detected.",
    startLabel: "Take notes",
    phase: "mini",
    hotkeyLabel: "⌥⌘M",
    miniLabel: "Meeting? Start notes",
  });
  assert.match(mini, /data-phase="mini"/);
  assert.match(mini, /Meeting\? Start notes/);
  assert.match(mini, /<kbd[^>]*>⌥⌘M<\/kbd>/);
  const card = renderStatic(MeetingNotificationCard, {
    title: "Meeting detected",
    body: "b",
    startLabel: "Take notes",
    privacyLine: "Detected on this device. Nothing recorded yet.",
  });
  assert.match(card, /Detected on this device\. Nothing recorded yet\./);
  // Plan 01 review item 3: no tinted tile doubling the orange mark.
  assert.doesNotMatch(card, /bg-primary\/10/);
  // Always rendered, even without onDismiss (drop the existing `onDismiss &&` guard).
  const close = card.match(/<button[^>]*meeting-card__close[^>]*>/);
  assert.ok(close, "close button rendered");
  assert.match(close[0], /aria-label="[^"]+"/);
  assert.doesNotMatch(close[0], /pointer-events-none/);
});

test("the card drops from the top with the settle spring; the legacy blue mark is gone", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/notices.css"), "utf8");
  assert.match(
    css,
    /\.meeting-drop\s*\{[^}]*animation:\s*meeting-drop var\(--motion-hero\) var\(--motion-spring-settle\)/
  );
  const card = fs.readFileSync(
    path.join(repoRoot, "src/components/MeetingNotificationCard.tsx"),
    "utf8"
  );
  assert.doesNotMatch(card, /#2056DF/i);
  // Starting a recording is a live-voice control (D1); it uses the shared variant, not a copy of its surface.
  assert.match(card, /variant="live"/);
  assert.doesNotMatch(card, /BRAND_GLASS_SURFACE/);
  assert.match(css, /opacity var\(--motion-fast\) var\(--motion-ease-exit\)/);
  assert.match(
    css,
    /prefers-reduced-motion: reduce[\s\S]*\.meeting-drop\s*\{[^}]*transform: none !important/
  );
  assert.match(css, /inset-inline-start: 2px/);
});

test("the prompt is placed top-centre on the active display (VO-Q10)", () => {
  const src = fs.readFileSync(path.join(repoRoot, "src/helpers/windowManager.js"), "utf8");
  const block = src.slice(
    src.indexOf("showMeetingNotification("),
    src.indexOf("showNotificationWindow(")
  );
  assert.match(block, /_resolveActiveDisplay\(/);
  assert.match(block, /getNotchDropPosition\(/);
  assert.doesNotMatch(block, /getPrimaryDisplay\(\)/);
  assert.doesNotMatch(block, /registerSlot\(/, "temporary shortcuts go through main's leases (I7)");
});

const React = require("react");
const { createRoot } = require("react-dom/client");
const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
const { installTree } = require("../helpers/harness/fakeDomTree");

test("mounted production overlay pauses fold on hover, reflects lease loss and accepts mini once", async (t) => {
  const timers = new Map();
  const nativeSet = global.setTimeout,
    nativeClear = global.clearTimeout;
  let seq = 0,
    push,
    resolveRead,
    root;
  const responses = [],
    interactivity = [];
  const stale = new Promise((resolve) => {
    resolveRead = resolve;
  });
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onMeetingNotificationData: (cb) => {
          push = cb;
          return () => {
            push = null;
          };
        },
        getMeetingNotificationData: () => stale,
        meetingNotificationReady() {},
        setNotificationInteractivity: (v) => interactivity.push(v),
        meetingNotificationRespond: (...args) => responses.push(args),
      },
    },
  });
  installHookDom(t);
  const tree = installTree();
  const overlayModule = await import("../../src/components/MeetingNotificationOverlay.tsx");
  const Overlay = overlayModule.default.default ?? overlayModule.default;
  global.setTimeout = (cb, delay) => {
    const id = ++seq;
    timers.set(id, { cb, delay });
    return id;
  };
  global.clearTimeout = (id) => timers.delete(id);
  const act = (fn) =>
    React.act(async () => {
      await fn();
      await Promise.resolve();
    });
  const run = (delay) => {
    for (const [id, item] of [...timers])
      if (item.delay === delay) {
        timers.delete(id);
        item.cb();
      }
  };
  try {
    root = createRoot(tree.container);
    await act(() => root.render(React.createElement(Overlay)));
    await act(() =>
      push({ detectionId: "A", variant: "detected", appName: "Zoom", acceptHotkeyLabel: "⌥⌘M" })
    );
    await act(() => run(50));
    const card = () => tree.find((n) => n.attributes?.["data-phase"]);
    assert.equal(card().attributes["data-phase"], "card");
    assert.ok(tree.text().includes("Zoom"));
    await act(() => tree.props(card()).onMouseEnter());
    assert.equal(
      [...timers.values()].some((x) => x.delay === 8000),
      false
    );
    await act(() => tree.props(card()).onMouseLeave());
    assert.equal(
      [...timers.values()].some((x) => x.delay === 8000),
      true
    );
    await act(() => push({ detectionId: "A", variant: "detected", acceptHotkeyLabel: null }));
    await act(() => resolveRead({ detectionId: "A", acceptHotkeyLabel: "⌥⌘M" }));
    assert.equal(tree.text().includes("⌥⌘M"), false);
    await act(() => run(8000));
    assert.equal(card().attributes["data-phase"], "mini");
    const mini = tree.find((n) => tree.props(n)?.className === "meeting-card__mini");
    await tree.clickNode(mini);
    assert.deepEqual(responses, [["A", "start"]]);
    assert.equal(card().attributes["data-phase"], "accepted");
    assert.ok(tree.find((n) => tree.props(n)?.["aria-label"] === "Dismiss"));
    assert.deepEqual(interactivity, [true, false]);
    // A fresh renderer/window can dismiss once after the shared CSS exit.
    await act(() => root.unmount());
    root = createRoot(tree.container);
    await act(() => root.render(React.createElement(Overlay)));
    await act(() => push({ detectionId: "B", variant: "detected", acceptHotkeyLabel: null }));
    await act(() => run(50));
    const close = tree.find((n) => tree.props(n)?.["aria-label"] === "Dismiss");
    await tree.clickNode(close);
    assert.equal(responses.length, 1, "dismiss waits for the opacity exit");
    const motion = tree.find((n) =>
      String(tree.props(n)?.className).includes("meeting-notification-motion")
    );
    await act(() =>
      tree
        .props(motion)
        .onTransitionEnd({ target: motion, currentTarget: motion, propertyName: "opacity" })
    );
    await act(() =>
      tree
        .props(motion)
        .onTransitionEnd({ target: motion, currentTarget: motion, propertyName: "opacity" })
    );
    assert.deepEqual(responses, [
      ["A", "start"],
      ["B", "dismiss"],
    ]);
  } finally {
    if (root) await act(() => root.unmount());
    if (push !== undefined) assert.equal(push, null);
    assert.equal(timers.size, 0);
    global.setTimeout = nativeSet;
    global.clearTimeout = nativeClear;
  }
});
