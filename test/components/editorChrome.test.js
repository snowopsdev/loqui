const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const load = () => import("../../src/components/ui/editor/editorChrome.ts");
const el = (inChrome) => ({
  closest: (sel) => (sel === "[data-editor-chrome]" && inChrome ? {} : null),
});

test("clicks inside the bubble toolbar, its URL field or a popup never refocus the document (I07)", async () => {
  const { isEditorChromeTarget } = await load();
  assert.equal(isEditorChromeTarget(el(true)), true);
  assert.equal(isEditorChromeTarget(el(false)), false);
  assert.equal(isEditorChromeTarget(null), false);
  assert.equal(isEditorChromeTarget({}), false, "non-element targets are not chrome");
});

test("the editor wrapper and every chrome surface use the marker", () => {
  const root = path.join(__dirname, "../..");
  const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
  assert.match(
    read("src/components/ui/RichTextEditor.tsx"),
    /if \(isEditorChromeTarget\(event\.target\)\) return;/
  );
  assert.match(read("src/components/ui/editor/BubbleToolbar.tsx"), /data-editor-chrome=""/);
  assert.match(
    read("src/components/ui/editor/suggestionPopup.ts"),
    /setAttribute\("data-editor-chrome", ""\)/
  );
});
