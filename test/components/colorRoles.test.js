const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const repoRoot = path.join(__dirname, "../..");
const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
const loadContrast = () => import("../../src/utils/contrast.ts");
const loadButton = () => import("../../src/components/ui/button.tsx");

const SURFACE_TOKENS = [
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

const TEXT_ROLES = [
  "--color-foreground",
  "--color-muted-foreground",
  "--color-link",
  "--color-link-hover",
  "--color-locality-device",
  "--color-locality-network",
  "--color-locality-remote",
];

test("light text roles meet 4.5:1 on every supported light surface", async () => {
  const { contrastRatio } = await loadContrast();
  const { light } = resolveTokens(css);
  for (const fg of TEXT_ROLES)
    for (const bg of SURFACE_TOKENS) {
      const ratio = contrastRatio(light[fg], light[bg]);
      assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio}:1`);
    }
  for (const [fg, bg] of [
    ["--color-cta-foreground", "--color-cta"],
    ["--color-live-foreground", "--color-live"],
  ]) {
    const ratio = contrastRatio(light[fg], light[bg]);
    assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio}:1`);
  }
});

test("the focus ring clears 3:1 on every surface in both themes", async () => {
  const { contrastRatio } = await loadContrast();
  const { light, dark } = resolveTokens(css);
  for (const [theme, tokens] of [
    ["light", light],
    ["dark", dark],
  ])
    for (const surface of SURFACE_TOKENS) {
      const ratio = contrastRatio(tokens["--color-ring"], tokens[surface]);
      assert.ok(ratio >= 3, `${theme} ring on ${surface} is ${ratio}:1`);
    }
});

test("the onboarding canvas does not swap in a lower-contrast focus ring", () => {
  const canvas = css.match(/\n\.onboarding-canvas \{([^}]*)\}/)[1];
  assert.doesNotMatch(canvas, /--color-ring:/);
});

test("focus indicators on shared controls are fully opaque", () => {
  for (const file of [
    "src/components/ui/button.tsx",
    "src/components/ControlPanelSidebar.tsx",
    "src/components/ui/HotkeyInput.tsx",
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    assert.doesNotMatch(source, /ring-(ring|primary)\/\d+/, `${file} has a translucent ring`);
  }
});

test("every HotkeyInput variant draws an opaque ring on focus and while capturing", async () => {
  const { HotkeyInput } = await import("../../src/components/ui/HotkeyInput.tsx");
  for (const variant of ["default", "hero", "capture-overlay"]) {
    const html = renderStatic(HotkeyInput, { value: "", onChange() {}, variant });
    assert.match(html, /focus-visible:ring-2 focus-visible:ring-ring(?![\w/-])/, variant);
  }
  const source = fs.readFileSync(path.join(repoRoot, "src/components/ui/HotkeyInput.tsx"), "utf8");
  assert.equal(source.match(/ring-2 ring-ring(?![\w/-])/g)?.length, 2, "capturing ring is opaque");
});

test("live role is orange with ink text, and the CTA is not orange", () => {
  const { light } = resolveTokens(css);
  assert.equal(light["--color-live"].toLowerCase(), "#ff5a1f");
  assert.equal(light["--color-live-foreground"].toLowerCase(), "#171717");
  assert.notEqual(light["--color-cta"].toLowerCase(), "#ff5a1f");
});

test("light nav marker clears 3:1 on the sidebar surface", async () => {
  const { contrastRatio } = await loadContrast();
  const { light } = resolveTokens(css);
  const ratio = contrastRatio(light["--color-nav-marker"], light["--color-surface-window"]);
  assert.ok(ratio >= 3, `nav marker is ${ratio}:1`);
});

test("the brand glass surface never pairs white text with orange", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "src/components/ui/gradientCircle.ts"),
    "utf8"
  );
  const surface = source.match(/BRAND_GLASS_SURFACE =\s*"([^"]+)"/)[1];
  assert.doesNotMatch(surface, /text-white/);
  assert.match(surface, /text-live-foreground/);
});

test("default button is the ink CTA with a leading brand dot; live is orange", async () => {
  const { Button } = await loadButton();
  const cta = renderStatic(Button, null, "Set up dictation");
  assert.match(cta, /data-variant="default"/);
  assert.match(cta, /bg-cta/);
  assert.match(cta, /text-cta-foreground/);
  assert.match(cta, /before:bg-live/);
  assert.doesNotMatch(cta, /gradient-brand-glass/);

  const live = renderStatic(Button, { variant: "live" }, "Start recording");
  assert.match(live, /data-variant="live"/);
  assert.match(live, /gradient-brand-glass/);
  assert.match(live, /text-live-foreground/);

  const icon = renderStatic(Button, { size: "icon", "aria-label": "Close" });
  assert.match(icon, /before:hidden/);

  const link = renderStatic(Button, { variant: "link" }, "Privacy & Data");
  assert.match(link, /text-link/);
  assert.doesNotMatch(link, /text-primary/);
  // Hover darkens a link; opacity would wash it below 4.5:1.
  assert.match(link, /hover:text-link-hover/);
  assert.doesNotMatch(link, /text-link\//);
});

// A CSS filter (or opacity) on the button recolours its box-shadow focus ring.
// For every variant, a hover/press rule that changes the filter must either be
// neutralised while focus-visible, or leave the ring at 3:1 on every surface.
test("the focus ring keeps 3:1 when a focused Button is hovered or pressed", async () => {
  const { Button } = await loadButton();
  const { contrastRatio } = await loadContrast();
  const { light, dark } = resolveTokens(css);
  const variants = [
    "default",
    "live",
    "success",
    "destructive",
    "outline",
    "outline-flat",
    "secondary",
    "ghost",
    "link",
    "social",
  ];
  const scaleHex = (hex, factor) =>
    "#" +
    [1, 3, 5]
      .map((i) => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * factor)))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
  for (const variant of variants) {
    const html = renderStatic(Button, { variant }, "Label");
    const classes = html.match(/class="([^"]*)"/)[1].split(/\s+/);
    assert.ok(classes.includes("focus-visible:ring-ring"), `${variant} has an opaque focus ring`);
    for (const state of ["hover", "active"]) {
      const rules = classes.filter(
        (c) =>
          c.startsWith(`${state}:`) &&
          /^(brightness|contrast|saturate|hue-rotate|invert|sepia|grayscale|opacity|filter|drop-shadow)/.test(
            c.slice(state.length + 1)
          )
      );
      for (const rule of rules) {
        const neutral = classes.some(
          (c) => c.startsWith(`focus-visible:${state}:`) && /-100$/.test(c)
        );
        const brightness = rule.match(/brightness-(\d+)$/);
        for (const [theme, tokens] of [
          ["light", light],
          ["dark", dark],
        ])
          for (const surface of SURFACE_TOKENS) {
            if (neutral) continue;
            assert.ok(
              brightness,
              `${variant} ${rule} alters the focus ring and is not neutralised while focused`
            );
            const ring = scaleHex(tokens["--color-ring"], Number(brightness[1]) / 100);
            const ratio = contrastRatio(ring, tokens[surface]);
            assert.ok(
              ratio >= 3,
              `${variant} ${theme} focused+${state} ring on ${surface} is ${ratio}:1`
            );
          }
      }
    }
  }
});

test("sidebar active marker uses the nav-marker role", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "src/components/ControlPanelSidebar.tsx"),
    "utf8"
  );
  assert.match(source, /bg-nav-marker/);
  assert.doesNotMatch(source, /w-0\.5 rounded-full bg-primary/);
});
