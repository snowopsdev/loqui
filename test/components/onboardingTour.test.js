const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");

const downloading = (patch = {}) => ({
  status: "downloading",
  percent: 42,
  downloadedBytes: 264e6,
  totalBytes: 631e6,
  bytesPerSecond: 8e6,
  etaSeconds: 46,
  ...patch,
});

test("auto-advance is off under reduced motion, while paused, or after Skip tour", async () => {
  const { shouldAutoAdvance } = await import("../../src/components/onboarding/MeetLoquiTour.tsx");
  assert.equal(shouldAutoAdvance({ reducedMotion: false, paused: false, skipped: false }), true);
  for (const off of [{ reducedMotion: true }, { paused: true }, { skipped: true }]) {
    assert.equal(
      shouldAutoAdvance({ reducedMotion: false, paused: false, skipped: false, ...off }),
      false,
      JSON.stringify(off)
    );
  }
});

async function tour(t, reducedMotion) {
  return mountComponent(t, "/components/onboarding/MeetLoquiTour.tsx", {
    exportName: "MeetLoquiTour",
    props: { hotkeyLabel: "fn", activationMode: "tap", platform: "darwin", reducedMotion },
  });
}

const visibleSlides = (ui) =>
  ui
    .byAttr("aria-roledescription", "setupFlow.tour.slideRole")
    .filter((slide) => slide.attributes["aria-hidden"] !== "true");

test("the tour is a labelled carousel with one visible slide, arrows and dots", async (t) => {
  const ui = await tour(t, false);
  const [carousel] = ui.byAttr("aria-roledescription", "setupFlow.tour.carouselRole");
  assert.equal(carousel.attributes["aria-label"], "setupFlow.tour.label");
  assert.equal(visibleSlides(ui).length, 1);
  assert.ok(visibleSlides(ui)[0].textContent.includes("setupFlow.tour.shortcut.title"));
  await ui.click(ui.byAttr("aria-label", "setupFlow.tour.next")[0]);
  assert.ok(visibleSlides(ui)[0].textContent.includes("setupFlow.tour.privacy.title"));
  assert.equal(ui.byAttr("aria-current", "true").length, 1);
});

test("reduced motion never auto-advances", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const ui = await tour(t, true);
  await React.act(async () => t.mock.timers.tick(20000));
  assert.ok(visibleSlides(ui)[0].textContent.includes("setupFlow.tour.shortcut.title"));
});

test("Skip tour leaves a quiet line instead of the carousel", async (t) => {
  const ui = await tour(t, false);
  await ui.click("setupFlow.tour.skip");
  assert.equal(ui.byAttr("aria-roledescription", "setupFlow.tour.carouselRole").length, 0);
  expectKey(ui, "setupFlow.tour.skipped");
});

async function stage(t, download, events = []) {
  return mountComponent(t, "/components/onboarding/TryStage.tsx", {
    exportName: "TryStage",
    props: {
      download,
      voiceCommitted: true,
      trialReady: true,
      onStart: () => events.push("start"),
      onCancel: () => events.push("cancel"),
      onChooseVoice: () => events.push("choose"),
      tour: "TOUR",
      children: "TRIAL",
    },
  });
}

test("while downloading, the stage shows the real progress row and the tour, not the trial", async (t) => {
  const events = [];
  const ui = await stage(t, downloading(), events);
  assert.ok(ui.text().includes("TOUR"));
  assert.equal(ui.text().includes("TRIAL"), false);
  assert.equal(ui.byAttr("role", "progressbar")[0].attributes["aria-valuenow"], "42");
  await ui.click("setupFlow.download.cancel");
  assert.deepEqual(events, ["cancel"]);
});

test("the stage swaps the tour for the trial at 100% and pops it in only then", async (t) => {
  const ui = await stage(t, downloading());
  await ui.rerender({ download: { status: "ready" } });
  assert.ok(ui.text().includes("TRIAL"));
  expectKey(ui, "setupFlow.tour.readyTitle");
  assert.equal(ui.byAttr("data-arrived", "true").length, 1);
});

test("a stopped or cancelled download keeps the tour and offers the restart in place", async (t) => {
  const events = [];
  const ui = await stage(
    t,
    { status: "error", message: "Network timeout", percent: 42, progressKept: true },
    events
  );
  assert.ok(ui.text().includes("TOUR"));
  expectKey(ui, "setupFlow.download.stoppedKept", { percent: 42 });
  await ui.click("setupFlow.download.retry");
  await ui.rerender({ download: { status: "cancelled" } });
  await ui.click("setupFlow.download.downloadAgain");
  assert.deepEqual(events, ["start", "start"]);
});

