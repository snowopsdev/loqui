const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const src = fs.readFileSync(path.join(__dirname, "../../src/components/InsightsView.tsx"), "utf8");
test("heatmap cells size from the container, within 10–18px (WS-Q11)", () => {
  assert.match(src, /@container/);
  assert.ok(
    src.includes("clamp(10px, calc((100cqi - 3rem - ${weeks - 1} * 2px) / ${weeks}), 18px)")
  );
  assert.match(src, /size-\(--cell\)/);
  assert.match(src, /data-cellsize/);
  assert.doesNotMatch(src, /size-6|1\.5rem\)/);
});
test("the stat grid follows content width, not viewport", () => {
  assert.match(src, /grid-cols-2 gap-3 @min-\[720px\]:grid-cols-4/);
  assert.doesNotMatch(src, /lg:grid-cols-4/);
});
test("chart metadata stays readable, activity neutral, focus opaque", () => {
  assert.doesNotMatch(src, /text-\[10px\]|muted-foreground\/70|bg-primary|ring-primary/);
  assert.match(src, /focus-visible:ring-2 focus-visible:ring-ring/);
  assert.match(src, /role="img"/);
  assert.match(src, /role="group"/);
});
