const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const css = fs.readFileSync(path.join(__dirname, "../..", "src/index.css"), "utf8");
const load = () => import("../../src/utils/contrast.ts");

test("light status fills carry text that clears 4.5:1", async () => {
  const { contrastRatio } = await load();
  const { light } = resolveTokens(css);
  for (const role of ["accent", "destructive", "success", "warning", "info"]) {
    const ratio = contrastRatio(light[`--color-${role}-foreground`], light[`--color-${role}`]);
    assert.ok(ratio >= 4.5, `${role}-foreground on ${role} is ${ratio}:1`);
  }
});

test("warning and success put ink on the fill, as Plum Night puts dark text on its fills", () => {
  const { light } = resolveTokens(css);
  assert.equal(light["--color-warning-foreground"], "#171717");
  assert.equal(light["--color-success-foreground"], "#171717");
});
