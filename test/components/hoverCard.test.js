const assert = require("node:assert/strict");
const test = require("node:test");

const React = require("react");
const { createRoot } = require("react-dom/client");
const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");

const load = () => import("../../src/components/ui/useHoverCard.ts");
const closed = { open: false, closing: false, dismissed: false };

test("moving from the chip across the gap into the card keeps it open (I08)", async () => {
  const { hoverCardReducer: r } = await load();
  let s = r(closed, { type: "pointerEnter" });
  s = r(s, { type: "pointerLeave" }); // leaves the chip
  assert.deepEqual(s, { open: true, closing: true, dismissed: false });
  s = r(s, { type: "pointerEnter" }); // reaches the card before the timer
  assert.deepEqual(s, { open: true, closing: false, dismissed: false });
  assert.deepEqual(
    r(s, { type: "closeTimer" }),
    { open: true, closing: false, dismissed: false },
    "a stale timer is ignored"
  );
});

test("leaving both closes after the delay", async () => {
  const { hoverCardReducer: r } = await load();
  const s = r(r(closed, { type: "pointerEnter" }), { type: "pointerLeave" });
  assert.deepEqual(r(s, { type: "closeTimer" }), closed);
});

test("tabbing from the chip into Open and Insert quote keeps it open; tabbing out closes", async () => {
  const { hoverCardReducer: r } = await load();
  let s = r(closed, { type: "focusIn" });
  s = r(s, { type: "focusOut", staysInside: true }); // chip → Open
  assert.equal(s.open, true);
  s = r(s, { type: "focusOut", staysInside: true }); // Open → Insert quote
  assert.equal(s.open, true);
  assert.deepEqual(r(s, { type: "focusOut", staysInside: false }), closed);
});

test("Escape closes, and the focus it returns to the chip does not reopen the card (I08-R2)", async () => {
  const { hoverCardReducer: r } = await load();
  let s = r({ open: true, closing: false, dismissed: false }, { type: "escape" });
  assert.equal(s.open, false);
  s = r(s, { type: "focusIn" }); // the chip.focus() Escape itself causes
  assert.equal(s.open, false, "restoring focus is not a new entry");
  // A genuine re-entry after leaving opens it again, by keyboard or pointer.
  assert.equal(r(r(s, { type: "focusOut", staysInside: false }), { type: "focusIn" }).open, true);
  assert.equal(r(r(s, { type: "pointerLeave" }), { type: "pointerEnter" }).open, true);
});

test("the real hook: Escape from Open focuses the chip and leaves the card closed; Tab out and back reopens it (I08-R2)", async (t) => {
  const { useHoverCard } = await load();
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  let api = null;
  const focused = [];
  // Like a real focus event, the chip's focus() bubbles to the boundary's onFocus.
  const chip = {
    focus() {
      focused.push("chip");
      api.boundary.onFocus();
    },
  };
  const triggerRef = { current: chip };
  function Probe() {
    api = useHoverCard(triggerRef);
    return null;
  }
  const act = (fn) => React.act(async () => fn());
  root = createRoot(globalThis.document.documentElement);
  await act(() => root.render(React.createElement(Probe)));
  const within = { contains: () => true };
  const outside = { contains: () => false };
  await act(() => api.boundary.onFocus()); // Tab reaches the chip
  await act(() => api.boundary.onBlur({ relatedTarget: {}, currentTarget: within })); // chip → Open
  await act(() => api.boundary.onFocus());
  assert.equal(api.open, true, "open while focus is on Open");
  await act(() => api.boundary.onKeyDown({ key: "Escape", stopPropagation() {} }));
  assert.deepEqual(focused, ["chip"], "focus returned to the chip");
  assert.equal(api.open, false, "and the card is closed");
  await act(() => api.boundary.onBlur({ relatedTarget: {}, currentTarget: outside })); // Tab away
  await act(() => api.boundary.onFocus()); // Shift+Tab back
  assert.equal(api.open, true, "a genuine re-entry opens it");
});

test("the chip and its card share one boundary, and the card is editor chrome", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../src/components/ui/MentionChip.tsx"),
    "utf8"
  );
  assert.match(src, /useHoverCard\(chipRef\)/);
  assert.match(src, /<span\s+\{\.\.\.boundary\}/);
  assert.match(src, /data-editor-chrome=""/);
  assert.doesNotMatch(src, /onBlur=\{\(\) => setOpen\(false\)\}/);
});

test("real hook keeps the card while either pointer or keyboard focus owns the boundary, and cancels close timers", async (t) => {
  const { useHoverCard } = await load();
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window: { setTimeout, clearTimeout } });
  installHookDom(t);
  let api;
  root = createRoot(globalThis.document.documentElement);
  function Probe() {
    api = useHoverCard({ current: null });
    return null;
  }
  const act = (fn) => React.act(async () => fn());
  await act(() => root.render(React.createElement(Probe)));
  await act(() => api.boundary.onMouseEnter());
  await act(() => api.boundary.onFocus());
  await act(() => api.boundary.onMouseLeave());
  await act(() => new Promise((resolve) => setTimeout(resolve, 170)));
  assert.equal(api.open, true, "pointer leaving must not close a keyboard-owned card");
  await act(() => api.boundary.onMouseEnter());
  await act(() =>
    api.boundary.onBlur({ relatedTarget: null, currentTarget: { contains: () => false } })
  );
  assert.equal(api.open, true, "focus leaving must not close a pointer-owned card");
  await act(() => api.boundary.onMouseLeave());
  await act(() => api.boundary.onMouseEnter());
  await act(() => new Promise((resolve) => setTimeout(resolve, 170)));
  assert.equal(api.open, true, "re-entry cancels delayed close");
});
