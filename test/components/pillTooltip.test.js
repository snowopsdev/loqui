const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const t = (key, opts) => (opts ? `${key}(${Object.values(opts).join(",")})` : key);
const repoRoot = path.join(__dirname, "../..");
const css = () =>
  fs
    .readFileSync(path.join(repoRoot, "src/styles/dictation-panel.css"), "utf8")
    .replace(/\s+/g, " ");

test("idle tooltip says Hold or Press and names where dictation goes (VO-Q14)", async () => {
  const { buildPillTooltipLines } =
    await import("../../src/components/dictation/pillTooltipLines.ts");
  assert.deepEqual(
    buildPillTooltipLines({
      micState: "idle",
      activationMode: "push",
      hotkeyLabel: "⌥ Space",
      routeLine: "Speech: on this device · Cleanup: OpenAI",
      t,
    }),
    ["pill.tooltip.hold(⌥ Space)", "Speech: on this device · Cleanup: OpenAI"]
  );
  assert.equal(
    buildPillTooltipLines({
      micState: "idle",
      activationMode: "tap",
      hotkeyLabel: "⌥ Space",
      routeLine: "",
      t,
    })[0],
    "pill.tooltip.press(⌥ Space)"
  );
  assert.deepEqual(
    buildPillTooltipLines({
      micState: "recording",
      activationMode: "tap",
      hotkeyLabel: "x",
      routeLine: "r",
      t,
    }),
    ["app.mic.recording", "r"]
  );
});

test("tooltip text is 12px, not 10px", () => {
  const src = fs.readFileSync(
    path.join(repoRoot, "src/components/dictation/PillTooltip.tsx"),
    "utf8"
  );
  assert.doesNotMatch(src, /text-\[10px\]/);
  assert.match(src, /text-xs/);
});

test("idle pill wears a 1px outer hairline for any wallpaper (VO-Q19)", () => {
  const styles = css();
  assert.match(
    styles,
    /\.voice-pill-control\[data-pill-state="idle"\]:not\(\[data-liquid-fused\]\)\s*\{[^}]*box-shadow:\s*0 0 0 1px var\(--pill-hairline\)/
  );
  assert.match(styles, /--pill-hairline:\s*rgb\(255 255 255 \/ 0\.7\)/);
  assert.match(
    styles,
    /\.dark \.voice-pill-control\s*\{[^}]*--pill-hairline:\s*rgb\(0 0 0 \/ 0\.4\)/
  );
});

test("the halo hides while the cancel skin is fused (VO-Q20)", () => {
  assert.match(
    css(),
    /\.voice-pill-glow-anchor:has\(\.voice-pill-control\[data-liquid-fused="true"\]\) \.processing-signal-glow::before,[^{]*\{[^}]*opacity:\s*0/
  );
  assert.match(css(), /:has\([^}]+processing-signal-glow::after\s*\{[^}]*animation:\s*none/);
});

test("the receding Agent answer exits on the exit curve (Plan 01 review)", () => {
  const rule = css().match(/\.assistant-response-content-updating\s*\{([^}]*)\}/)[1];
  assert.match(rule, /opacity var\(--motion-slow\) var\(--motion-ease-exit\)/);
  assert.match(rule, /filter var\(--motion-slow\) var\(--motion-ease-exit\)/);
  assert.doesNotMatch(rule, /ease-in-out/);
});

test("the thinking shimmer uses theme tokens, not cool hues (Plan 01 review)", () => {
  const index = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  const rule = index.match(/\.thinking-shimmer-text\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /oklch\([^)]*\b(260|240|250)\)/);
  assert.match(rule, /var\(--color-muted-foreground\)/);
  assert.match(rule, /var\(--color-foreground\)/);
  assert.match(
    index,
    /prefers-reduced-motion: reduce[\s\S]*\.thinking-shimmer-text\s*\{[^}]*animation:\s*none/
  );
});

test("all tooltip states preserve the exact route without inventing a second line", async () => {
  const { buildPillTooltipLines } =
    await import("../../src/components/dictation/pillTooltipLines.ts");
  for (const [micState, first] of [
    ["hover", "pill.tooltip.press(Alt+Space)"],
    ["processing", "app.mic.processing"],
    ["unavailable", "app.mic.waitingForMicrophone"],
  ]) {
    const input = {
      micState,
      activationMode: "tap",
      hotkeyLabel: "Alt+Space",
      routeLine: "exact frozen route",
      t,
    };
    assert.deepEqual(buildPillTooltipLines(input), [first, input.routeLine]);
    assert.deepEqual(buildPillTooltipLines({ ...input, routeLine: "" }), [first]);
  }
});

