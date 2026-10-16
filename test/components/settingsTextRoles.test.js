const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");

// Source guard (I13): the files this plan changes may not put words in a role
// that cannot clear 4.5:1. text-success is 3.30:1 and text-warning 3.19:1 on
// white; text-primary (brand orange) is 3.12:1. Behavioural and numeric
// coverage is in settingsContrast.test.js; this keeps a later edit honest.
// Task 12/14 extend FILES with the keyring and storage components they add.
const FILES = [
  "src/components/settings/routing/RouteChips.tsx",
  "src/components/settings/LocalSupportModels.tsx",
  "src/components/ui/SettingsSection.tsx",
];

test("[source guard] Settings files use no low-contrast text roles (change-driving: the old selector badge was text-primary on a primary tint)", () => {
  for (const file of FILES) {
    const source = read(file);
    for (const bad of [
      /\btext-success\b(?!\/)/,
      /\btext-warning\b(?!\/)/,
      /\btext-primary\b(?!\/)/,
    ])
      assert.doesNotMatch(source, bad, `${file} uses ${bad}`);
  }
});

test("[source guard] the cloud model list says Selected in the foreground role, not Active in orange", () => {
  const source = read("src/components/ui/ModelCardList.tsx");
  assert.match(
    source,
    /text-foreground[^"]*bg-muted[^"]*"[^>]*>\s*\{t\("routes\.selection\.selected"\)\}/
  );
  assert.doesNotMatch(source, /common\.active/);
});

test("[source guard] motion in the files changed here uses shared tokens, not literal durations", () => {
  for (const file of [
    "src/components/settings/routing/RouteChips.tsx",
    "src/components/settings/LocalSupportModels.tsx",
  ]) {
    assert.doesNotMatch(read(file), /\bduration-\d+\b/, file);
  }
  const selector = read("src/components/ui/SettingsSection.tsx");
  const body = selector.slice(selector.indexOf("export function InferenceModeSelector"));
  assert.doesNotMatch(body, /\bduration-\d+\b/);
  assert.match(body, /duration-\[var\(--motion-fast\)\]/);
});
