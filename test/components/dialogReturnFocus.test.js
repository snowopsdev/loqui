const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// Full-app M3: Settings and Ctrl+K search have no Radix Dialog.Trigger, so
// Radix returned focus to <body> on close. Nodes are plain stubs compared by
// identity, never handed to node:assert for deep inspection.
const load = () => import("../../src/components/ui/dialogReturnFocus.ts");
const node = (name, parent = null) => ({
  name,
  parentNode: parent,
  isConnected: true,
  focused: 0,
  focus() {
    this.focused++;
    doc.activeElement = this;
  },
  contains(other) {
    for (let current = other; current; current = current.parentNode)
      if (current === this) return true;
    return false;
  },
});
const doc = { body: null, activeElement: null };
const closeEvent = (content) => {
  const event = { currentTarget: content, prevented: false };
  event.preventDefault = () => (event.prevented = true);
  return event;
};

test("closing returns focus to the control that opened the dialog", async () => {
  const { createDialogReturnFocus } = await load();
  doc.body = node("body");
  const invoker = node("Settings button");
  const content = node("dialog");
  const field = node("search field", content);
  const focus = createDialogReturnFocus(doc);
  doc.activeElement = invoker;
  focus.remember();
  doc.activeElement = field;
  const event = closeEvent(content);
  focus.restore(event);
  assert.ok(doc.activeElement === invoker, `focus returned to ${doc.activeElement?.name}`);
  assert.equal(event.prevented, true, "Radix's trigger-or-body fallback is skipped");

  // The same applies when the closing dialog already gave focus up to <body>.
  focus.remember();
  doc.activeElement = doc.body;
  focus.restore(closeEvent(content));
  assert.ok(doc.activeElement === invoker, `focus returned to ${doc.activeElement?.name}`);
});

test("an action that moved focus elsewhere keeps it; a gone invoker falls back to Radix", async () => {
  const { createDialogReturnFocus } = await load();
  doc.body = node("body");
  const invoker = node("Search button");
  const content = node("palette");
  const editor = node("opened note editor");
  const focus = createDialogReturnFocus(doc);
  doc.activeElement = invoker;
  focus.remember();
  doc.activeElement = editor;
  const moved = closeEvent(content);
  focus.restore(moved);
  assert.ok(doc.activeElement === editor, `focus stayed on ${doc.activeElement?.name}`);
  assert.equal(invoker.focused, 0);
  assert.equal(moved.prevented, true);

  doc.activeElement = invoker;
  focus.remember();
  invoker.isConnected = false;
  doc.activeElement = doc.body;
  const gone = closeEvent(content);
  focus.restore(gone);
  assert.equal(gone.prevented, false, "no remembered target: Radix keeps its default");
  assert.equal(invoker.focused, 0);

  doc.activeElement = doc.body;
  focus.remember();
  const fromBody = closeEvent(content);
  focus.restore(fromBody);
  assert.equal(fromBody.prevented, false, "a shortcut from <body> has no invoker to return to");
});

test("Settings and command search remember the invoker before focus moves in", () => {
  const read = (file) =>
    fs.readFileSync(path.join(__dirname, "../../src/components", file), "utf8");
  const settings = read("ui/SidebarModal.tsx");
  assert.match(settings, /onOpenAutoFocus=\{\(e\) => \{\s*returnFocus\.remember\(\);/);
  assert.match(settings, /onCloseAutoFocus=\{returnFocus\.restore\}/);
  const search = read("CommandSearch.tsx");
  assert.match(search, /onOpenAutoFocus=\{\(e\) => \{\s*returnFocus\.remember\(\);/);
  assert.match(search, /onCloseAutoFocus=\{returnFocus\.restore\}/);
  // React autoFocus would move focus into the palette before Radix could remember.
  assert.doesNotMatch(search, /^\s*autoFocus\s*$/m);
});
