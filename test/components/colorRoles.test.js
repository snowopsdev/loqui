const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic: renderComponent, React } = require("../helpers/harness/reactSsr");
const { createInstance } = require("i18next");
const { I18nextProvider } = require("react-i18next");
const i18n = createInstance();
i18n.init({
  lng: "en",
  initImmediate: false,
  resources: { en: { translation: require("../../src/locales/en/translation.json") } },
});
const renderStatic = (Component, props, children) =>
  renderComponent(I18nextProvider, { i18n }, React.createElement(Component, props, children));
const { readTokens, resolveTokens } = require("../helpers/harness/cssTokens");

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

const BUTTON_VARIANTS = [
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
const buttonClasses = async (variant, props = {}) => {
  const { Button } = await loadButton();
  const html = renderStatic(Button, { variant, ...props }, "Label");
  return html.match(/class="([^"]*)"/)[1].split(/\s+/);
};

const FILTER_LIKE =
  /^(brightness|contrast|saturate|hue-rotate|invert|sepia|grayscale|blur|opacity|filter|drop-shadow)(-|$)|^\[(filter|opacity):/;
const INTERACTIVE = /^(hover|active|focus|focus-visible|focus-within|group-hover|peer-.*)$/;

function splitVariants(cls) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of cls) {
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    if (ch === ":" && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}

function ringRecolouringClasses(classes) {
  return classes.filter((cls) => {
    const parts = splitVariants(cls);
    const utility = parts[parts.length - 1];
    return FILTER_LIKE.test(utility) && parts.slice(0, -1).some((p) => INTERACTIVE.test(p));
  });
}

// The focus ring is a box-shadow on the button, so any filter or opacity that
// changes on hover, press or focus recolours it. Feedback must come from fills,
// borders, text or shadows instead. Checked by property, not by class suffix.
test("no Button variant changes filter or opacity on hover, press or focus", async () => {
  for (const variant of BUTTON_VARIANTS) {
    const classes = await buttonClasses(variant);
    assert.ok(classes.includes("focus-visible:ring-ring"), `${variant} has an opaque focus ring`);
    assert.deepEqual(
      ringRecolouringClasses(classes),
      [],
      `${variant} recolours the focus ring on hover, press or focus`
    );
  }
});

test("the filter/opacity guard catches arbitrary-property mutations", () => {
  const mutated = [
    "hover:[opacity:0.5]",
    "hover:[filter:brightness(1.1)]",
    "active:brightness-95",
    "[opacity:0.5]",
    "hover:bg-cta-hover",
    "[&_svg]:size-4",
    "focus-visible:ring-ring",
  ];
  assert.deepEqual(ringRecolouringClasses(mutated), [
    "hover:[opacity:0.5]",
    "hover:[filter:brightness(1.1)]",
    "active:brightness-95",
  ]);
});

test("a focused default or live Button still has distinct hover and pressed fills", async () => {
  const cta = await buttonClasses("default");
  for (const c of ["bg-cta", "hover:bg-cta-hover", "active:bg-cta-active"])
    assert.ok(cta.includes(c), `default has ${c}`);
  assert.ok(
    !cta.some((c) => c.startsWith("focus-visible:hover:") || c.startsWith("focus-visible:active:"))
  );
  const live = await buttonClasses("live");
  for (const c of [
    "hover:bg-[image:var(--gradient-brand-glass-hover)]",
    "active:bg-[image:var(--gradient-brand-glass-active)]",
  ])
    assert.ok(live.includes(c), `live has ${c}`);
  assert.ok(
    !live.some((c) => c.startsWith("focus-visible:hover:") || c.startsWith("focus-visible:active:"))
  );
});

test("hover and pressed fills keep text at 4.5:1 and never put white on orange", async () => {
  const { contrastRatio } = await loadContrast();
  const { light, dark } = resolveTokens(css);
  const root = readTokens(css, ":root");
  for (const [theme, tokens] of [
    ["light", light],
    ["dark", dark],
  ])
    for (const state of ["hover", "active"]) {
      const ratio = contrastRatio(tokens["--color-cta-foreground"], tokens[`--color-cta-${state}`]);
      assert.ok(ratio >= 4.5, `${theme} cta ${state} is ${ratio}:1`);
      assert.notEqual(
        tokens[`--color-cta-${state}`].toLowerCase(),
        tokens["--color-cta"].toLowerCase()
      );
    }
  for (const state of ["hover", "active"]) {
    const stops = root[`--gradient-brand-glass-${state}`].match(/#[0-9a-f]{6}/gi);
    assert.equal(stops.length, 2, `${state} gradient has two stops`);
    for (const stop of stops) {
      const ratio = contrastRatio(light["--color-live-foreground"], stop);
      assert.ok(ratio >= 4.5, `live ${state} ${stop} is ${ratio}:1`);
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
