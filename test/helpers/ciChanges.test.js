const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyPaths, changedPaths, isMainPush } = require("../../scripts/ci-changes.cjs");

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
    "src/config/product.json",
    "src/assets/icon.png",
    "package.json",
    "package-lock.json",
    "runtime-assets.json",
    "native/meeting-aec-helper/main.cpp",
    "scripts/prepare-platform.cjs",
    "resources/mac/entitlements.mac.plist",
    ".github/workflows/platform.yml",
    ".github/workflows/quality.yml",
    "test/native/sherpaLoopback.test.js",
    "src/helpers/parakeetCapability.js",
    "src/helpers/sherpaLoopback.js",
    "src/helpers/whisperCppRelease.js",
  ]) {
    assert.equal(classifyPaths([file]).platform, true, file);
  }
});

test("[change-driving] pull requests touching only app logic skip the native platform build", () => {
  for (const file of [
    "main.js",
    "preload.js",
    "src/helpers/updateManager.js",
    "src/helpers/localEmbeddings.js",
    "src/models/modelRegistryData.json",
    "src/workers/onnxWorker.js",
    "src/services/tools/calendarTool.ts",
    "src/locales/de/translation.json",
    "test/helpers/ciChanges.test.js",
    "src/helpers/sherpaLoopbackStatus.js",
    ".github/workflows/release.yml",
  ]) {
    assert.deepEqual(classifyPaths([file]), { code: true, platform: false }, file);
  }
});

test("[change-driving] pushes to main always run the platform build for code changes", () => {
  assert.equal(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" }), true);
  for (const env of [
    { GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/1/merge" },
    { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature" },
    {},
  ])
    assert.equal(isMainPush(env), false);
  assert.deepEqual(classifyPaths(["src/helpers/updateManager.js"], { fullBuild: true }), {
    code: true,
    platform: true,
  });
  assert.deepEqual(classifyPaths(["README.md"], { fullBuild: true }), {
    code: false,
    platform: false,
  });
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

test("[change-driving] a moved packaging input reports its old path, so the platform build still runs", () => {
  const calls = [];
  const files = changedPaths("a".repeat(40), (args) => {
    calls.push(args);
    // git diff --no-renames lists a move as a deletion plus an addition.
    return args[0] === "diff" ? "native/listener.c\0src/legacy/listener.c\0" : "";
  });
  assert.deepEqual(calls.at(-1), [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    "a".repeat(40),
    "HEAD",
  ]);
  assert.equal(classifyPaths(files).platform, true);
});
