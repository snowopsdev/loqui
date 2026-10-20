const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/workspaceShortcuts.ts");
const mac = { platform: "darwin", dialogOpen: false };
const win = { platform: "win32", dialogOpen: false };
const ev = (over) => ({
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

test("the WS-Q12 map on macOS", async () => {
  const { resolveWorkspaceShortcut } = await load();
  const cases = [
    [ev({ metaKey: true, key: "k", code: "KeyK" }), "openSearch"],
    [ev({ metaKey: true, key: ",", code: "Comma" }), "openSettings"],
    [ev({ metaKey: true, key: "1", code: "Digit1" }), "goHome"],
    [ev({ metaKey: true, key: "2", code: "Digit2" }), "goNotes"],
    [ev({ metaKey: true, key: "3", code: "Digit3" }), "goChat"],
    [ev({ metaKey: true, key: "\\", code: "Backslash" }), "toggleSidebar"],
    [ev({ metaKey: true, key: "n", code: "KeyN" }), "newNote"],
    [ev({ metaKey: true, shiftKey: true, key: "N", code: "KeyN" }), "newChat"],
    [ev({ metaKey: true, shiftKey: true, key: "M", code: "KeyM" }), "recordMeeting"],
    [ev({ metaKey: true, shiftKey: true, key: "U", code: "KeyU" }), "uploadAudio"],
    [ev({ metaKey: true, key: "/", code: "Slash" }), "askAssistant"],
  ];
  for (const [event, action] of cases)
    assert.equal(resolveWorkspaceShortcut(event, mac), action, action);
});

test("Windows and Linux use Ctrl, and Cmd does nothing there", async () => {
  const { resolveWorkspaceShortcut } = await load();
  assert.equal(
    resolveWorkspaceShortcut(ev({ ctrlKey: true, key: "2", code: "Digit2" }), win),
    "goNotes"
  );
  assert.equal(
    resolveWorkspaceShortcut(ev({ metaKey: true, key: "2", code: "Digit2" }), win),
    null
  );
  assert.equal(
    resolveWorkspaceShortcut(ev({ ctrlKey: true, key: "2", code: "Digit2" }), mac),
    null
  );
});

test("view digits follow the physical key on AZERTY", async () => {
  const { resolveWorkspaceShortcut } = await load();
  assert.equal(
    resolveWorkspaceShortcut(ev({ metaKey: true, key: "&", code: "Digit1" }), mac),
    "goHome"
  );
});

test("nothing that changes the view fires behind an open dialog", async () => {
  const { resolveWorkspaceShortcut } = await load();
  const blocked = { platform: "darwin", dialogOpen: true };
  assert.equal(
    resolveWorkspaceShortcut(ev({ metaKey: true, key: "1", code: "Digit1" }), blocked),
    null
  );
  assert.equal(
    resolveWorkspaceShortcut(ev({ metaKey: true, key: "n", code: "KeyN" }), blocked),
    null
  );
  assert.equal(
    resolveWorkspaceShortcut(ev({ metaKey: true, key: "\\", code: "Backslash" }), blocked),
    null
  );
  assert.equal(
    resolveWorkspaceShortcut(ev({ metaKey: true, key: "k", code: "KeyK" }), blocked),
    "openSearch"
  );
});

test("IME composition, Alt chords and handled events are ignored", async () => {
  const { resolveWorkspaceShortcut } = await load();
  assert.equal(
    resolveWorkspaceShortcut(
      ev({ metaKey: true, key: "1", code: "Digit1", isComposing: true }),
      mac
    ),
    null
  );
  assert.equal(
    resolveWorkspaceShortcut(ev({ metaKey: true, altKey: true, key: "1", code: "Digit1" }), mac),
    null
  );
  assert.equal(
    resolveWorkspaceShortcut(
      ev({ metaKey: true, key: "1", code: "Digit1", defaultPrevented: true }),
      mac
    ),
    null
  );
});

test("hints read naturally per platform", async () => {
  const { shortcutHint } = await load();
  assert.equal(shortcutHint("goHome", "darwin"), "⌘1");
  assert.equal(shortcutHint("newChat", "darwin"), "⌘⇧N");
  assert.equal(shortcutHint("newChat", "linux"), "Ctrl+Shift+N");
  assert.equal(shortcutHint("toggleSidebar", "win32"), "Ctrl+\\");
});

test("an open Radix dialog is detected from the DOM", async () => {
  const { isDialogOpen } = await load();
  assert.equal(isDialogOpen({ querySelector: () => ({}) }), true);
  assert.equal(isDialogOpen({ querySelector: () => null }), false);
  assert.equal(isDialogOpen(null), false);
});
