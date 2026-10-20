const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/sidebarMode.ts");
const pref = (over = {}) => ({ userCollapsed: false, narrowExpanded: false, ...over });

test("wide windows show the full sidebar unless the user collapsed it", async () => {
  const { resolveSidebarMode } = await load();
  assert.equal(
    resolveSidebarMode({ ...pref(), windowWidth: 1280, sidePanelLayout: false }),
    "expanded"
  );
  assert.equal(
    resolveSidebarMode({
      ...pref({ userCollapsed: true }),
      windowWidth: 1280,
      sidePanelLayout: false,
    }),
    "rail"
  );
});

test("below 1100px the sidebar becomes a rail until the user expands it", async () => {
  const { resolveSidebarMode } = await load();
  assert.equal(
    resolveSidebarMode({ ...pref(), windowWidth: 1099, sidePanelLayout: false }),
    "rail"
  );
  assert.equal(
    resolveSidebarMode({
      ...pref({ narrowExpanded: true }),
      windowWidth: 900,
      sidePanelLayout: false,
    }),
    "expanded"
  );
});

test("meeting mode and narrow open notes hide it completely", async () => {
  const { resolveSidebarMode, sidebarWidth } = await load();
  const mode = resolveSidebarMode({ ...pref(), windowWidth: 1600, sidePanelLayout: true });
  assert.equal(mode, "hidden");
  assert.equal(sidebarWidth(mode), 0);
  assert.equal(sidebarWidth("rail"), 56);
  assert.equal(sidebarWidth("expanded"), 232);
});

test("the toggle always flips what you see", async () => {
  const { resolveSidebarMode, nextSidebarPreference } = await load();
  for (const windowWidth of [900, 1280]) {
    for (const start of [pref(), pref({ userCollapsed: true }), pref({ narrowExpanded: true })]) {
      const before = resolveSidebarMode({ ...start, windowWidth, sidePanelLayout: false });
      const after = resolveSidebarMode({
        ...nextSidebarPreference({ ...start, windowWidth }),
        windowWidth,
        sidePanelLayout: false,
      });
      assert.notEqual(after, before, `${windowWidth} ${JSON.stringify(start)}`);
    }
  }
});
