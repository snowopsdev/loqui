const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");

test("Check for Updates is not disabled by turning automatic updates off", () => {
  const ui = read("src/components/settings/UpdateSettings.tsx");
  assert.doesNotMatch(ui, /!status\?\.enabled/);
  assert.match(
    ui,
    /disabled=\{!status \|\| \["checking", "downloading"\]\.includes\(status\.phase\)\}/
  );
});

test("an available update offers the GitHub download and names the version", () => {
  const ui = read("src/components/settings/UpdateSettings.tsx");
  assert.match(
    ui,
    /status\?\.phase === "available" && \(\s*<p>\{t\("updates\.available", \{ version: status\.availableVersion \}\)\}<\/p>/
  );
  assert.match(ui, /status\?\.phase === "manual" \|\| status\?\.phase === "available" \?/);
  assert.match(read("src/types/updates.ts"), /"available"/);
});

test("no physical margin remains in the update controls", () => {
  assert.doesNotMatch(read("src/components/settings/UpdateSettings.tsx"), /\bml-2\b/);
});

test("the privacy doc explains the manual check with automatic updates off", () => {
  assert.match(
    read("docs/PRIVACY.md"),
    /With automatic updates off, \*\*Check for Updates\*\* still works/
  );
});
