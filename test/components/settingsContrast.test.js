const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const css = fs.readFileSync(path.join(__dirname, "../..", "src/index.css"), "utf8");
const load = () => import("../../src/utils/contrast.ts");

// Settings surfaces, composited the way the shipped classes composite them.
// Plan 01's colorRoles/plumNight tests score tokens against opaque surfaces;
// Settings also draws on translucent fills, so those are blended here
// (alpha-over, per channel) before scoring.
//   content pane     bg-background | dark:bg-surface-1            (SidebarModal.tsx:243)
//   SettingsPanel    bg-card/50    | dark:bg-surface-2/50         (SettingsSection.tsx SettingsPanel)
//   hovered row      hover:bg-foreground/3 | dark:hover:bg-white/3 (InferenceModeSelector row)
//   icon tile        bg-primary/10 | dark:bg-primary/15, over the hovered row
//   outline button   bg-muted/70 hover:bg-muted | dark:bg-surface-raised/90 dark:hover:bg-surface-raised
const PLAIN = [
  "--color-popover",
  "--color-muted",
  "--color-secondary",
  "--color-surface-1",
  "--color-surface-2",
  "--color-surface-3",
];

async function surfaces(tokens, theme) {
  const { parseHexColor } = await load();
  const hex = ({ r, g, b }) =>
    "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const over = (fg, alpha, bg) => {
    const f = parseHexColor(fg);
    const b = parseHexColor(bg);
    return hex({
      r: f.r * alpha + b.r * (1 - alpha),
      g: f.g * alpha + b.g * (1 - alpha),
      b: f.b * alpha + b.b * (1 - alpha),
    });
  };
  const dark = theme === "dark";
  const pane = dark ? tokens["--color-surface-1"] : tokens["--color-background"];
  const panel = dark
    ? over(tokens["--color-surface-2"], 0.5, pane)
    : over(tokens["--color-card"], 0.5, pane);
  const hoverRow = dark
    ? over("#ffffff", 0.03, panel)
    : over(tokens["--color-foreground"], 0.03, panel);
  const tile = over(tokens["--color-primary"], dark ? 0.15 : 0.1, hoverRow);
  const outlineRest = dark
    ? over(tokens["--color-surface-raised"], 0.9, panel)
    : over(tokens["--color-muted"], 0.7, panel);
  const outlineHover = dark ? tokens["--color-surface-raised"] : tokens["--color-muted"];
  const out = { pane, panel, hoverRow, tile, outlineRest, outlineHover };
  for (const token of PLAIN) out[token.replace("--color-", "")] = tokens[token];
  return out;
}

const THEMES = [
  ["light", (t) => t.light],
  ["dark", (t) => t.dark],
];
const TEXT_ROLES = [
  "--color-foreground",
  "--color-muted-foreground",
  "--color-link",
  "--color-locality-device",
  "--color-locality-network",
  "--color-locality-remote",
];
// The icon tile only ever hosts the mode icon (foreground) and nothing else.
const TILE_TEXT_ROLES = ["--color-foreground", "--color-muted-foreground"];
const MARK_ROLES = [
  "--color-ring",
  "--color-locality-device",
  "--color-locality-network",
  "--color-locality-remote",
  "--color-destructive",
];

// Baseline guard: Settings composites keep text roles readable in both themes.
test("text roles meet 4.5:1 on every composited Settings surface in both themes", async () => {
  const { contrastRatio } = await load();
  const tokens = resolveTokens(css);
  for (const [theme, pick] of THEMES) {
    const t = pick(tokens);
    const s = await surfaces(t, theme);
    for (const [name, surface] of Object.entries(s)) {
      const roles = name === "tile" ? TILE_TEXT_ROLES : TEXT_ROLES;
      for (const role of roles) {
        const ratio = contrastRatio(t[role], surface);
        assert.ok(
          ratio >= 4.5,
          `${theme}: ${role} on ${name} (${surface}) is ${ratio.toFixed(2)}:1`
        );
      }
    }
  }
});

// Baseline guard: Settings composites keep non-text marks visible in both themes.
test("ring, locality and status marks meet 3:1 on every composited Settings surface in both themes", async () => {
  const { contrastRatio } = await load();
  const tokens = resolveTokens(css);
  for (const [theme, pick] of THEMES) {
    const t = pick(tokens);
    const s = await surfaces(t, theme);
    for (const [name, surface] of Object.entries(s))
      for (const mark of MARK_ROLES) {
        const ratio = contrastRatio(t[mark], surface);
        assert.ok(ratio >= 3, `${theme}: ${mark} on ${name} (${surface}) is ${ratio.toFixed(2)}:1`);
      }
  }
});

// I13 token CCR: the light focus ring moves from the brand orange to its
// darker sibling. Plan 01 shipped this in f7d53e4; on an older Plan 01 base
// (172f9df) the ring is #ff5a1f and these assertions fail: that colour measures
// 2.86:1 on muted, 2.94:1 on the hovered row and 2.62:1 on the selected icon tile.
// Baseline guard on this base: Plan 01 already shipped the darker light ring token.
test("the light focus ring is the darker orange and Plum Night keeps its own", () => {
  const { light, dark } = resolveTokens(css);
  assert.equal(light["--color-ring"].toLowerCase(), "#e84e16");
  assert.equal(dark["--color-ring"].toLowerCase(), "#ff5a1f");
});

// Baseline guard: document why these surfaces require the darker ring token.
test("the old brand-orange ring would fail the Settings surfaces it was replaced for", async () => {
  const { contrastRatio } = await load();
  const t = resolveTokens(css).light;
  const s = await surfaces(t, "light");
  const failing = Object.entries(s).filter(([, surface]) => contrastRatio("#ff5a1f", surface) < 3);
  assert.ok(
    failing.length >= 4,
    `expected the old ring to fail several surfaces, failed ${failing.map(([n]) => n)}`
  );
});

// Baseline guard: document the contrast limit that shapes chip styling.
test("status text roles that cannot clear 4.5:1 stay off Settings text", async () => {
  const { contrastRatio } = await load();
  const t = resolveTokens(css).light;
  const s = await surfaces(t, "light");
  // Why chips and the support-model row use foreground / locality roles for words.
  assert.ok(
    contrastRatio(t["--color-success"], s.panel) < 4.5,
    "success text is 3.30:1 on the panel"
  );
  assert.ok(
    contrastRatio(t["--color-destructive"], s.muted) < 4.5,
    "destructive text is 4.43:1 on muted"
  );
  assert.ok(
    contrastRatio(t["--color-destructive"], s.tile) < 4.5,
    "destructive text is 4.06:1 on the selected tile"
  );
});
