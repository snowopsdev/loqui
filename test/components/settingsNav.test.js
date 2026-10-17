const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

const read = (file) => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");
function findAll(node, predicate, out = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, predicate, out));
    return out;
  }
  if (!node || typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  findAll(node.props?.children, predicate, out);
  return out;
}

test("settings nav and title bar", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-settings-nav-test-" });
  const { SettingsNav } = await vite.ssrLoadModule("/components/ui/SettingsNav.tsx");
  const { SettingsTitleBar } = await vite.ssrLoadModule("/components/ui/SettingsTitleBar.tsx");
  const Icon = () => null;
  const items = [
    {
      id: "general",
      label: "Preferences",
      description: "Appearance, sounds, startup",
      icon: Icon,
      group: "App",
    },
    {
      id: "routing",
      label: "Routing",
      description: "Where each task runs",
      icon: Icon,
      group: "AI Models",
    },
    {
      id: "system",
      label: "System",
      icon: Icon,
      group: "System",
      badge: "1",
      badgeVariant: "update",
    },
  ];
  const nav = (props) =>
    renderToStaticMarkup(
      React.createElement(SettingsNav, {
        items,
        activeSection: "routing",
        onSectionChange() {},
        isCompact: false,
        ariaLabel: "Settings",
        ...props,
      })
    );

  await t.test(
    "change-driving: descriptions are a second line whenever the sidebar is wide",
    () => {
      const html = nav();
      assert.match(html, /<span[^>]*>Where each task runs<\/span>/);
      assert.match(html, /<span[^>]*>Appearance, sounds, startup<\/span>/);
      assert.match(html, /data-section-id="routing"[^>]*aria-current="page"/);
      assert.match(html, /<span[^>]*>AI Models<\/span>/, "group labels show when wide");
    }
  );

  await t.test(
    "change-driving: the compact rail names items and keeps the description as a tooltip",
    () => {
      const html = nav({ activeSection: "general", isCompact: true });
      assert.match(html, /title="Routing — Where each task runs"/);
      assert.match(html, /aria-label="Routing"/);
      assert.doesNotMatch(html, />Where each task runs</);
      assert.doesNotMatch(html, />AI Models</, "group labels hide in the rail");
    }
  );

  await t.test("change-driving: Plan 02's nav semantics survive the extraction", () => {
    const html = nav();
    assert.match(html, /<nav aria-label="Settings"/);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1, "exactly one current item");
    const source = read("src/components/ui/SettingsNav.tsx");
    assert.match(
      source,
      /outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset/
    );
    assert.match(source, /aria-label=\{isCompact \? item\.label : undefined\}/);
  });

  await t.test("change-driving: the sticky title row hosts the close target", () => {
    const html = renderToStaticMarkup(
      React.createElement(SettingsTitleBar, {
        title: "Routing",
        close: React.createElement("button", { className: "settings-close" }, "x"),
      })
    );
    assert.match(html, /class="[^"]*\bsticky\b[^"]*\btop-0\b/);
    assert.match(html, /<h2[^>]*>Routing<\/h2>/);
    assert.match(html, /settings-close/);
    assert.match(html, /\bpx-6\b/);
    const compact = renderToStaticMarkup(
      React.createElement(SettingsTitleBar, { title: "x", close: null, compact: true })
    );
    assert.match(compact, /\bpx-4\b/);
  });

  await t.test(
    "[source guard] new files use --motion tokens and logical properties only (M3)",
    () => {
      for (const file of [
        "src/components/ui/SettingsNav.tsx",
        "src/components/ui/SettingsTitleBar.tsx",
      ]) {
        const source = read(file);
        assert.doesNotMatch(source, /\bduration-\d+\b/, `${file} has a literal duration`);
        assert.doesNotMatch(source, /\b(?:ml|mr|pl|pr)-\d/, `${file} uses physical spacing`);
        assert.doesNotMatch(
          source,
          /\b(?:left|right)-\d|text-(?:left|right)\b/,
          `${file} uses physical offsets`
        );
        assert.doesNotMatch(
          source,
          /\btext-(?:success|warning)\b/,
          `${file} uses a low-contrast text colour`
        );
      }
      assert.match(read("src/components/ui/SettingsNav.tsx"), /duration-\[var\(--motion-fast\)\]/);
    }
  );

  await t.test(
    "change-driving: choosing an item reports its id (mounted, personalWorkspace pattern)",
    async (sub) => {
      let root;
      // Registered first so it runs before installHookDom restores the globals.
      sub.after(async () => {
        if (root) await React.act(async () => root.unmount());
      });
      const container = installHookDom(sub);
      const selected = [];
      let tree;
      function Probe() {
        tree = SettingsNav({
          items,
          activeSection: "general",
          onSectionChange: (id) => selected.push(id),
          isCompact: false,
          ariaLabel: "Settings",
        });
        return null;
      }
      root = createRoot(container);
      await React.act(async () => root.render(React.createElement(Probe)));
      const buttons = findAll(tree, (node) => node.props?.["data-section-id"]);
      assert.deepEqual(
        buttons.map((b) => b.props["data-section-id"]),
        ["general", "routing", "system"]
      );
      await React.act(async () => buttons[1].props.onClick());
      assert.deepEqual(selected, ["routing"]);
    }
  );
});

