const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/settingsPaths.ts");

// change-driving: Task 4's SETTINGS_SECTIONS has no "routing" and SECTION_ALIASES no "routes"
// (Task 4 leaves both to this task), so both paths fall back to { section: "general" } today.
test("routing is a settings section right after hotkeys, and routes is its alias", async () => {
  const { parseSettingsPath, SETTINGS_SECTIONS } = await load();
  assert.equal(SETTINGS_SECTIONS.indexOf("routing"), SETTINGS_SECTIONS.indexOf("hotkeys") + 1);
  assert.deepEqual(parseSettingsPath("routing"), { section: "routing" });
  assert.deepEqual(parseSettingsPath("routes"), { section: "routing" });
});

// baseline guard: Task 4's stt alias and route paths keep working after the insert.
test("the stt alias still opens Speech to text", async () => {
  const { parseSettingsPath } = await load();
  assert.deepEqual(parseSettingsPath("stt/upload"), { section: "speechToText", subTab: "upload" });
});
