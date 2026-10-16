const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const css = fs.readFileSync(path.join(__dirname, "../..", "src/index.css"), "utf8");
const load = () => import("../../src/utils/contrast.ts");

// The cartridge draws on opaque fills only: a bg-card card on the content pane
// (bg-background | dark:bg-surface-1, SidebarModal.tsx:243), with bg-muted chips
// and a 2px border-ring when checked. Text must clear 4.5:1 and the selected
// border 3:1 against both the card and the pane it touches, in both themes.
const THEMES = [
  ["light", (t) => t.light, "--color-background"],
  ["dark", (t) => t.dark, "--color-surface-1"],
];

test("baseline guard: cartridge text meets 4.5:1 on the card and its chips in both themes (I13)", async () => {
  const { contrastRatio } = await load();
  const tokens = resolveTokens(css);
  for (const [theme, pick] of THEMES) {
    const t = pick(tokens);
    for (const role of [
      "--color-foreground",
      "--color-muted-foreground",
      "--color-link",
      "--color-link-hover",
      "--color-locality-device",
    ]) {
      const ratio = contrastRatio(t[role], t["--color-card"]);
      assert.ok(ratio >= 4.5, `${theme}: ${role} on card is ${ratio.toFixed(2)}:1`);
    }
    const chip = contrastRatio(t["--color-foreground"], t["--color-muted"]);
    assert.ok(chip >= 4.5, `${theme}: in-use chip text is ${chip.toFixed(2)}:1`);
  }
});

test("baseline guard: the checked card's ring border meets 3:1 against the card and the pane (I13)", async () => {
  const { contrastRatio } = await load();
  const tokens = resolveTokens(css);
  for (const [theme, pick, pane] of THEMES) {
    const t = pick(tokens);
    for (const [name, surface] of [
      ["card", t["--color-card"]],
      ["pane", t[pane]],
    ]) {
      const ratio = contrastRatio(t["--color-ring"], surface);
      assert.ok(ratio >= 3, `${theme}: ring against ${name} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test("change-driving: [source guard] the card never dims its text with opacity, and the unchecked border stays decorative", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/components/ui/ModelCartridgeGrid.tsx"),
    "utf8"
  );
  assert.doesNotMatch(source, /\bopacity-\d+\b/, "opacity would drop muted text below 4.5:1");
  assert.doesNotMatch(
    source,
    /\btext-(success|warning|primary)\b(?!\/)/,
    "low-contrast text roles"
  );
});

test("baseline guard: rendered cartridge fills and readable text meet contrast on their actual composite surfaces in both themes", async (t) => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
  const { withI18nMock } = require("../lib/i18nTestMock");
  installBrowserGlobals(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-cartridge-composites-" })
  );
  const { ModelCartridgeGrid } = await vite.ssrLoadModule("/components/ui/ModelCartridgeGrid.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ModelCartridgeGrid, {
      label: "Language model",
      selectedId: "ready",
      totalMemoryBytes: 16e9,
      models: [
        { id: "ready", name: "Ready", sizeBytes: 1.3e9, isDownloaded: true, isDownloading: false },
        {
          id: "active",
          name: "Active",
          sizeBytes: 2.7e9,
          isDownloaded: false,
          isDownloading: true,
          progress: 42,
        },
      ],
      usedBy: { ready: ["Chat"] },
      onSelect() {},
      onDownload() {},
      onDelete() {},
      onCancel() {},
    })
  );
  assert.match(html, /data-card="ready" class="[^"]*\bbg-card\b/);
  assert.match(html, /rounded-sm bg-foreground\/70/);
  assert.match(html, /role="progressbar"[^>]*\bbg-muted\b/);
  assert.match(html, /h-full bg-foreground\/70/);
  assert.match(html, /bg-muted px-1\.5 py-px font-semibold text-foreground/);
  assert.match(html, /text-xs font-medium text-locality-device/);
  const { contrastRatio, parseHexColor } = await load();
  const over = (foreground, alpha, background) => {
    const f = parseHexColor(foreground),
      b = parseHexColor(background);
    return (
      "#" +
      ["r", "g", "b"]
        .map((channel) =>
          Math.round(f[channel] * alpha + b[channel] * (1 - alpha))
            .toString(16)
            .padStart(2, "0")
        )
        .join("")
    );
  };
  const tokens = resolveTokens(css);
  for (const [theme, pick] of THEMES) {
    const t = pick(tokens);
    for (const [name, background] of [
      ["meter", t["--color-card"]],
      ["progress", t["--color-muted"]],
    ]) {
      const fill = over(t["--color-foreground"], 0.7, background);
      const ratio = contrastRatio(fill, background);
      assert.ok(
        ratio >= 3,
        `${theme}: rendered ${name} foreground/70 on ${background} is ${ratio.toFixed(2)}:1`
      );
    }
    for (const role of ["foreground", "muted-foreground", "locality-device"]) {
      const ratio = contrastRatio(t[`--color-${role}`], t["--color-card"]);
      assert.ok(
        ratio >= 4.5,
        `${theme}: rendered ${role} text on the opaque card is ${ratio.toFixed(2)}:1`
      );
    }
  }
});
