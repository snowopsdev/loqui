const assert = require("node:assert/strict");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const load = () => import("../../src/components/controlPanelNav.ts");

test("Home, Notes, Chat lead with their shortcuts; Voice holds the rest; Upload left the sidebar", async () => {
  const { useControlPanelNavItems } = await load();
  let items;
  renderStatic(() => {
    items = useControlPanelNavItems();
    return null;
  }, null);
  assert.deepEqual(
    items.map((item) => [item.id, item.section, item.shortcut ?? null]),
    [
      ["home", "primary", "goHome"],
      ["personal-notes", "primary", "goNotes"],
      ["chat", "primary", "goChat"],
      ["dictionary", "voice", null],
      ["insights", "voice", null],
      ["integrations", "voice", null],
    ]
  );
  assert.equal(items.find((item) => item.id === "integrations").label, "sidebar.calendars");
});

test("every view, including Upload, still has a title", async () => {
  const { viewTitleKey } = await load();
  assert.equal(viewTitleKey("upload"), "sidebar.upload");
  assert.equal(viewTitleKey("integrations"), "sidebar.calendars");
});
