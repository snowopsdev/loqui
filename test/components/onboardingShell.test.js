const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

test("the shell pins html, body and #root while onboarding is mounted", () => {
  const css = read("src/styles/onboarding-welcome.css");
  assert.match(
    css,
    /html:has\(\.onboarding-welcome\),\s*html:has\(\.onboarding-welcome\) body,\s*html:has\(\.onboarding-welcome\) #root\s*\{\s*height: 100%;\s*\}/
  );
  assert.doesNotMatch(
    read("src/index.css"),
    /onboarding-welcome/,
    "onboarding CSS stays out of index.css"
  );
});

test("traffic-light clearance is physical, not logical, and survives the narrow layout", () => {
  const css = read("src/styles/onboarding-welcome.css");
  const wide = css.match(
    /\.onboarding-welcome\[data-platform="darwin"\] \.onboarding-welcome-header\s*\{([^}]*)\}/
  );
  assert.ok(wide, "macOS header rule exists");
  assert.match(wide[1], /padding-left: max\(84px, calc\(\(100vw - 1320px\) \/ 2\)\);/);
  assert.doesNotMatch(wide[1], /padding-inline-start/);
  const narrow = css.match(/@media \(max-width: 760px\)\s*\{([\s\S]*?)\n\}/)[1];
  assert.match(
    narrow,
    /\.onboarding-welcome\[data-platform="darwin"\] \.onboarding-welcome-header\s*\{\s*padding-left: 84px;\s*\}/
  );
});

test("both shells carry the platform", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-onboarding-shell-"));
  const { default: WelcomeScreen } = await vite.ssrLoadModule(
    "/components/onboarding/WelcomeScreen.tsx"
  );
  const html = renderToStaticMarkup(
    createElement(WelcomeScreen, {
      platform: "darwin",
      updatesEnabled: true,
      onUpdatesChange() {},
      dataRetentionEnabled: true,
      onDataRetentionChange() {},
      onContinue() {},
      onExplore() {},
    })
  );
  assert.match(html, /<div class="onboarding-welcome" data-platform="darwin">/);

  const flow = read("src/components/OnboardingFlow.tsx");
  assert.match(flow, /<OnboardingShell[\s\S]*?platform=\{platform\}/);
  assert.match(flow, /<WelcomeScreen[\s\S]*?platform=\{platform\}/);
});

const { resolveTokens } = require("../helpers/harness/cssTokens");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");
const React = require("react");

const setupCss = () => read("src/styles/onboarding.css");

test("the new shell is pinned, keeps 56/64 chrome, and clears the traffic lights physically (ONB-Q1)", () => {
  const source = setupCss();
  assert.match(source, /--onb-header:\s*56px/);
  assert.match(source, /--onb-footer:\s*64px/);
  assert.match(source, /\.onb-shell\s*\{[^}]*height:\s*100dvh/);
  assert.match(
    source,
    /\.onb-shell\[data-platform="darwin"\] \.onb-header\s*\{[^}]*padding-left:\s*84px/
  );
  assert.doesNotMatch(
    source,
    /\[data-platform="darwin"\] \.onb-header\s*\{[^}]*padding-inline-start/,
    "the lights stay left in RTL"
  );
});

