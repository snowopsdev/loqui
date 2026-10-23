const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/ui/escapeClaim.ts");

const doc = ({ capturing = false, active = null } = {}) => ({
  querySelector: (selector) => (selector === "[data-capturing]" && capturing ? {} : null),
  activeElement: active,
});
const inside = (claimed) => ({
  closest: (selector) => (claimed && selector === '[data-escape-active="true"]' ? {} : null),
});

// baseline guard: the hotkey-capture rule that SidebarModal already had (SidebarModal.tsx:123-125).
test("Escape stays with an active hotkey capture", async () => {
  const { dialogEscapeClaimed } = await load();
  assert.equal(dialogEscapeClaimed(doc({ capturing: true })), true);
  assert.equal(dialogEscapeClaimed(doc()), false);
});

// change-driving: the escape-claim rule does not exist yet.
test("Escape stays with a widget that claims it while focus is inside that widget", async () => {
  const { dialogEscapeClaimed, ESCAPE_CLAIM_SELECTOR } = await load();
  assert.equal(ESCAPE_CLAIM_SELECTOR, '[data-escape-active="true"]');
  assert.equal(dialogEscapeClaimed(doc({ active: inside(true) })), true);
  assert.equal(
    dialogEscapeClaimed(doc({ active: inside(false) })),
    false,
    "an unclaimed widget lets the dialog close"
  );
  assert.equal(dialogEscapeClaimed(doc({ active: null })), false, "no focused element");
  assert.equal(
    dialogEscapeClaimed(doc({ active: {} })),
    false,
    "a node without closest() never claims"
  );
});
