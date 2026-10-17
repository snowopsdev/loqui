const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing rule ${selector}`);
  return match[1];
};

test("the idle rail is invisible and never animates", () => {
  const body = rule(".capture-rail");
  assert.match(body, /opacity:\s*0/);
  assert.doesNotMatch(body, /animation/);
});

test("listening opacity follows the level", () => {
  assert.match(rule('.capture-rail[data-state="listening"]'), /var\(--capture-level/);
});

test("only Cleaning up has a travelling highlight, and it is a loop gated to that state", () => {
  assert.match(
    rule('.capture-rail[data-state="processing"]::after'),
    /animation:\s*capture-rail-travel var\(--motion-loop-travel\) linear infinite/
  );
  assert.doesNotMatch(
    rule('.capture-rail[data-state="processing"]::after'),
    /\d(?:ms|s)\b/,
    "no literal duration (N03)"
  );
  const travelling = css.match(/animation:[^;]*capture-rail-travel/g) ?? [];
  assert.equal(travelling.length, 1);
});

test("offline is a solid warning rail; Cleaning up is amber, never live orange (D1)", () => {
  assert.match(rule('.capture-rail[data-state="offline"]'), /var\(--color-warning\)/);
  assert.match(
    rule('.capture-rail[data-state="processing"]'),
    /background:\s*var\(--color-warning\)/
  );
});

test("reduced motion removes travel and glow but keeps the state visible", () => {
  // index.css has several reduced-motion blocks; find the one that holds the
  // rail rules without letting the match run across another @media.
  const block = css.match(
    /@media \(prefers-reduced-motion: reduce\)\s*\{(?:(?!@media)[\s\S])*?\.capture-rail\[data-state="processing"\]::after\s*\{\s*display:\s*none;[^}]*\}(?:(?!@media)[\s\S])*?\.capture-rail\[data-state="listening"\]\s*\{[^}]*opacity:\s*1/
  );
  assert.ok(
    block,
    "one reduced-motion block hides the travelling band and holds the listening rail at full opacity"
  );
});

test("rail placement is logical and reduced motion explicitly disables transforms and transitions", () => {
  assert.match(rule(".capture-rail"), /inset-inline-end:\s*0/);
  assert.match(rule(".capture-rail"), /inline-size:\s*2px/);
  assert.match(rule('.capture-rail[data-state="processing"]::after'), /inset-block-start:\s*0/);
  const reduced = css.slice(
    css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf("/* Capture rail"))
  );
  assert.match(reduced, /\.capture-rail\s*\{\s*transition:\s*none/);
  assert.match(reduced, /display:\s*none;\s*animation:\s*none;\s*transform:\s*none/);
});