test("small windows, 200% zoom and long labels keep every action reachable (M04)", () => {
  const source = setupCss();
  const narrow = source.match(/@media \(max-width: 760px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(narrow);
  assert.match(narrow[1], /\.onb-main\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(source, /\.onb-footer\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(source, /\.onb-progress__label\s*\{[^}]*text-overflow:\s*ellipsis/);
  const compact = source.match(/@media \(max-width: 900px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(compact, "a header simplification exists below 900px (200% zoom of an 1800px window)");
  assert.match(compact[1], /\.onb-brand strong\s*\{[^}]*display:\s*none/);
});

test("setup styles use tokens only: no hex, no raw durations, no text under 12px", () => {
  const source = setupCss();
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/);
  assertTokenDurations(source);
  for (const [, size] of source.matchAll(/font-size:\s*(\d+)px/g))
    assert.ok(Number(size) >= 12, `${size}px`);
});

test("the rendered rail and progress rules meet contrast in light and Plum Night (M03)", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(read("src/index.css"));
  const source = setupCss();
  const token = (selector, property) => {
    const block = source.match(
      new RegExp(`${selector.replace(/[.[\]"=()]/g, "\\$&")}\\s*\\{([^}]*)\\}`)
    );
    assert.ok(block, selector);
    return block[1].match(new RegExp(`${property}:\\s*var\\((--[\\w-]+)\\)`))[1];
  };
  const railBg = token(".onb-rail", "background");
  const railFg = token(".onb-rail", "color");
  assert.ok(contrastRatio(light[railFg], light[railBg]) >= 4.5, "rail text, light");
  assert.ok(
    contrastRatio(light[token(".onb-bar__fill", "background")], light[railBg]) >= 3,
    "paper bars on the rail"
  );
  const errorLight = token('.onb-instrument[data-mode="error"] .onb-bar__fill', "background");
  assert.ok(
    contrastRatio(light[errorLight], light[railBg]) >= 3,
    "error bars on the light rail (R2-I09)"
  );
  const errorDark = token('.dark .onb-instrument[data-mode="error"] .onb-bar__fill', "background");
  assert.ok(
    contrastRatio(dark[errorDark], dark["--color-surface-1"]) >= 3,
    "error bars on the Plum Night rail"
  );
  assert.ok(
    contrastRatio(dark[token(".dark .onb-rail", "color")], dark["--color-surface-1"]) >= 4.5,
    "rail text, Plum Night"
  );
  const marker = token('.onb-progress__step[data-state="current"]', "background");
  assert.equal(marker, "--color-nav-marker", "active navigation uses the navigation role (D5)");
  assert.ok(contrastRatio(light[marker], light["--color-background"]) >= 3);
  assert.ok(contrastRatio(dark[marker], dark["--color-background"]) >= 3);
});

test("the orphaned onboarding system is gone from runtime code", () => {
  const index = read("src/index.css");
  for (const selector of [
    ".onboarding-canvas",
    ".onboarding-keycap",
    ".onboarding-step-enter",
    ".onboarding-stagger",
    ".onboarding-pressable",
    ".onboarding-list",
    ".onboarding-select",
    ".onboarding-compact-hero",
    ".onboarding-typing-dot",
    ".onboarding-display-title",
    ".onboarding-light-input",
    ".onboarding-provider",
    ".onboarding-embedded-auth",
    ".onboarding-card-title",
    "--onboarding-accent",
  ]) {
    assert.equal(index.includes(selector), false, selector);
  }
  assert.equal(read("src/components/ui/ActivationModeSelector.tsx").includes("onboarding"), false);
  assert.equal(
    read("src/components/ui/ProviderIcon.tsx").includes("onboarding-provider-icon-monochrome"),
    false
  );
});

const shellProps = (patch = {}) => ({
  step: "speech",
  visited: ["welcome", "speech"],
  platform: "darwin",
  rail: { title: "Pick how Loqui listens.", body: "One voice.", mode: { kind: "idle" } },
  onNavigate() {},
  onBack() {},
  primary: { label: "Continue", onClick() {} },
  children: "controls",
  ...patch,
});

test("progress is a nav of the current phase; only visited steps are usable; the heading takes focus", async (t) => {
  const visited = [];
  const ui = await mountComponent(t, "/components/onboarding/OnboardingShell.tsx", {
    exportName: "OnboardingShell",
    props: shellProps({ onNavigate: (step) => visited.push(step) }),
  });
  assert.equal(ui.byAttr("aria-label", "setupFlow.progress.nav").length, 1);
  const steps = ui.findAll((node) => node.attributes.class === "onb-progress__step");
  assert.deepEqual(
    steps.map((node) => [
      node.attributes["data-state"],
      "disabled" in node.attributes,
      node.attributes["aria-current"] ?? null,
    ]),
    [
      ["done", false, null],
      ["current", true, "step"],
      ["todo", true, null],
    ]
  );
  await ui.click(steps[0]);
  assert.deepEqual(visited, ["welcome"]);
  assert.equal(
    globalThis.document.activeElement?.tagName,
    "H1",
    "every step change moves focus to its heading"
  );
});

test("Hello has no Back, the primary is the neutral capsule, and Ready shows no segments", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/OnboardingShell.tsx", {
    exportName: "OnboardingShell",
    props: shellProps({ step: "welcome", visited: ["welcome"], onBack: undefined }),
  });
  assert.equal(ui.text().includes("setupFlow.back"), false);
  assert.equal(ui.byAttr("data-onb-primary")[0].attributes["data-variant"], "default");
  await ui.rerender({ step: "finish", visited: ["welcome", "finish"] });
  assert.equal(ui.findAll((node) => node.attributes.class === "onb-progress__step").length, 0);
  expectKey(ui, "setupFlow.progress.ready");
});

test("the instrument fills with the download and always says the number", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    props: {
      title: "Say something.",
      body: "",
      mode: { kind: "download", percent: 41.6, downloadedBytes: 264e6, totalBytes: 631e6 },
    },
  });
  const fills = ui.findAll((node) => node.attributes.class === "onb-bar__fill");
  assert.equal(fills.length, 5);
  assert.ok(fills.every((node) => node.style["--fill"] === "0.42"));
  expectKey(ui, "setupFlow.instrument.downloading", { percent: 42 });
  assert.equal(
    ui.byAttr("aria-hidden", "true").some((node) => node.attributes.class === "onb-instrument"),
    true
  );
});