test("with no voice committed, the stage sends the user to Voice instead of downloading", async (t) => {
  const events = [];
  const ui = await stage(t, { status: "idle" }, events);
  expectKey(ui, "setupFlow.tour.noVoice");
  await ui.click("setupFlow.tour.chooseVoice");
  assert.deepEqual(events, ["choose"]);
});

test("a voice that is already installed shows the trial with no pop-in", async (t) => {
  const ui = await stage(t, { status: "ready" });
  assert.ok(ui.text().includes("TRIAL"));
  assert.equal(ui.byAttr("data-arrived").length, 0);
});

const carousel = (ui) => ui.byAttr("aria-roledescription", "setupFlow.tour.carouselRole")[0];
const activeTitle = (ui) => visibleSlides(ui)[0]?.textContent;
const tick = (t, ms) => React.act(async () => t.mock.timers.tick(ms));

test("tour advances every four seconds, stops hidden art, resumes on return and cleans up on Skip", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const ui = await tour(t, false);
  assert.equal(ui.byAttr("data-demo", "true").length, 1);
  await tick(t, 3999);
  assert.match(activeTitle(ui), /shortcut.title/);
  await tick(t, 1);
  assert.match(activeTitle(ui), /privacy.title/);
  assert.equal(ui.byAttr("data-demo", "true").length, 0);
  assert.equal(ui.byAttr("hidden").length, 2);
  await ui.click(ui.byAttr("aria-label", "setupFlow.tour.previous")[0]);
  assert.equal(ui.byAttr("data-demo", "true").length, 1);
  await ui.click("setupFlow.tour.skip");
  await tick(t, 20000);
  assert.equal(carousel(ui), undefined);
  assert.equal(ui.byAttr("data-demo", "true").length, 0);
  await ui.unmount();
  await tick(t, 20000);
});

test("hover and focus-within pause independently, including internal focus transfers", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const ui = await tour(t, false);
  const event = async (name, value) => React.act(async () => ui.props(carousel(ui))[name](value));
  await event("onMouseEnter");
  await event("onFocus");
  await event("onMouseLeave");
  assert.equal(ui.byAttr("data-demo", "true").length, 0);
  await tick(t, 8000);
  assert.match(activeTitle(ui), /shortcut.title/);
  await event("onBlur", { currentTarget: { contains: () => true }, relatedTarget: {} });
  await tick(t, 8000);
  assert.match(activeTitle(ui), /shortcut.title/);
  await event("onBlur", { currentTarget: { contains: () => false }, relatedTarget: null });
  assert.equal(ui.byAttr("data-demo", "true").length, 1);
  await tick(t, 4000);
  assert.match(activeTitle(ui), /privacy.title/);
  await ui.rerender({ reducedMotion: true });
  await tick(t, 20000);
  assert.match(activeTitle(ui), /privacy.title/);
});

for (const dir of ["ltr", "rtl"])
  test(`tour arrow keys follow ${dir} reading direction and dots select a slide`, async (t) => {
    globalThis.__i18nDir = dir;
    t.after(() => delete globalThis.__i18nDir);
    const ui = await tour(t, true);
    await ui.press(carousel(ui), dir === "rtl" ? "ArrowLeft" : "ArrowRight");
    assert.match(activeTitle(ui), /privacy.title/);
    await ui.click(ui.byAttr("aria-label", "setupFlow.tour.tip(number=3)")[0]);
    assert.match(activeTitle(ui), /demo.title/);
    await ui.press(carousel(ui), dir === "rtl" ? "ArrowRight" : "ArrowLeft");
    assert.match(activeTitle(ui), /privacy.title/);
  });

test("installed facts cannot admit an uncommitted or unknown route, nor expose a candidate restart", async (t) => {
  const ui = await stage(t, { status: "ready" });
  await ui.rerender({ voiceCommitted: false, trialReady: false });
  assert.equal(ui.text().includes("TRIAL"), false);
  assert.equal(ui.text().includes("setupFlow.tour.readyTitle"), false);
  expectKey(ui, "setupFlow.tour.chooseVoice");
  await ui.rerender({ voiceCommitted: true, trialReady: false });
  expectKey(ui, "setupFlow.download.checking");
  assert.equal(ui.text().includes("TRIAL"), false);
  await ui.rerender({ download: { status: "cancelled" }, voiceCommitted: false });
  assert.equal(ui.text().includes("setupFlow.download.downloadAgain"), false);
});

