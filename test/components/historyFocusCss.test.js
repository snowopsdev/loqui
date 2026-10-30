const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");

test("a deep-linked row rings for 1.2s, and reduced motion keeps the ring without the pulse", () => {
  assert.match(
    css,
    /\[data-focused="true"\]\s*\{[^}]*animation:\s*history-row-focus var\(--motion-dwell-ring\) var\(--motion-ease-std\)/
  );
  assert.match(css, /@keyframes history-row-focus/);
  assert.match(
    css,
    /prefers-reduced-motion: reduce[\s\S]*\[data-focused="true"\]\s*\{[^}]*animation:\s*none[^}]*box-shadow/
  );
});