test("listening hands the bars to LevelBars; errors drop them to 30%; success draws the bubble", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    windowProps: { setInterval: () => 1, clearInterval() {} },
    props: {
      title: "Hello",
      body: "",
      mode: { kind: "listening", heardVoice: false },
      readLevel: () => 0,
    },
  });
  assert.equal(ui.byAttr("data-level-bar").length, 5);
  assert.equal(
    ui.findAll((node) => node.attributes["data-tone"] !== undefined)[0].attributes["data-tone"],
    "onLive",
    "light rail: paper bars via the tone prop"
  );
  expectKey(ui, "setupFlow.instrument.waiting");
  await ui.rerender({ mode: { kind: "error", reason: "noAudio" } });
  assert.ok(
    ui
      .findAll((node) => node.attributes.class === "onb-bar__fill")
      .every((node) => node.style["--fill"] === "0.3")
  );
  expectKey(ui, "setupFlow.instrument.nothingHeard");
  await ui.rerender({ mode: { kind: "success" } });
  assert.equal(
    ui.byAttr("data-bubble").length,
    1,
    "the speech bubble draws around the settled bars (M02)"
  );
});

// Drives LevelBars' real sampler (window.setInterval + performance.now) on one mocked clock.
function meterClock(t) {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  return {
    windowProps: {
      setInterval: (cb, ms) => setInterval(cb, ms),
      clearInterval: (id) => clearInterval(id),
    },
    async advance(ms) {
      for (let elapsed = 0; elapsed < ms; elapsed += 33) {
        now += 33;
        t.mock.timers.tick(33);
      }
      await React.act(async () => {});
    },
  };
}
const centreScale = (ui) =>
  Number(/scaleY\(([\d.]+)\)/.exec(ui.byAttr("data-level-bar")[2].style.transform)[1]);

test("one meter lives from listening through processing and the settle, easing to rest; then the bubble (R3-M01)", async (t) => {
  const clock = meterClock(t);
  const rail = (mode) => ({ title: "Say something", body: "", mode, readLevel: () => 0.9 });
  const ui = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    windowProps: clock.windowProps,
    props: rail({ kind: "listening", heardVoice: true }),
  });
  await clock.advance(400);
  const meter = ui.byAttr("data-level-bar");
  const rest = 0.55; // levelBarScale(2, 0, …): the centre bar's rest silhouette (Plan 01 levelBars.test.js)
  const loud = centreScale(ui);
  assert.ok(loud > rest + 0.1, `the live level lifts the centre bar (${loud})`);

  await ui.rerender(rail({ kind: "processing" }));
  assert.equal(
    ui.byAttr("data-level-bar")[2],
    meter[2],
    "processing keeps the same meter instance"
  );
  await clock.advance(132);
  const easing = centreScale(ui);
  assert.ok(easing < loud, "zero input: the bars start to settle during processing");

  await ui.rerender(rail({ kind: "success" }));
  assert.equal(ui.byAttr("data-level-bar")[2], meter[2], "the first success render keeps it too");
  assert.equal(ui.byAttr("data-bubble").length, 0, "stage 1: settle, no bubble yet");
  await clock.advance(480);
  const settled = centreScale(ui);
  assert.ok(
    Math.abs(settled - rest) < Math.abs(easing - rest),
    `the same frame eases toward rest (${easing} → ${settled})`
  );
  await clock.advance(40);
  assert.equal(
    ui.byAttr("data-level-bar").length,
    0,
    "after SETTLE_MS the meter gives way to the mark"
  );
  assert.equal(ui.byAttr("data-bubble").length, 1, "stage 2: the bubble draws");
  assert.equal(
    Number.parseFloat(ui.findAll((node) => node.attributes.class === "onb-bar")[2].style.height),
    77,
    "the mark keeps the driver rest height instead of jumping to full amplitude"
  );
});

