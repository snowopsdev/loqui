const assert = require("node:assert/strict");
const test = require("node:test");

// change-driving: src/components/settings/settingsSearchKeys.ts does not exist yet, so every test fails on import.
const keys = () => import("../../src/components/settings/settingsSearchKeys.ts");
const claim = () => import("../../src/components/ui/escapeClaim.ts");
const key = (k, extra = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});
const idle = { typing: false, capturing: false };

test("[change-driving] Cmd+F and Ctrl+F focus search, even from a field", async () => {
  const { isSearchShortcut } = await keys();
  assert.equal(isSearchShortcut(key("f", { metaKey: true }), idle), true);
  assert.equal(
    isSearchShortcut(key("F", { ctrlKey: true }), { typing: true, capturing: false }),
    true
  );
  assert.equal(isSearchShortcut(key("f"), idle), false, "a bare f is not a shortcut");
  assert.equal(isSearchShortcut(key("f", { ctrlKey: true, shiftKey: true }), idle), false);
});

test("[change-driving] / focuses search only when the user is not typing", async () => {
  const { isSearchShortcut } = await keys();
  assert.equal(isSearchShortcut(key("/"), idle), true);
  assert.equal(isSearchShortcut(key("/"), { typing: true, capturing: false }), false);
  assert.equal(isSearchShortcut(key("/", { metaKey: true }), idle), false);
});

test("[change-driving] nothing is stolen while a hotkey is being captured", async () => {
  const { isSearchShortcut } = await keys();
  assert.equal(
    isSearchShortcut(key("f", { metaKey: true }), { typing: false, capturing: true }),
    false
  );
  assert.equal(isSearchShortcut(key("/"), { typing: false, capturing: true }), false);
});

test("[change-driving] typing targets include inputs, selects, editable text and combobox triggers", async () => {
  const { isTypingTarget } = await keys();
  const matching = new Set([
    "input",
    "textarea",
    "select",
    "[contenteditable='true']",
    "[role='combobox']",
  ]);
  const el = {
    closest: (selector) => (selector.split(",").some((s) => matching.has(s.trim())) ? {} : null),
  };
  assert.equal(isTypingTarget(el), true);
  assert.equal(isTypingTarget({ closest: () => null }), false);
  assert.equal(isTypingTarget(null), false);
});

test("[change-driving] arrow keys step the active row and clamp at both ends", async () => {
  const { stepActiveIndex } = await keys();
  assert.equal(stepActiveIndex(0, 3, "ArrowDown"), 1);
  assert.equal(stepActiveIndex(2, 3, "ArrowDown"), 2);
  assert.equal(stepActiveIndex(0, 3, "ArrowUp"), 0);
  assert.equal(stepActiveIndex(2, 3, "ArrowUp"), 1);
  assert.equal(stepActiveIndex(5, 3, "x"), 2, "an out-of-range index is clamped");
  assert.equal(stepActiveIndex(0, 0, "ArrowDown"), 0);
  assert.equal(
    stepActiveIndex(5, 3, "ArrowUp"),
    1,
    "clamp before stepping after the match count shrinks"
  );
});

test("[baseline guard] Task 10's escape claim covers a focused search field and a focused result", async () => {
  const { dialogEscapeClaimed } = await claim();
  const doc = (activeClaimed) => ({
    querySelector: () => null,
    activeElement: {
      closest: (selector) =>
        activeClaimed && selector === '[data-escape-active="true"]' ? {} : null,
    },
  });
  assert.equal(
    dialogEscapeClaimed(doc(true)),
    true,
    "focus inside a claiming widget keeps the dialog open"
  );
  assert.equal(dialogEscapeClaimed(doc(false)), false, "with no query the dialog closes");
});
