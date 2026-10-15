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

const LIGHT_TEXT_PAIRS = [
  ["--color-foreground", "--color-background"],
  ["--color-muted-foreground", "--color-background"],
  ["--color-link", "--color-background"],
  ["--color-cta-foreground", "--color-cta"],
  ["--color-live-foreground", "--color-live"],
  ["--color-locality-device", "--color-background"],
  ["--color-locality-network", "--color-background"],
  ["--color-locality-remote", "--color-background"],
  ["--color-locality-device", "--color-surface-window"],
  ["--color-locality-network", "--color-surface-window"],
  ["--color-locality-remote", "--color-surface-window"],
];

test("light theme text roles meet 4.5:1", async () => {
  const { contrastRatio } = await loadContrast();
  const { light } = resolveTokens(css);
  for (const [fg, bg] of LIGHT_TEXT_PAIRS) {
    const ratio = contrastRatio(light[fg], light[bg]);
    assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio}:1`);
  }
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
});

test("sidebar active marker uses the nav-marker role", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "src/components/ControlPanelSidebar.tsx"),
    "utf8"
  );
  assert.match(source, /bg-nav-marker/);
  assert.doesNotMatch(source, /w-0\.5 rounded-full bg-primary/);
});
