const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "../..");
const source = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("panel notices anchor logically in both document directions and rise without horizontal motion", () => {
  const css = source("src/styles/notices.css");
  assert.match(css, /\.notice-stack\[data-placement="panel"\]\s*\{[^}]*inset-inline-end: 20px;/);
  const enter = css.match(/@keyframes notice-in\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(enter);
  assert.match(enter, /translateY\(8px\)/);
  assert.doesNotMatch(enter, /translateX|translate\(/);
  assert.match(
    css,
    /prefers-reduced-motion: reduce[\s\S]*?animation: notice-fade[\s\S]*?transform: none/
  );
});
