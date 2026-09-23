const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyPaths, changedPaths } = require("../../scripts/ci-changes.cjs");

test("documentation-only changes keep the CI gate but skip compilation", () => {
  assert.deepEqual(classifyPaths(["README.md", "docs/RELEASE.md", "native/README.md", "LICENSE"]), {
    code: false,
    platform: false,
  });
});

test("renderer changes run quality while packaging inputs run platform checks", () => {
  assert.deepEqual(classifyPaths(["src/components/OnboardingFlow.tsx"]), {
    code: true,
    platform: false,
  });
  for (const file of [
    "electron-builder.cjs",
    "electron-builder.json",
    ".node-version",
    "main.js",
    "preload.js",
    "src/config/product.json",
    "src/helpers/updateManager.js",
    "package-lock.json",
    "resources/mac/entitlements.mac.plist",
    ".github/workflows/platform.yml",
  ]) {
    assert.equal(classifyPaths([file]).platform, true, file);
  }
});

test("first push checks all tracked files and preserves filenames containing newlines", () => {
  const calls = [];
  const files = changedPaths("0".repeat(40), (args) => {
    calls.push(args);
    return "README.md\0src/a\nb.ts\0";
  });
  assert.deepEqual(calls, [["ls-files", "-z"]]);
  assert.deepEqual(files, ["README.md", "src/a\nb.ts"]);
  assert.equal(classifyPaths(files).code, true);
});

test("unavailable or malformed base commits cannot silently skip CI", () => {
  assert.throws(() => changedPaths("--all"), /base commit SHA/);
  assert.throws(
    () =>
      changedPaths("a".repeat(40), () => {
        throw Error("missing commit");
      }),
    /missing commit/
  );
});