test("reduced motion swaps to the mark at once; a success with no live take has nothing to settle", async (t) => {
  const reduced = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    reducedMotion: true,
    windowProps: { setInterval: () => 1, clearInterval() {} },
    props: {
      title: "Say something",
      body: "",
      mode: { kind: "listening", heardVoice: true },
      readLevel: () => 0.6,
    },
  });
  await reduced.rerender({ mode: { kind: "processing" } });
  await reduced.rerender({ mode: { kind: "success" } });
  assert.equal(reduced.byAttr("data-bubble").length, 1);
  assert.equal(reduced.byAttr("data-level-bar").length, 0);
});

test("cold success has no live meter to settle", async (t) => {
  const cold = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    props: { title: "Say something", body: "", mode: { kind: "idle" } },
  });
  await cold.rerender({ mode: { kind: "success" } });
  assert.equal(cold.byAttr("data-bubble").length, 1);
});

test("the dock uses a View Transition unless motion is reduced or unsupported", async () => {
  const { dockMark, SETTLE_MS, DRAW_MS } =
    await import("../../src/components/onboarding/instrumentMath.ts");
  assert.deepEqual([SETTLE_MS, DRAW_MS], [520, 360]);
  let updates = 0;
  const update = () => updates++;
  assert.equal(
    dockMark(update, { reducedMotion: false, doc: { startViewTransition: (cb) => cb() } }),
    "transition"
  );
  assert.equal(
    dockMark(update, { reducedMotion: true, doc: { startViewTransition: (cb) => cb() } }),
    "instant"
  );
  assert.equal(dockMark(update, { reducedMotion: false, doc: {} }), "instant");
  assert.equal(updates, 3);
});

test("no onboarding rule overrides LevelBars with !important (the tone prop replaced it)", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../src/styles/onboarding.css"), "utf8");
  assert.doesNotMatch(css, /\[data-level-bar\][^{]*\{[^}]*!important/);
});

// Read complete declaration values, so a token on the next line is still checked.
function assertTokenDurations(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, property, value] of clean.matchAll(
    /(?:^|[;{])\s*((?:transition|animation)(?:-duration|-delay)?)\s*:\s*([^;}]+)/g
  )) {
    assert.doesNotMatch(value, /(?:^|[^\w-])(?:\d*\.)?\d+(?:ms|s)\b/, `${property}: ${value}`);
    if (property.endsWith("duration") || property.endsWith("delay"))
      assert.match(value, /var\(--motion-|none/);
  }
}
test("duration guard accepts multiline tokens and rejects mixed literal durations", () => {
  assert.doesNotThrow(() =>
    assertTokenDurations(
      ".x { transition:\n opacity var(--motion-base),\n color var(--motion-fast); }"
    )
  );
  for (const value of [
    "opacity 200ms",
    "opacity var(--motion-base), transform .2s",
    "onb-shake 1s infinite",
  ]) {
    assert.throws(() => assertTokenDurations(`.x { animation:\n ${value}; }`));
  }
});

test("a listening rail with no analyser still mounts one silent meter", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    windowProps: { setInterval: () => 1, clearInterval() {} },
    props: { title: "Listen", body: "", mode: { kind: "listening", heardVoice: false } },
  });
  assert.equal(ui.byAttr("data-level-bar").length, 5);
});

test("superseding success cancels its settle; unmount stops the real sampler and media subscriptions", async (t) => {
  const clock = meterClock(t);
  const listeners = new Set();
  const query = {
    matches: false,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  };
  let samples = 0;
  const ui = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    windowProps: { ...clock.windowProps, matchMedia: () => query },
    props: {
      title: "Listen",
      body: "",
      mode: { kind: "listening", heardVoice: true },
      readLevel: () => {
        samples++;
        return 0.9;
      },
    },
  });
  await clock.advance(200);
  await ui.rerender({ mode: { kind: "success" } });
  await clock.advance(200);
  await ui.rerender({ mode: { kind: "listening", heardVoice: true } });
  await clock.advance(600);
  assert.equal(
    ui.byAttr("data-level-bar").length,
    5,
    "an old settle timer cannot turn off a new take"
  );
  assert.equal(ui.byAttr("data-bubble").length, 0);
  await ui.rerender({ mode: { kind: "success" } });
  query.matches = true;
  await React.act(async () => {
    for (const fn of [...listeners]) fn({ matches: true });
  });
  assert.equal(
    ui.byAttr("data-bubble").length,
    1,
    "a live reduced-motion change ends decorative settling"
  );
  await ui.rerender({ mode: { kind: "listening", heardVoice: true } });
  await clock.advance(132);
  await ui.unmount();
  const stopped = samples;
  await clock.advance(1000);
  assert.equal(samples, stopped);
  assert.equal(listeners.size, 0);
});
