const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = fs.readFileSync(path.join(__dirname, "../../src/components/SettingsPage.tsx"), "utf8");
const load = () => import("../../src/utils/audioDeletion.ts");

test("only a clean delete of a readable store that reads back empty counts as cleared", async () => {
  const { resolveClearAudioOutcome } = await load();
  const ok = { failed: 0, readable: true };
  assert.equal(resolveClearAudioOutcome(ok, { fileCount: 0, readable: true }), "cleared");
  assert.equal(resolveClearAudioOutcome(ok, { fileCount: 3, readable: true }), "partial");
  assert.equal(
    resolveClearAudioOutcome({ failed: 1, readable: true }, { fileCount: 0, readable: true }),
    "partial"
  );
  assert.equal(
    resolveClearAudioOutcome(ok, { fileCount: 0, readable: false }),
    "partial",
    "unreadable is not empty"
  );
  assert.equal(
    resolveClearAudioOutcome({ failed: 0, readable: false }, { fileCount: 0, readable: true }),
    "partial"
  );
  assert.equal(resolveClearAudioOutcome(null, null), "partial");
});

test("Clear All re-reads before confirming and never confirms a stale count", () => {
  const handler = page.match(/const handleClearAllAudio = async \(\) => \{[\s\S]*?\n {2}\};/)[0];
  assert.match(handler, /const current = await audioStorage\.refresh\(\);/);
  assert.match(handler, /if \(current\.status !== "known"\) return;/);
  assert.match(handler, /showConfirmDialog\(\{/);
  assert.match(handler, /variant: "destructive"/);
  assert.match(handler, /t\("settingsPage\.privacy\.clearAllAudioCounted"/);
  assert.doesNotMatch(page, /\/\/ silent fail/);
  assert.doesNotMatch(page, /audioStorageUsage\b/, "the old zero-default state is gone");
});
