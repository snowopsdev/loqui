const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveTokens } = require("../helpers/harness/cssTokens");
const { parseRules, isLayered } = require("../helpers/harness/cssRules");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
const css = read("src/index.css");
const load = () => import("../../src/utils/contrast.ts");

// Every surface a field can sit on, or fill itself with.
const SURFACES = [
  "--color-background",
  "--color-input",
  "--color-card",
  "--color-popover",
  "--color-muted",
  "--color-surface-1",
  "--color-surface-raised",
  "--color-surface-window",
];

test("form-control edges clear 3:1 on every surface, in light and Plum Night", async () => {
  const { contrastRatio } = await load();
  const { light, dark } = resolveTokens(css);
  assert.equal(light["--color-input-border"], "#858585");
  assert.equal(dark["--color-input-border"], "#8c6b7b");
  for (const [theme, tokens] of [
    ["light", light],
    ["Plum Night", dark],
  ])
    for (const surface of SURFACES) {
      const ratio = contrastRatio(tokens["--color-input-border"], tokens[surface]);
      assert.ok(ratio >= 3, `${theme}: input border on ${surface} is ${ratio}:1`);
    }
});

test("native inputs and textareas draw their edge with the input border token", () => {
  const light = css.match(
    /:root input:not\(\.input-inline\),\s*:root textarea:not\(\.input-inline\)\s*\{([^}]*)\}/
  );
  const dark = css.match(
    /\.dark input:not\(\.input-inline\),\s*\.dark textarea:not\(\.input-inline\)\s*\{([^}]*)\}/
  );
  for (const [name, block] of [
    ["light", light],
    ["dark", dark],
  ]) {
    assert.ok(block, `${name} field rule exists`);
    assert.match(block[1], /border: 1px solid var\(--color-input-border\);/);
  }
});

test("a focused native field gets a full-opacity ring from an unlayered rule, which no utility can override", () => {
  const rules = parseRules(css);
  for (const scope of [":root", ".dark"]) {
    const selector = `${scope} input:not(.input-inline):focus-visible, ${scope} textarea:not(.input-inline):focus-visible`;
    const rule = rules.find((r) => r.selector === selector);
    assert.ok(rule, `${scope} focus-visible rule exists`);
    assert.equal(isLayered(rule), false, `${scope}: unlayered, so it beats @layer utilities`);
    assert.match(rule.body, /border-color: var\(--color-ring\);/);
    assert.match(
      rule.body,
      /box-shadow: 0 0 0 1px var\(--color-background\), 0 0 0 3px var\(--color-ring\);/
    );
  }
  const translucent = rules.filter(
    (r) => /:focus/.test(r.selector) && /var\(--color-ring\) l c h \/ 0\.\d+/.test(r.body)
  );
  assert.deepEqual(
    translucent.map((r) => r.selector),
    [],
    "no translucent ring is left"
  );
  const plainFocus = rules.filter((r) =>
    /input:not\(\.input-inline\):focus(?!-visible)/.test(r.selector)
  );
  assert.deepEqual(
    plainFocus.map((r) => r.selector),
    [],
    "no :focus rule competes with :focus-visible"
  );
});

test("the Input and Textarea primitives use the token and leave focus to the global rule", () => {
  const input = read("src/components/ui/input.tsx");
  assert.match(input, /\bborder-input-border\b/);
  assert.doesNotMatch(
    input,
    /border-border\/70|dark:border-border-subtle|hover:border-border-hover/
  );
  // A ring utility here would be dead code: the unlayered field rule wins.
  assert.doesNotMatch(input, /focus(-visible)?:ring|focus-visible:border-primary/);
  const textarea = read("src/components/ui/textarea.tsx");
  assert.match(textarea, /\bborder-input-border\b/);
  assert.doesNotMatch(textarea, /neutral-|indigo-|bg-white/);
  assert.doesNotMatch(textarea, /focus(-visible)?:ring|focus:border/);
});
