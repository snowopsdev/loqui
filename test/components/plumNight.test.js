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

test("Plum Night text roles meet 4.5:1 on every Plum Night surface", async () => {
  const { contrastRatio } = await load();
  const { dark } = resolveTokens(css);
  const texts = [
    "--color-foreground",
    "--color-muted-foreground",
    "--color-link",
    "--color-link-hover",
    "--color-locality-device",
    "--color-locality-network",
    "--color-locality-remote",
  ];
  const surfaces = [
    "--color-background",
    "--color-card",
    "--color-popover",
    "--color-secondary",
    "--color-muted",
    "--color-input",
    "--color-surface-0",
    "--color-surface-1",
    "--color-surface-2",
    "--color-surface-3",
    "--color-surface-raised",
    "--color-surface-window",
  ];
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

test("Plum Night status fills and status text meet 4.5:1", async () => {
  const { contrastRatio } = await load();
  const { dark } = resolveTokens(css);
  for (const role of ["accent", "destructive", "success", "warning", "info"]) {
    const ratio = contrastRatio(dark[`--color-${role}-foreground`], dark[`--color-${role}`]);
    assert.ok(ratio >= 4.5, `${role}-foreground on ${role} is ${ratio}:1`);
  }
  for (const role of ["destructive", "success", "warning", "info"])
    for (const surface of ["--color-background", "--color-surface-raised"]) {
      const ratio = contrastRatio(dark[`--color-${role}`], dark[surface]);
      assert.ok(ratio >= 4.5, `${role} text on ${surface} is ${ratio}:1`);
    }
});
