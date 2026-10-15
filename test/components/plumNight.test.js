const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const css = fs.readFileSync(path.join(__dirname, "../..", "src/index.css"), "utf8");
const load = () => import("../../src/utils/contrast.ts");

const SURFACES = {
  "--color-background": "#1c1218",
  "--color-card": "#271820",
  "--color-popover": "#2b1b24",
  "--color-secondary": "#2a1922",
  "--color-muted": "#22161c",
  "--color-input": "#170e13",
  "--color-surface-0": "#1c1218",
  "--color-surface-1": "#21151b",
  "--color-surface-2": "#271820",
  "--color-surface-3": "#2d1c25",
  "--color-surface-raised": "#33202b",
  "--color-surface-window": "#160d12",
  "--color-border": "#3d2733",
  "--color-border-subtle": "#36222d",
  "--color-border-hover": "#4a3040",
};

test("Plum Night surfaces use the approved ramp", () => {
  const { dark } = resolveTokens(css);
  for (const [token, value] of Object.entries(SURFACES)) assert.equal(dark[token], value, token);
});

test("Plum Night text roles meet 4.5:1 on every surface they sit on", async () => {
  const { contrastRatio } = await load();
  const { dark } = resolveTokens(css);
  const texts = ["--color-foreground", "--color-muted-foreground", "--color-link", "--color-locality-device", "--color-locality-network", "--color-locality-remote"];
  const surfaces = ["--color-background", "--color-card", "--color-surface-raised", "--color-surface-window"];
  for (const t of texts)
    for (const s of surfaces) {
      const ratio = contrastRatio(dark[t], dark[s]);
      assert.ok(ratio >= 4.5, `${t} on ${s} is ${ratio}:1`);
    }
  assert.ok(contrastRatio(dark["--color-cta-foreground"], dark["--color-cta"]) >= 4.5);
  assert.ok(contrastRatio(dark["--color-live-foreground"], dark["--color-live"]) >= 4.5);
});

test("magenta marks active navigation in Plum Night and clears 3:1", async () => {
  const { contrastRatio } = await load();
  const { dark } = resolveTokens(css);
  assert.equal(dark["--color-nav-marker"], "#e6007a");
  assert.ok(contrastRatio(dark["--color-nav-marker"], dark["--color-surface-window"]) >= 3);
});