test("restore, exit and shimmer use the shared cadence and distinct enter/exit tokens", () => {
  const styles = css();
  const restore = styles.match(/\.assistant-response-content\s*\{([^}]*)\}/)[1];
  assert.match(restore, /opacity var\(--motion-base\) var\(--motion-ease-enter\)/);
  assert.match(restore, /filter var\(--motion-base\) var\(--motion-ease-enter\)/);
  const index = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  assert.match(index, /--motion-thinking-shimmer:\s*2000ms/);
  assert.match(
    index,
    /animation: thinking-shimmer var\(--motion-thinking-shimmer\) linear infinite/
  );
});

test("tooltip reuses bounded caption geometry with distinct non-live tooltip semantics", async (t) => {
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { installTree } = require("../helpers/harness/fakeDomTree");
  const {
    installBrowserGlobals,
    installHookDom,
    createRendererServer,
  } = require("../lib/rendererTestHarness");
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window: { innerWidth: 208, innerHeight: 120 } });
  installHookDom(t);
  const tree = installTree();
  const original = globalThis.document.createElement;
  globalThis.document.createElement = (tag) => {
    const element = original(tag);
    Object.defineProperty(element, "parentElement", { get: () => element.parentNode });
    element.contains = (other) => {
      for (let n = other; n; n = n.parentNode) if (n === element) return true;
      return false;
    };
    element.getBoundingClientRect = () =>
      element.attributes.role === "tooltip"
        ? { x: 12, y: 12, width: 184, height: 48 }
        : { x: 156, y: 68, width: 40, height: 40 };
    return element;
  };
  const vite = await createRendererServer(t, { cachePrefix: "loqui-tooltip-" });
  const { PillTooltip } = await vite.ssrLoadModule("/components/dictation/PillTooltip.tsx");
  const propsOf = tree.props;
  const visible = [];
  const elementRef = { current: null };
  const onVisibilityChange = (value) => visible.push(value);
  root = createRoot(tree.container);
  const render = (disabled = false, align = "right") =>
    React.act(async () =>
      root.render(
        React.createElement(
          PillTooltip,
          {
            content: receivers,
            align,
            disabled,
            elementRef,
            onVisibilityChange,
          },
          React.createElement("button", null, "Talk")
        )
      )
    );
  const receivers = "Press Alt+Space to start · Speech: department.company.example";
  await render();
  const anchor = tree.find((n) => n.attributes?.class?.includes("pill-tooltip-anchor"));
  assert.equal(elementRef.current, null);
  await React.act(async () => propsOf(anchor).onMouseEnter());
  const tooltip = tree.find((n) => n.attributes?.role === "tooltip");
  assert.equal(tooltip, elementRef.current, "same ref joins the existing input region");
  assert.equal(tooltip.attributes["aria-live"], undefined);
  assert.equal(tooltip.attributes.tabindex, "0");
  assert.equal(tooltip.textContent, receivers);
  assert.equal(tooltip.style.left, "-144px");
  assert.equal(tooltip.style.maxHeight, "48px");
  await React.act(async () => propsOf(anchor).onFocusCapture());
  await React.act(async () => propsOf(anchor).onMouseLeave());
  assert.equal(
    elementRef.current,
    tooltip,
    "keyboard focus retains scroll surface after pointer leaves"
  );
  await React.act(async () =>
    propsOf(anchor).onBlurCapture({ currentTarget: anchor, relatedTarget: tooltip })
  );
  assert.equal(elementRef.current, tooltip, "focus moving inside does not close it");
  await render(true);
  assert.equal(elementRef.current, null, "higher-priority caption can suppress tooltip");
  assert.equal(visible.at(-1), false);
  await render(false, "center");
  assert.equal(
    elementRef.current.style.left,
    "-144px",
    "center preference still clamps to viewport"
  );
  await React.act(async () =>
    propsOf(anchor).onBlurCapture({ currentTarget: anchor, relatedTarget: null })
  );
  assert.equal(elementRef.current, null);
});

test("all eleven locale namespaces contain both real instruction translations", () => {
  for (const locale of ["ar", "de", "en", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"]) {
    const data = JSON.parse(
      fs.readFileSync(path.join(repoRoot, `src/locales/${locale}/translation.json`), "utf8")
    );
    for (const key of ["hold", "press"]) {
      assert.match(data.pill.tooltip[key], /{{hotkey}}/, `${locale}: ${key}`);
      assert.doesNotMatch(data.pill.tooltip[key], /pill\.tooltip/);
    }
  }
});
