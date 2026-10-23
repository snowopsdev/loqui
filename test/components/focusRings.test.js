const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { parseRules, isLayered } = require("../helpers/harness/cssRules");

const css = fs.readFileSync(path.join(__dirname, "../..", "src/index.css"), "utf8");

test("no unlayered rule can override a button's focus ring", () => {
  const offenders = parseRules(css).filter(
    (rule) =>
      !isLayered(rule) &&
      /\bbutton\b|\[role="(button|tab)"\]/.test(rule.selector) &&
      /:focus/.test(rule.selector) &&
      /\b(box-shadow|outline)\s*:/.test(rule.body)
  );
  assert.deepEqual(offenders.map((rule) => rule.selector), []);
});
