const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "../..");
const files = [
  "src/components/OnboardingFlow.tsx",
  ...fs
    .readdirSync(path.join(repoRoot, "src/components/onboarding"))
    .map((name) => `src/components/onboarding/${name}`),
];

const forbidden = (source) =>
  [
    /\b(?:window|globalThis)\.loquiBrowserPreview(?:Config)?\b/,
    /import\.meta\.env\.DEV/,
    /\b(?:config|props)\??\.scenario\b/,
    /\bif\s*\(\s*preview\s*(?:\)|&&|\|\|)/,
    /\bif\s*\([^)]*\bscenario\s*(?:[!=]=|\))/,
    />\s*Preview\s*:?\s*</,
    /["'`]Preview: |in this preview|["'`]simulated/i,
  ].some((pattern) => pattern.test(source));
test("setup components contain no preview branches or preview copy (ONB-Q18)", () => {
  for (const file of files)
    assert.equal(forbidden(fs.readFileSync(path.join(repoRoot, file), "utf8")), false, file);
});
test("guard rejects actual runtime/scenario/copy branches and allows legitimate microphone and cleanup identifiers", () => {
  for (const bad of [
    "window.loquiBrowserPreview",
    'config?.scenario === "ready"',
    "if (preview) return true;",
    'if (scenario === "ready") return true;',
    "<span>Preview:</span>",
    '"simulated recording"',
  ])
    assert.equal(forbidden(bad), true, bad);
  assert.equal(
    forbidden('preview: MicLevelPreview; if (preview.source === "example") cleanupPreview(input);'),
    false
  );
});

test("the old onboarding styles and welcome screen are gone", () => {
  for (const gone of [
    "src/styles/onboarding-welcome.css",
    "src/styles/onboarding-guided.css",
    "src/components/onboarding/WelcomeScreen.tsx",
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, gone)), false, gone);
  }
});

test("the after-setup intent is handed to the workspace once, for both kinds", () => {
  const router = fs.readFileSync(path.join(repoRoot, "src/AppRouter.jsx"), "utf8");
  const panel = fs.readFileSync(path.join(repoRoot, "src/components/ControlPanel.tsx"), "utf8");
  assert.match(router, /if \(options\?\.next\) setAfterSetupIntent\(options\.next\)/);
  assert.match(panel, /takeAfterSetupIntent\(\)/);
  assert.match(panel, /intent\.kind === "dictate-note"[\s\S]*?handleNewNote\(\)/);
  assert.match(panel, /setSettingsSection\(intent\.path\)[\s\S]*?setShowSettings\(true\)/);
});
