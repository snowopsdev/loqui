const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { parseRules } = require("../helpers/harness/cssRules");

const read = (file) => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");
const rules = (file) => parseRules(read(file));
const hasHeight = (rule, value) =>
  new RegExp(`(?:^|;)\\s*height:\\s*${value}\\s*(?:;|$)`).test(rule.body);

test("the actual onboarding shell fills preview content below its retained toolbar", () => {
  const preview = read("src/preview/BrowserPreview.tsx");
  assert.match(preview, /className="browser-preview flex h-dvh flex-col/);
  assert.match(preview, /className="browser-preview-content min-h-0 flex-1"/);
  assert.match(preview, /<OnboardingFlow\s/);
  assert.match(read("src/components/onboarding/OnboardingShell.tsx"), /className="onb-shell"/);
  const previewRules = rules("src/preview/preview.css");
  const fill = previewRules.find((rule) =>
    rule.selector.split(/\s*,\s*/).includes(".browser-preview-content > .onb-shell")
  );
  assert.ok(fill, "the new shell needs the same container-height integration as h-screen");
  assert.ok(hasHeight(fill, "100%"), "use available content height, not window/toolbar math");
  const toolbar = previewRules.find((rule) => rule.selector === ".browser-preview-toolbar");
  assert.match(toolbar.body, /flex:\s*none\s*;/, "the toolbar keeps its natural height");
  assert.doesNotMatch(toolbar.body, /display:\s*none\b/);
});

test("native onboarding and the existing h-screen preview sizing stay intact", () => {
  const native = rules("src/styles/onboarding.css").find((rule) => rule.selector === ".onb-shell");
  assert.ok(hasHeight(native, "100dvh"), "native shell still fills its own window");
  const legacy = rules("src/preview/preview.css").find((rule) =>
    rule.selector.split(/\s*,\s*/).includes(".browser-preview-content > .h-screen")
  );
  assert.ok(hasHeight(legacy, "100%"), "other existing preview modes keep their override");
});
