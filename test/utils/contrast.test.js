const assert = require("node:assert/strict");
const test = require("node:test");
const { readTokens, resolveTokens } = require("../helpers/harness/cssTokens");

const load = () => import("../../src/utils/contrast.ts");

test("contrast ratios match WCAG reference values", async () => {
  const { contrastRatio, roundContrastRatio } = await load();
  const shown = (a, b) => roundContrastRatio(contrastRatio(a, b));
  assert.equal(shown("#ffffff", "#ff5a1f"), 3.12);
  assert.equal(shown("#171717", "#ff5a1f"), 5.75);
  assert.equal(shown("#171717", "#ff6a36"), 6.29);
  assert.equal(shown("#c43e13", "#ffffff"), 5.19);
  assert.equal(contrastRatio("#000", "#fff"), 21);
  assert.equal(contrastRatio("#ff5a1f", "#ffffff"), contrastRatio("#ffffff", "#ff5a1f"));
});

test("the ratio keeps full precision so a threshold is never reached by rounding", async () => {
  const { contrastRatio, roundContrastRatio } = await load();
  // 4.49995:1 is below AA text; rounding to two places would show 4.5.
  const ratio = contrastRatio("#008580", "#ffffff");
  assert.ok(ratio < 4.5, `${ratio}`);
  assert.equal(roundContrastRatio(ratio), 4.5);
});

test("non-hex colours are rejected rather than silently scored", async () => {
  const { parseHexColor } = await load();
  assert.throws(() => parseHexColor("oklch(0.22 0.006 260)"), /Unsupported colour/);
  assert.throws(() => parseHexColor("#12345"), /Unsupported colour/);
  assert.deepEqual(parseHexColor("#FfF"), { r: 255, g: 255, b: 255 });
});

test("token reader reads a final declaration without a semicolon", () => {
  const css = "@theme {\n  --color-a: #111111;\n  --color-b: #222222\n}";
  assert.deepEqual(readTokens(css, "@theme"), { "--color-a": "#111111", "--color-b": "#222222" });
  assert.deepEqual(readTokens("@theme { --color-a: #111111 }", "@theme"), {
    "--color-a": "#111111",
  });
});

test("token reader ignores braces and declarations inside comments", () => {
  const css =
    "@theme {\n  /* old } value */\n  --color-a: #111111; /* { */\n  /* --color-b: #222222; */\n}\n.dark {\n  --color-a: #333333;\n}";
  assert.deepEqual(readTokens(css, "@theme"), { "--color-a": "#111111" });
  assert.deepEqual(readTokens(css, ".dark"), { "--color-a": "#333333" });
});

test("token reader only matches top-level blocks and rejects missing ones", () => {
  const nested =
    "@media print {\n  .dark {\n    --color-a: #999999;\n  }\n}\n.dark {\n  --color-a: #333333;\n}";
  assert.deepEqual(readTokens(nested, ".dark"), { "--color-a": "#333333" });
  assert.throws(
    () => readTokens("@media print {\n  .dark {\n    --c: #111111;\n  }\n}", ".dark"),
    /No block/
  );
});

test("token reader takes the first exact block and overlays .dark on light", () => {
  const css = `@theme {\n  --color-a: #111111;\n  --color-b: #222222;\n}\n.dark {\n  --color-b: #333333;\n}\n.dark .x {\n  --color-b: #999999;\n}`;
  assert.deepEqual(readTokens(css, "@theme"), { "--color-a": "#111111", "--color-b": "#222222" });
  assert.deepEqual(readTokens(css, ".dark"), { "--color-b": "#333333" });
  const { light, dark } = resolveTokens(css);
  assert.equal(light["--color-b"], "#222222");
  assert.equal(dark["--color-b"], "#333333");
  assert.equal(dark["--color-a"], "#111111");
});
