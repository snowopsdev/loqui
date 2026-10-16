const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/ui/DownloadProgressBar.tsx"),
  "utf8"
);

async function render(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-download-progress-bar-"));
  const { DownloadProgressBar } = await vite.ssrLoadModule(
    "/components/ui/DownloadProgressBar.tsx"
  );
  return renderToStaticMarkup(
    createElement(DownloadProgressBar, { modelName: "Parakeet", ...props })
  );
}

const progress = (overrides = {}) => ({
  percentage: 42.4,
  downloadedBytes: 265_000_000,
  totalBytes: 631_000_000,
  ...overrides,
});

test("a known percentage is a progressbar named by its visible label", async (t) => {
  const html = await render(t, { progress: progress() });
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="42"/);
  assert.match(html, /aria-valuemin="0"/);
  assert.match(html, /aria-valuemax="100"/);
  const labelId = html.match(/<p id="([^"]+)"/)[1];
  assert.ok(html.includes(`aria-labelledby="${labelId}"`), "progressbar is labelled by the line");
});

test("the label is translated, never concatenated English", async (t) => {
  const downloading = await render(t, { progress: progress() });
  assert.match(downloading, /models\.downloadingNamed\(model=Parakeet\)/);
  const installing = await render(t, { progress: progress(), isInstalling: true });
  assert.match(installing, /models\.installingNamed\(model=Parakeet\)/);
  assert.doesNotMatch(source, /`(Downloading|Installing) \$\{modelName\}`/);
});

test("installing and byte-only downloads are indeterminate", async (t) => {
  const installing = await render(t, { progress: progress(), isInstalling: true });
  assert.match(installing, /role="progressbar"/);
  assert.doesNotMatch(installing, /aria-valuenow=/);
  const byteOnly = await render(t, { progress: progress({ totalBytes: 0 }) });
  assert.doesNotMatch(byteOnly, /aria-valuenow=/);
});

test("out-of-range or missing percentages are clamped before they reach the DOM", async (t) => {
  for (const [percentage, expected] of [
    [Number.NaN, "0"],
    [-5, "0"],
    [250, "100"],
  ]) {
    const html = await render(t, { progress: progress({ percentage }) });
    assert.match(html, new RegExp(`aria-valuenow="${expected}"`));
    assert.match(html, new RegExp(`width:${expected}%`));
    assert.doesNotMatch(html, />NaN%</);
  }
});

test("the bar's text and indicator clear the contrast floor in both themes", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");
  const { light, dark } = resolveTokens(css);
  const pairs = [
    [
      "--color-foreground",
      "--color-muted",
      4.5,
      "percentage on its chip, and the fill on the track",
    ],
    ["--color-input-border", "--color-muted", 3, "track edge on the track"],
    ["--color-foreground", "--color-background", 4.5, "label"],
    ["--color-muted-foreground", "--color-background", 4.5, "speed and time left"],
    ["--color-muted-foreground", "--color-card", 4.5, "speed and time left on a card"],
  ];
  for (const [theme, tokens] of [
    ["light", light],
    ["Plum Night", dark],
  ])
    for (const [fg, bg, min, what] of pairs) {
      const ratio = contrastRatio(tokens[fg], tokens[bg]);
      assert.ok(ratio >= min, `${theme}: ${what} is ${ratio}:1`);
    }
});

test("the bar is built from those tokens, with no orange and no faded text", () => {
  assert.doesNotMatch(source, /text-primary|bg-primary|rgb\(255_90_31|border-white\/5|bg-white\/5/);
  assert.doesNotMatch(source, /text-muted-foreground\/\d+/);
  assert.match(source, /border-b border-border-subtle/);
  assert.match(source, /bg-muted ring-1 ring-inset ring-input-border/);
  assert.match(source, /text-xs font-bold text-foreground tabular-nums/);
  assert.match(source, /\bbg-foreground\b/);
});

test("the fill and all three loops take their timing from the motion tokens", () => {
  assert.match(source, /width var\(--motion-base\) var\(--motion-ease-std\)/);
  assert.doesNotMatch(source, /width 300ms ease-out/);
  // Sweep.
  assert.match(
    source,
    /animate-\[indeterminate_calc\(var\(--motion-slow\)\*4\)_var\(--motion-ease-std\)_infinite\]/
  );
  // Spinner: a transform loop, so it runs only when motion is allowed. Linear,
  // because an eased rotation stalls once per turn.
  assert.match(
    source,
    /motion-safe:animate-\[spinner-rotate_calc\(var\(--motion-hero\)\*2\)_linear_infinite\]/
  );
  // Pulse.
  assert.equal(source.match(/\bprogress-pulse\b/g)?.length, 2, "badge and installing fill");
  // No Tailwind loop with literal timings is left.
  assert.doesNotMatch(source, /\banimate-(spin|pulse|ping|bounce)\b/);
  assert.doesNotMatch(source, /1\.5s|ease-in-out|\b\d+(\.\d+)?m?s_/);
});

test("the pulse is opacity only, tokenized, and the one loop kept under reduced motion", () => {
  const { parseRules, isLayered } = require("../helpers/harness/cssRules");
  const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");
  const rules = parseRules(css);
  const frames = rules.filter((r) => r.atRules.includes("@keyframes progress-pulse"));
  assert.ok(frames.length > 0, "@keyframes progress-pulse exists");
  for (const frame of frames) {
    const properties = [...frame.body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    assert.deepEqual(
      [...new Set(properties)],
      ["opacity"],
      `${frame.selector} animates opacity only`
    );
  }
  const base = rules.find((r) => r.selector === ".progress-pulse" && r.atRules.length === 0);
  assert.ok(base, ".progress-pulse is a top-level rule");
  assert.equal(isLayered(base), false);
  assert.match(
    base.body,
    /animation:\s*progress-pulse calc\(var\(--motion-hero\) \* 4\) var\(--motion-ease-std\) infinite;/
  );
  // The global reduced-motion rule (`*`, !important) sets every animation to
  // 0.01ms and one iteration; a class selector with !important outranks it.
  const reduced = rules.find(
    (r) =>
      r.selector === ".progress-pulse" &&
      r.atRules.includes("@media (prefers-reduced-motion: reduce)")
  );
  assert.ok(reduced, "the pulse is re-declared for reduced motion");
  assert.match(reduced.body, /animation-duration:\s*calc\(var\(--motion-hero\) \* 4\) !important;/);
  assert.match(reduced.body, /animation-iteration-count:\s*infinite !important;/);
  const killAll = rules.find(
    (r) =>
      r.selector.startsWith("*") && r.atRules.includes("@media (prefers-reduced-motion: reduce)")
  );
  assert.match(
    killAll.body,
    /animation-duration: 0\.01ms !important;/,
    "the global rule is unchanged"
  );
});
