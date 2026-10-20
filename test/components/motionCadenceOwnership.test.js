const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const postcss = require("postcss");

const readCss = (file) =>
  postcss.parse(fs.readFileSync(path.join(__dirname, "../../src", file), "utf8"));
const app = readCss("index.css");
const notices = readCss("styles/notices.css");

// Respect later declarations in each unconditional global scope. A presence
// regex misses a later same-name override, which caused the integration bug.
const tokens = {};
for (const scope of ["theme", ":root"]) {
  for (const node of app.nodes) {
    if (
      (node.type === "atrule" && node.name === scope) ||
      (node.type === "rule" && node.selector === scope)
    ) {
      for (const declaration of node.nodes) {
        if (declaration.type === "decl" && declaration.prop.startsWith("--"))
          tokens[declaration.prop] = declaration.value;
      }
    }
  }
}

function delay(css, selector) {
  const rule = css.nodes.find((node) => node.type === "rule" && node.selector === selector);
  assert.ok(rule, selector);
  const declarations = rule.nodes.filter((node) => node.prop === "animation-delay");
  assert.ok(declarations.length, `${selector} animation-delay`);
  return declarations.at(-1).value;
}

function milliseconds(expression, variables = tokens) {
  const resolved = expression.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    assert.ok(Object.hasOwn(variables, name), `defined token ${name}`);
    return variables[name];
  });
  const factors = resolved.replace(/^calc\((.*)\)$/, "$1").split(/\s*\*\s*/);
  return factors.reduce((result, factor) => {
    assert.match(factor, /^\d+(?:\.\d+)?(?:ms|s)?$/, `supported delay ${resolved}`);
    return (
      result * parseFloat(factor) * (factor.endsWith("s") && !factor.endsWith("ms") ? 1000 : 1)
    );
  }, 1);
}

test("effective notice burst delays remain 0, 40 and 80 ms after the CSS cascade", () => {
  const expression = delay(notices, ".notice-chip");
  assert.deepEqual(
    [0, 1, 2].map((index) => milliseconds(expression, { ...tokens, "--notice-stagger": index })),
    [0, 40, 80]
  );
});

test("thinking dots own a separate cadence with effective 150 and 300 ms delays", () => {
  const second = delay(app, ".thinking-dots i:nth-child(2)");
  const third = delay(app, ".thinking-dots i:nth-child(3)");
  const noticeTokens = [...delay(notices, ".notice-chip").matchAll(/var\((--[\w-]+)\)/g)].map(
    (match) => match[1]
  );
  for (const match of `${second} ${third}`.matchAll(/var\((--[\w-]+)\)/g))
    assert.ok(
      !noticeTokens.includes(match[1]),
      "loop spacing cannot override notice burst spacing"
    );
  assert.deepEqual([milliseconds(second), milliseconds(third)], [150, 300]);
});
