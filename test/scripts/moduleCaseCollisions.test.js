const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const MODULE_EXT = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/;

// macOS and Windows resolve module paths case-insensitively, so an extensionless
// import of `./Foo` can load `./foo.ts` instead of `./Foo.tsx` there while Linux
// still builds. Sibling modules must not differ only by letter case.
function caseCollisions(dir) {
  const groups = new Map();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (MODULE_EXT.test(entry.name)) {
        const stem = path.relative(root, full).replace(MODULE_EXT, "");
        const key = stem.toLowerCase();
        if (!groups.has(key)) groups.set(key, new Set());
        groups.get(key).add(stem);
      }
    }
  };
  walk(dir);
  return [...groups.values()]
    .filter((stems) => stems.size > 1)
    .map((stems) => [...stems].sort().join(" <-> "))
    .sort();
}

test("renderer modules never differ only by letter case", () => {
  assert.deepEqual(caseCollisions(path.join(root, "src")), [
    // Pre-existing: AppRouter imports "./preview/BrowserPreview.tsx" with its
    // extension and main.jsx imports "./preview/browserPreview" (the .ts file),
    // so both resolve correctly on case-insensitive file systems.
    "src/preview/BrowserPreview <-> src/preview/browserPreview",
  ]);
});