test("SectionHeader: the title is optional and a note renders (change-driving)", async (t) => {
  const { withI18nMock } = require("../lib/i18nTestMock");
  installBrowserGlobals(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-section-header-test-" })
  );
  const { SectionHeader } = await vite.ssrLoadModule("/components/ui/SettingsSection.tsx");
  const html = (props) => renderToStaticMarkup(React.createElement(SectionHeader, props));
  assert.doesNotMatch(
    html({ description: "Only a description" }),
    /<h3/,
    "no empty <h3> without a title"
  );
  assert.match(
    html({ title: "Hotkeys", description: "d", note: "A note" }),
    /<h3[^>]*>Hotkeys<\/h3>[\s\S]*>d<[\s\S]*>A note</
  );
  assert.doesNotMatch(
    html({ title: "Hotkeys", note: false }),
    /<p/,
    "a false note renders nothing"
  );
});

test("[baseline guard] the 70% close icon keeps 3:1 on every title-bar surface, in both themes", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { resolveTokens } = require("../helpers/harness/cssTokens");
  const { light, dark } = resolveTokens(read("src/index.css"));
  const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const over = (fg, bg, alpha) =>
    "#" +
    channels(fg)
      .map((c, i) =>
        Math.round(alpha * c + (1 - alpha) * channels(bg)[i])
          .toString(16)
          .padStart(2, "0")
      )
      .join("");
  const cases = [
    [light, ["--color-background", "--color-muted"]], // resting bar, hover fill
    [dark, ["--color-surface-1", "--color-surface-raised"]],
  ];
  for (const [theme, surfaces] of cases) {
    for (const surface of surfaces) {
      const icon = over(theme["--color-muted-foreground"], theme[surface], 0.7);
      assert.ok(contrastRatio(icon, theme[surface]) >= 3, `${surface}: ${icon}`);
    }
  }
});

test("[change-driving] the actual close control keeps its focused ring at 3:1 on title-bar surfaces", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { resolveTokens } = require("../helpers/harness/cssTokens");
  const closeClass = read("src/components/ui/SidebarModal.tsx").match(
    /<DialogPrimitive\.Close className="([^"]+)"/
  )?.[1];
  assert.ok(closeClass, "the dialog close control has a class list");
  const closeHtml = renderToStaticMarkup(React.createElement("button", { className: closeClass }));
  const renderedClass = closeHtml.match(/class="([^"]+)"/)?.[1];
  assert.ok(renderedClass, "the extracted close control renders its actual classes");
  const classes = new Set(renderedClass.split(/\s+/));
  assert.ok(classes.has("opacity-70"), "resting close control remains at 70% opacity");
  assert.ok(classes.has("focus-visible:ring-2") && classes.has("focus-visible:ring-ring"));
  const focusedOpacity = classes.has("focus-visible:opacity-100") ? 1 : 0.7;
  const { light, dark } = resolveTokens(read("src/index.css"));
  const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const over = (fg, bg, alpha) =>
    "#" +
    channels(fg)
      .map((c, i) =>
        Math.round(alpha * c + (1 - alpha) * channels(bg)[i])
          .toString(16)
          .padStart(2, "0")
      )
      .join("");
  for (const [themeName, theme, surfaces] of [
    ["light", light, ["--color-background", "--color-muted"]],
    ["dark", dark, ["--color-surface-1", "--color-surface-raised"]],
  ]) {
    for (const surface of surfaces) {
      const ring = over(theme["--color-ring"], theme[surface], focusedOpacity);
      assert.ok(
        contrastRatio(ring, theme[surface]) >= 3,
        `${themeName} ${surface} at focus opacity ${focusedOpacity}: ${ring}`
      );
    }
  }
});

test("[change-driving] inference radio rows receive separators from their direct radiogroup parent", async (t) => {
  installBrowserGlobals(t);
  const { withI18nMock } = require("../lib/i18nTestMock");
  const i18nVite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-inference-separators-i18n-" })
  );
  const { InferenceModeSelector } = await i18nVite.ssrLoadModule(
    "/components/ui/SettingsSection.tsx"
  );
  const html = renderToStaticMarkup(
    React.createElement(InferenceModeSelector, {
      label: "Dictation runs on",
      modes: [
        {
          id: "local",
          label: "Local",
          description: "On this device",
          icon: React.createElement("span"),
        },
        { id: "cloud", label: "Cloud", description: "Remote", icon: React.createElement("span") },
      ],
      activeMode: "local",
      onSelect() {},
    })
  );
  assert.match(
    html,
    /role="radiogroup"[^>]*class="divide-y divide-border\/60 dark:divide-border-subtle\/50"/
  );
  assert.equal((html.match(/role="radio"/g) ?? []).length, 2);
});
