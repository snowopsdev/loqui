const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

test("motion tokens are defined once on :root with the approved values", () => {
  const css = read("src/index.css");
  const expected = {
    "--motion-instant": "90ms",
    "--motion-fast": "150ms",
    "--motion-base": "240ms",
    "--motion-slow": "360ms",
    "--motion-hero": "520ms",
    "--motion-ease-std": "cubic-bezier(0.2, 0, 0, 1)",
    "--motion-ease-enter": "cubic-bezier(0.16, 1, 0.3, 1)",
    "--motion-ease-exit": "cubic-bezier(0.2, 0, 0.4, 1)",
  };
  for (const [name, value] of Object.entries(expected)) {
    const matches = css.match(new RegExp(`${name}:\\s*([^;]+);`, "g")) ?? [];
    assert.equal(matches.length, 1, `${name} defined exactly once`);
    assert.equal(matches[0].replace(/^[^:]+:\s*/, "").replace(/;$/, ""), value);
  }
  for (const spring of ["--motion-spring-snap", "--motion-spring-settle", "--motion-spring-bounce"]) {
    assert.match(css, new RegExp(`${spring}:\\s*linear\\(0, `), `${spring} is a linear() spring`);
  }
});

test("no ease-in exit curve anywhere in the renderer", () => {
  const files = walk(path.join(repoRoot, "src"), [".css", ".tsx", ".ts", ".jsx", ".js"]);
  const offenders = files.filter((f) => /cubic-bezier\(\s*0\.4\s*,\s*0\s*,\s*1\s*,\s*1\s*\)/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => path.relative(repoRoot, f)), []);
});

test("the universal selector no longer transitions every element", () => {
  const css = read("src/index.css");
  const universal = css.match(/@layer base\s*\{\s*\*\s*\{([^}]*)\}/);
  assert.ok(universal, "base layer still sets the default border colour on *");
  assert.doesNotMatch(universal[1], /transition/);
});

test("interactive elements keep colour transitions after the global rule is removed", () => {
  const css = read("src/index.css");
  const rule = css.match(/:where\(button, a, input, select, textarea, summary, \[role="button"\], \[role="tab"\], \[role="menuitem"\], \[role="option"\], \[role="switch"\]\)\s*\{([^}]*)\}/);
  assert.ok(rule, "scoped interactive transition rule exists");
  assert.match(rule[1], /background-color var\(--motion-fast\) var\(--motion-ease-std\)/);
  assert.match(rule[1], /color var\(--motion-fast\) var\(--motion-ease-std\)/);
});

test("reduced-motion policy still drops transforms and keeps opacity", () => {
  const css = read("src/index.css");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?transition-property:\s*opacity, color, background-color/);
});
