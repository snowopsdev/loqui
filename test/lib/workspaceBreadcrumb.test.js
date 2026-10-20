const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/workspaceBreadcrumb.ts");

test("Notes shows folder and note", async () => {
  const { buildWorkspaceBreadcrumb } = await load();
  assert.deepEqual(
    buildWorkspaceBreadcrumb({
      view: "personal-notes",
      viewLabel: "Notes",
      folderName: "Work",
      noteTitle: "Product catch-up",
    }),
    ["Notes", "Work", "Product catch-up"]
  );
  assert.deepEqual(
    buildWorkspaceBreadcrumb({
      view: "personal-notes",
      viewLabel: "Notes",
      folderName: "  ",
      noteTitle: null,
    }),
    ["Notes"]
  );
});

test("other views are a single crumb", async () => {
  const { buildWorkspaceBreadcrumb } = await load();
  assert.deepEqual(
    buildWorkspaceBreadcrumb({
      view: "chat",
      viewLabel: "Chat",
      folderName: "Work",
      noteTitle: "x",
    }),
    ["Chat"]
  );
});
