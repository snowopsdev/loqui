const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { readTokens } = require("../helpers/harness/cssTokens");

const root = path.join(__dirname, "../..");
const design = fs.readFileSync(path.join(root, "DESIGN.md"), "utf8");
const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");

// change-driving: DESIGN.md has no "### Settings" subsection and no --motion-flash row until Step 2.

test("[change-driving] DESIGN.md Motion table documents the flash token with the shipped value", () => {
  const motion = design.slice(design.indexOf("## Motion"), design.indexOf("## Shapes"));
  const value = readTokens(css, ":root")["--motion-flash"];
  assert.equal(value, "1400ms");
  const row = motion
    .split("\n")
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .find((cells) => cells[1] === "`--motion-flash`");
  assert.ok(row, "flash token row exists independently of table padding");
  assert.equal(row[2], value);
});

test("[change-driving] DESIGN.md documents Settings: routing, planner, keys, storage, search and Escape", () => {
  assert.match(design, /^### Settings$/m);
  const settings = design.slice(
    design.indexOf("### Settings"),
    design.indexOf("## Do's and Don'ts")
  );
  for (const phrase of [
    "routeGraph.ts",
    "route planner",
    "Staged, not active",
    "names the receiving host",
    "same main-owned predicate",
    "hover:bg-background",
    "navigates",
    "data-escape-active",
    "--motion-flash",
  ]) {
    assert.ok(settings.includes(phrase), `Settings section mentions "${phrase}"`);
  }
  assert.ok(
    design
      .slice(design.indexOf("### Chips"), design.indexOf("### Cards / Containers"))
      .includes("Route chips")
  );
  assert.ok(
    design
      .slice(design.indexOf("### Cards / Containers"), design.indexOf("### Inputs"))
      .includes("Model cartridges")
  );
});

test("[baseline guard] DESIGN.md records the accepted authority, bounded Test policies and blocked seal", () => {
  for (const phrase of [
    "23 credential slots",
    "16 identities",
    "{ current, version, facts }",
    "recipientToken",
    "before",
    "12-second",
    "refuse redirects",
    "static AWS profiles",
    "service_account",
    "authorized_user",
    "normal chat/profile/ADC execution unchanged",
    "BLOCKED under D16",
    "default-false seam",
    "single renderer authority",
  ])
    assert.ok(design.includes(phrase), phrase);
});