test("LiveKeycap is decorative and preserves live press, demo, flash and size props", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/LiveKeycap.tsx", {
    exportName: "LiveKeycap",
    props: { label: "fn", sublabel: "Hold", pressed: true, size: 84, demo: true, flashKey: 1 },
  });
  const key = ui.byAttr("data-pressed", "true")[0];
  assert.equal(key.attributes["aria-hidden"], "true");
  assert.equal(key.style["--keycap-size"], "84px");
  assert.equal(ui.byAttr("data-demo", "true").length, 1);
  assert.equal(ui.byAttr("data-flash", "true").length, 1);
  await ui.rerender({ pressed: false, demo: false, flashKey: 2 });
  assert.equal(ui.byAttr("data-pressed").length, 0);
  assert.equal(ui.byAttr("data-demo").length, 0);
  assert.equal(ui.byAttr("data-flash").length, 1);
});

test("cold installed observation and delayed route facts do not impersonate a newly arrived download", async (t) => {
  const ui = await stage(t, { status: "checking" });
  await ui.rerender({ download: { status: "ready" } });
  assert.ok(ui.text().includes("TRIAL"));
  assert.equal(ui.byAttr("data-arrived").length, 0);
  await ui.rerender({ download: downloading(), trialReady: false });
  await ui.rerender({ download: { status: "ready" }, trialReady: false });
  assert.equal(ui.byAttr("data-arrived").length, 0);
  await ui.rerender({ trialReady: true });
  assert.equal(ui.byAttr("data-arrived", "true").length, 1);
  const child = ui.find((node) => node.textContent === "TRIAL");
  await ui.rerender({});
  assert.equal(
    ui.find((node) => node.textContent === "TRIAL"),
    child
  );
});

test("hidden page stops the actual interval and demo, resumes visibly and removes its listener on unmount", async (t) => {
  const { createRoot } = require("react-dom/client");
  const {
    createRendererServer,
    installBrowserGlobals,
    installHookDom,
  } = require("../lib/rendererTestHarness");
  const { installTree } = require("../helpers/harness/fakeDomTree");
  const { rendererOptions } = require("../helpers/harness/rendererMocks");
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const listeners = new Set(),
    doc = globalThis.document;
  doc.visibilityState = "visible";
  doc.addEventListener = (name, cb) => {
    if (name === "visibilitychange") listeners.add(cb);
  };
  doc.removeEventListener = (name, cb) => {
    if (name === "visibilitychange") listeners.delete(cb);
  };
  const ui = installTree();
  const vite = await createRendererServer(t, rendererOptions("loqui-tour-visibility-"));
  const { MeetLoquiTour } = await vite.ssrLoadModule("/components/onboarding/MeetLoquiTour.tsx");
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const realSet = globalThis.setInterval,
    realClear = globalThis.clearInterval,
    intervals = new Set();
  t.mock.method(globalThis, "setInterval", (cb, ms) => {
    const id = realSet(cb, ms);
    intervals.add(id);
    return id;
  });
  t.mock.method(globalThis, "clearInterval", (id) => {
    intervals.delete(id);
    realClear(id);
  });
  root = createRoot(ui.container);
  await React.act(async () =>
    root.render(
      React.createElement(MeetLoquiTour, {
        hotkeyLabel: "fn",
        activationMode: "push",
        platform: "darwin",
        reducedMotion: false,
      })
    )
  );
  assert.equal(intervals.size, 1);
  await React.act(async () => {
    doc.visibilityState = "hidden";
    for (const cb of listeners) cb();
  });
  assert.equal(intervals.size, 0);
  assert.equal(ui.byAttr("data-demo", "true").length, 0);
  await tick(t, 20000);
  assert.match(activeTitle(ui), /shortcut.title/);
  await React.act(async () => {
    doc.visibilityState = "visible";
    for (const cb of listeners) cb();
  });
  assert.equal(intervals.size, 1);
  assert.equal(ui.byAttr("data-demo", "true").length, 1);
  await tick(t, 4000);
  assert.match(activeTitle(ui), /privacy.title/);
  await React.act(async () => root.unmount());
  root = null;
  assert.equal(intervals.size, 0);
  assert.equal(listeners.size, 0);
});
