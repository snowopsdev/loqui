const assert = require("node:assert/strict");
const test = require("node:test");

const loadCommands = () => import("../../src/components/commandSearch/commands.ts");
const loadShortcuts = () => import("../../src/lib/workspaceShortcuts.ts");

test("every command has a unique id, a label key and a working hint", async () => {
  const { WORKSPACE_COMMANDS } = await loadCommands();
  const { shortcutHint } = await loadShortcuts();
  const ids = WORKSPACE_COMMANDS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const command of WORKSPACE_COMMANDS) {
    assert.match(command.labelKey, /^commandSearch\.commands\./);
    if (command.shortcut) assert.notEqual(shortcutHint(command.shortcut, "darwin"), "", command.id);
  }
});

test("suggested commands exist, in R5 A order", async () => {
  const { WORKSPACE_COMMANDS, SUGGESTED_COMMAND_IDS } = await loadCommands();
  assert.deepEqual(SUGGESTED_COMMAND_IDS, ["newNote", "startDictation", "askAssistant", "goNotes"]);
  for (const id of SUGGESTED_COMMAND_IDS)
    assert.ok(
      WORKSPACE_COMMANDS.some((c) => c.id === id),
      id
    );
});

test("commands only navigate or toggle; none sends content anywhere", async () => {
  const { WORKSPACE_COMMANDS } = await loadCommands();
  const calls = [];
  const nav = new Proxy(
    {},
    {
      get:
        (_, name) =>
        (...args) =>
          calls.push([name, ...args]),
    }
  );
  const deps = {
    toggleDictation: () => calls.push(["toggleDictation"]),
    toggleTheme: () => calls.push(["toggleTheme"]),
    speechSettingsPath: () => "stt/dictation",
  };
  for (const command of WORKSPACE_COMMANDS) command.run(nav, deps);
  assert.ok(
    calls.some(([name, arg]) => name === "openSettings" && arg === "stt/dictation"),
    "Switch speech model opens the dictation route's settingsPath (§5.1)"
  );
  const allowed = new Set([
    "newNote",
    "toggleDictation",
    "focusAssistant",
    "openView",
    "recordMeeting",
    "openUpload",
    "startChat",
    "openSettings",
    "toggleTheme",
  ]);
  for (const [name, arg] of calls) {
    assert.ok(allowed.has(name), name);
    if (name === "startChat") assert.equal(arg?.draft, undefined);
  }
});
