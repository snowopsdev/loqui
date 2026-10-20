const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { scanFiles, scanText } = require("../helpers/workspaceTokenGuard");
const TABLE_FILES = [
  "src/components/settings/LabsSettings.tsx",
  "src/components/table/TableCanvas.tsx",
  "src/components/table/TableCard.tsx",
  "src/components/table/TableInbox.tsx",
  "src/components/table/TableSelectionBar.tsx",
  "src/components/table/TableView.tsx",
  "src/components/table/TableDictationDetail.tsx",
];
test("The Table components pass the unmodified workspace token guard", () => {
  for (const file of TABLE_FILES) assert.ok(fs.existsSync(file), file);
  assert.deepEqual(scanFiles(TABLE_FILES), []);
});
test("the List | Table switch passes the workspace token guard", () => {
  const file = "src/components/notes/overview/ContainerOverview.tsx";
  const src = fs.readFileSync(path.join(__dirname, "../..", file), "utf8");
  const start = src.indexOf("export function TableViewSwitch");
  assert.ok(start > -1, "TableViewSwitch exists");
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, "complete switch function is scanned");
  assert.deepEqual(scanText(file, src.slice(start, end + 2)), []);
});
