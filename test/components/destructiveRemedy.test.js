const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const css = fs.readFileSync(path.join(__dirname, "../..", "src/index.css"), "utf8");

test("[baseline guard] destructive text on the hover:bg-background remedy meets 4.5:1 in both themes", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(css);
  for (const [name, theme] of [
    ["light", light],
    ["dark", dark],
  ]) {
    for (const surface of ["--color-background", "--color-card"]) {
      const ratio = contrastRatio(theme["--color-destructive"], theme[surface]);
      assert.ok(ratio >= 4.5, `${name}: destructive on ${surface} is ${ratio.toFixed(2)}:1`);
    }
  }
});
