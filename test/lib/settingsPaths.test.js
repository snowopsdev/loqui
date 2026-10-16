const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/settingsPaths.ts");

test("route paths open the right section and sub-tab", async () => {
  const { parseSettingsPath } = await load();
  assert.deepEqual(parseSettingsPath("stt/dictation"), {
    section: "speechToText",
    subTab: "dictation",
  });
  assert.deepEqual(parseSettingsPath("stt/noteRecording"), {
    section: "speechToText",
    subTab: "noteRecording",
  });
  assert.deepEqual(parseSettingsPath("llms/supportModels"), {
    section: "llms",
    subTab: "supportModels",
  });
  assert.deepEqual(parseSettingsPath("privacyData"), { section: "privacyData" });
});

test("every route settingsPath lands on a sub-tab that exists", async () => {
  const { parseSettingsPath, SPEECH_SUB_TABS, LLM_SUB_TABS } = await load();
  const { ROUTE_SETTINGS_PATH } = await import("../../src/lib/routeGraph.ts");
  for (const [id, path] of Object.entries(ROUTE_SETTINGS_PATH)) {
    const loc = parseSettingsPath(path);
    assert.ok(loc.subTab, `${id} (${path}) lost its sub-tab`);
    const tabs = loc.section === "speechToText" ? SPEECH_SUB_TABS : LLM_SUB_TABS;
    assert.ok(tabs.includes(loc.subTab), `${id}: ${loc.subTab}`);
  }
});

test("legacy deep links keep landing where they used to", async () => {
  const { parseSettingsPath } = await load();
  assert.deepEqual(parseSettingsPath("transcription"), {
    section: "speechToText",
    subTab: "dictation",
  });
  assert.deepEqual(parseSettingsPath("dictationAgent"), {
    section: "llms",
    subTab: "dictationAgent",
  });
  assert.deepEqual(parseSettingsPath("intelligence"), {
    section: "llms",
    subTab: "dictationCleanup",
  });
  assert.deepEqual(parseSettingsPath("developer"), { section: "system" });
  assert.deepEqual(parseSettingsPath("transcription/upload"), {
    section: "speechToText",
    subTab: "upload",
  });
});

test("unknown or empty paths fall back to Preferences instead of a blank page", async () => {
  const { parseSettingsPath } = await load();
  for (const p of [undefined, null, "", "nope", "nope/x", "/dictation"]) {
    assert.deepEqual(parseSettingsPath(p), { section: "general" }, String(p));
  }
});

test("an unknown sub-tab drops to the section instead of a hidden tab", async () => {
  const { parseSettingsPath } = await load();
  assert.deepEqual(parseSettingsPath("llms/nope"), { section: "llms" });
  assert.deepEqual(parseSettingsPath("stt/chatIntelligence"), { section: "speechToText" });
});
