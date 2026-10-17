const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

const chatRoute = {
  id: "chat",
  kind: "text",
  locality: "remote",
  provider: "OpenAI",
  providerId: "openai",
  host: "api.openai.com",
  model: "gpt-5",
  state: { status: "ready" },
  sends: "your messages",
  settingsPath: "llms/chatIntelligence",
};

test("[change-driving] search results view", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-search-results-test-" }, { withOptions: true })
  );
  const { SettingsSearchResultsView } = await vite.ssrLoadModule(
    "/components/settings/SettingsSearchResults.tsx"
  );
  const { SETTINGS_REGISTRY } = await vite.ssrLoadModule(
    "/components/settings/settingsRegistry.ts"
  );
  const { SettingsSearchField } = await vite.ssrLoadModule(
    "/components/settings/SettingsSearchField.tsx"
  );
  const pick = (...ids) => SETTINGS_REGISTRY.filter((e) => ids.includes(e.id));
  const view = (props) =>
    renderToStaticMarkup(
      React.createElement(SettingsSearchResultsView, {
        onJump() {},
        onEscape: () => false,
        routes: new Map(),
        ...props,
      })
    );

  await t.test(
    "change-driving: grouped results with breadcrumbs, an active row and a live switch",
    () => {
      const html = view({
        query: "retention",
        groups: [{ section: "privacyData", entries: pick("audioRetention", "dataRetention") }],
        activeId: "dataRetention",
      });
      assert.match(html, /settingsSearch\.count\{&quot;count&quot;:2\}/);
      assert.match(html, /settingsModal\.sections\.privacyData\.label/);
      assert.match(html, /data-result="dataRetention"[^>]*data-active="true"/);
      assert.match(html, /data-result="audioRetention"[^>]*data-active="false"/);
      assert.match(html, /role="switch"/, "the toggle entry renders a live switch");
      assert.equal((html.match(/role="switch"/g) ?? []).length, 1, "the link entry renders none");
    }
  );

  await t.test("change-driving: the sub-tab joins the breadcrumb", () => {
    const html = view({
      query: "x",
      groups: [{ section: "llms", entries: pick("cleanupEnabled") }],
      activeId: null,
    });
    assert.match(html, /settingsPage\.llms\.tabs\.dictationCleanup/);
  });

  await t.test("change-driving: route results show where the task runs and offer no switch", () => {
    const html = view({
      query: "cloud",
      groups: [{ section: "routing", entries: pick("route:chat") }],
      activeId: null,
      routes: new Map([["chat", chatRoute]]),
    });
    assert.match(html, /data-result="route:chat"/);
    assert.doesNotMatch(html, /role="switch"|<select/);
  });

  await t.test("change-driving: no results suggests what to try", () => {
    const html = view({ query: "xyz", groups: [], activeId: null });
    assert.match(html, /settingsSearch\.none\{&quot;query&quot;:&quot;xyz&quot;\}/);
  });

  await t.test("change-driving: the field is a search input with its shortcut hint", () => {
    const html = renderToStaticMarkup(
      React.createElement(SettingsSearchField, {
        value: "",
        onChange() {},
        onKeyDown() {},
        onEscape: () => false,
      })
    );
    assert.match(html, /type="search"/);
    assert.match(html, /aria-label="settingsSearch\.placeholder"/);
    assert.match(html, /aria-keyshortcuts="Meta\+F Control\+F \/"/);
  });

  await t.test(
    "change-driving: the field and the pane claim Escape (Task 10's escapeClaim) only while a query exists",
    () => {
      const field = (value) =>
        renderToStaticMarkup(
          React.createElement(SettingsSearchField, {
            value,
            onChange() {},
            onKeyDown() {},
            onEscape: () => false,
          })
        );
      assert.match(field("mic"), /data-escape-active="true"/);
      assert.match(field(""), /data-escape-active="false"/);
      assert.match(
        view({ query: "x", groups: [], activeId: null }),
        /data-escape-active="true"/,
        "also with no results"
      );
    }
  );
});

test("[change-driving] Escape in the field or in the results clears the query and stops there (mounted)", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-search-escape-test-" })
  );
  const { SettingsSearchResultsView } = await vite.ssrLoadModule(
    "/components/settings/SettingsSearchResults.tsx"
  );
  const { SettingsSearchField } = await vite.ssrLoadModule(
    "/components/settings/SettingsSearchField.tsx"
  );

  let render = () => null;
  let tree;
  let mounts = 0;
  function Probe() {
    tree = render();
    return null;
  }
  root = createRoot(container);
  const show = (fn) => {
    render = fn;
    return React.act(async () => root.render(React.createElement(Probe, { key: ++mounts })));
  };
  const key = (name) => ({
    key: name,
    stopped: false,
    stopPropagation() {
      this.stopped = true;
    },
  });
  const inputOf = (node) => {
    if (Array.isArray(node)) return node.map(inputOf).find(Boolean);
    if (!node || typeof node !== "object") return null;
    return node.type === "input" ? node : inputOf(node.props?.children);
  };

  let cleared = 0;
  const onEscape = () => {
    cleared += 1;
    return true;
  };
  await show(() =>
    SettingsSearchResultsView({
      query: "x",
      groups: [],
      activeId: null,
      routes: new Map(),
      onJump() {},
      onEscape,
    })
  );
  const esc = key("Escape");
  tree.props.onKeyDown(esc);
  assert.equal(cleared, 1);
  assert.equal(esc.stopped, true, "a claimed Escape does not travel further");
  const other = key("a");
  tree.props.onKeyDown(other);
  assert.equal(cleared, 1);
  assert.equal(other.stopped, false);

  const passed = [];
  await show(() =>
    SettingsSearchField.render(
      { value: "mic", onChange() {}, onKeyDown: (e) => passed.push(e.key), onEscape },
      null
    )
  );
  const claimed = key("Escape");
  inputOf(tree).props.onKeyDown(claimed);
  assert.equal(cleared, 2);
  assert.equal(claimed.stopped, true);
  assert.deepEqual(passed, [], "the handler consumed it");
  inputOf(tree).props.onKeyDown(key("ArrowDown"));
  assert.deepEqual(passed, ["ArrowDown"], "other keys reach the arrow/Enter handler");

  await show(() =>
    SettingsSearchField.render(
      { value: "", onChange() {}, onKeyDown: (e) => passed.push(e.key), onEscape: () => false },
      null
    )
  );
  const unclaimed = key("Escape");
  inputOf(tree).props.onKeyDown(unclaimed);
  assert.equal(unclaimed.stopped, false, "with no query Escape belongs to the dialog");
});

test("[change-driving] live controls write through the real store, mirroring the page's rows (mounted)", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-live-controls-test-" })
  );
  const { LiveToggle, LiveSelect } = await vite.ssrLoadModule(
    "/components/settings/SettingsSearchResults.tsx"
  );
  const { SETTINGS_REGISTRY } = await vite.ssrLoadModule(
    "/components/settings/settingsRegistry.ts"
  );
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const entry = (id) => SETTINGS_REGISTRY.find((e) => e.id === id);
  const store = () => useSettingsStore.getState();
  const write = (fn) => React.act(async () => fn(store()));

  let render = () => null;
  let tree;
  let mounts = 0;
  function Probe() {
    tree = render();
    return null;
  }
  root = createRoot(container);
  const show = (fn) => {
    render = fn;
    return React.act(async () => root.render(React.createElement(Probe, { key: ++mounts })));
  };
  const toggle = (id) => () => LiveToggle({ entry: entry(id), control: entry(id).control });

  await t.test("[change-driving] a plain toggle flips the store", async () => {
    await write((s) => s.setAudioCuesEnabled(false));
    await show(toggle("audioCues"));
    assert.equal(tree.props.checked, false);
    assert.equal(tree.props["aria-label"], "settingsPage.general.soundEffects.dictationSounds");
    await React.act(async () => tree.props.onChange(true));
    assert.equal(store().audioCuesEnabled, true);
  });

  await t.test(
    "[change-driving] the notifications result mirrors 'Disable all notifications' (inverted)",
    async () => {
      await write((s) => s.setNotificationsEnabled(true));
      await show(toggle("notifications"));
      assert.equal(tree.props.checked, false, "notifications are on, so 'disable all' is off");
      await React.act(async () => tree.props.onChange(true));
      assert.equal(store().notificationsEnabled, false);
    }
  );

  await t.test(
    "[change-driving] dependent toggles are disabled while notifications are off",
    async () => {
      await write((s) => s.setNotificationsEnabled(false));
      await show(toggle("meetingDetection"));
      assert.equal(tree.props.disabled, true);
      await write((s) => s.setNotificationsEnabled(true));
      await show(toggle("meetingDetection"));
      assert.equal(tree.props.disabled, false);
    }
  );

  await t.test(
    "[change-driving] saving discarded dictations is disabled when history or audio retention is off",
    async () => {
      await write((s) => {
        s.setDataRetentionEnabled(true);
        s.setAudioRetentionDays(0);
      });
      await show(toggle("saveDiscarded"));
      assert.equal(tree.props.disabled, true);
    }
  );

  await t.test("[change-driving] the theme select writes the theme", async () => {
    await write((s) => s.setTheme("light"));
    await show(() => LiveSelect({ entry: entry("theme"), control: entry("theme").control }));
    assert.equal(tree.props.value, "light");
    await React.act(async () => tree.props.onChange({ target: { value: "dark" } }));
    assert.equal(store().theme, "dark");
  });
});

test("[change-driving] result button arrows move focus while native Enter and live controls act independently (mounted)", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-result-keyboard-" })
  );
  const { SettingsSearchResultsView } = await vite.ssrLoadModule(
    "/components/settings/SettingsSearchResults.tsx"
  );
  const { SETTINGS_REGISTRY } = await vite.ssrLoadModule(
    "/components/settings/settingsRegistry.ts"
  );
  const entries = SETTINGS_REGISTRY.filter((e) => ["theme", "audioCues"].includes(e.id));
  const active = [];
  const jumped = [];
  let tree;
  function Probe() {
    tree = SettingsSearchResultsView({
      query: "x",
      groups: [{ section: "general", entries }],
      activeId: "theme",
      routes: new Map(),
      onJump: (e) => jumped.push(e.id),
      onEscape: () => false,
      onActiveChange: (id) => active.push(id),
    });
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  const buttons = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (node.props?.["data-result-jump"]) buttons.push(node);
    visit(node.props?.children);
  };
  visit(tree);
  const focus = [];
  const currentTarget = {
    closest: () => ({
      querySelectorAll: () => entries.map((e) => ({ focus: () => focus.push(e.id) })),
    }),
  };
  const event = (key) => ({
    key,
    currentTarget,
    preventDefault() {
      this.prevented = true;
    },
  });
  buttons[0].props.onFocus();
  const down = event("ArrowDown");
  buttons[0].props.onKeyDown(down);
  assert.equal(down.prevented, true);
  assert.deepEqual(focus, ["audioCues"]);
  assert.deepEqual(active, ["theme", "audioCues"]);
  const enter = event("Enter");
  buttons[1].props.onKeyDown(enter);
  assert.equal(
    enter.prevented,
    undefined,
    "the native button owns Enter and dispatches exactly one click"
  );
  buttons[1].props.onClick();
  assert.deepEqual(jumped, ["audioCues"]);
  const controlKey = event("Enter");
  tree.props.onKeyDown(controlKey);
  assert.equal(controlKey.prevented, undefined, "pane does not intercept live-control Enter");
  assert.deepEqual(jumped, ["audioCues"]);
});

test("[change-driving] rendered search text, field edges and focused result cues meet both-theme composite contrast", async (t) => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { resolveTokens } = require("../helpers/harness/cssTokens");
  const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");
  const { contrastRatio, parseHexColor } = await import("../../src/utils/contrast.ts");
  const mix = (fg, amount, bg) => {
    const a = parseHexColor(fg),
      b = parseHexColor(bg);
    return (
      "#" +
      ["r", "g", "b"]
        .map((c) =>
          Math.round(a[c] * amount + b[c] * (1 - amount))
            .toString(16)
            .padStart(2, "0")
        )
        .join("")
    );
  };
  installBrowserGlobals(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-search-contrast-" })
  );
  const { SettingsSearchField } = await vite.ssrLoadModule(
    "/components/settings/SettingsSearchField.tsx"
  );
  const { SettingsSearchResultsView } = await vite.ssrLoadModule(
    "/components/settings/SettingsSearchResults.tsx"
  );
  const { SETTINGS_REGISTRY } = await vite.ssrLoadModule(
    "/components/settings/settingsRegistry.ts"
  );
  const field = renderToStaticMarkup(
    React.createElement(SettingsSearchField, {
      value: "x",
      onChange() {},
      onKeyDown() {},
      onEscape: () => false,
    })
  );
  const results = renderToStaticMarkup(
    React.createElement(SettingsSearchResultsView, {
      query: "x",
      groups: [
        {
          section: "general",
          entries: SETTINGS_REGISTRY.filter((e) => ["theme", "audioCues"].includes(e.id)),
        },
      ],
      activeId: "theme",
      routes: new Map(),
      onJump() {},
      onEscape: () => false,
    })
  );
  const fieldChrome = field.match(/^<label\b[^>]*>/)?.[0];
  const fieldInput = field.match(/<input\b[^>]*>/)?.[0];
  assert.ok(fieldChrome && fieldInput, "actual field chrome and native input render");
  assert.match(fieldChrome, /border-input-border/);
  assert.match(fieldChrome, /bg-background/);
  assert.match(fieldChrome, /dark:bg-input/);
  assert.match(fieldChrome, /focus-within:bg-background/);
  assert.match(fieldChrome, /focus-within:border-ring/);
  assert.match(fieldChrome, /focus-within:ring-2/);
  assert.match(fieldChrome, /focus-within:ring-ring(?:\s|")/);
  assert.match(fieldChrome, /focus-within:ring-offset-1/);
  assert.match(fieldChrome, /focus-within:ring-offset-background/);
  assert.match(
    fieldInput,
    /input-inline/,
    "embedded query uses the chrome edge instead of the unlayered native field edge"
  );
  assert.doesNotMatch(
    fieldInput,
    /border-input-border|ring-ring/,
    "there is only one field edge/focus cue"
  );
  assert.match(results, /focus-within:ring-ring(?:\s|&quot;|")/);
  assert.match(results, /data-\[active=true\]:border-ring/);
  assert.match(
    results,
    /border-input-border bg-background/,
    "actual live select uses the readable field edge"
  );
  for (const [theme, tokens] of Object.entries(resolveTokens(css))) {
    const pane = tokens[theme === "dark" ? "--color-surface-1" : "--color-background"];
    const sidebar = tokens[theme === "dark" ? "--color-surface-0" : "--color-surface-1"];
    const panel = mix(tokens[theme === "dark" ? "--color-surface-2" : "--color-card"], 0.5, pane);
    const peakFlash = mix(tokens["--color-ring"], 0.16, panel);
    const fieldRest = tokens[theme === "dark" ? "--color-input" : "--color-background"];
    const fieldFocus = tokens["--color-background"];
    for (const surface of [pane, sidebar, fieldRest, fieldFocus, peakFlash]) {
      for (const role of ["--color-foreground", "--color-muted-foreground"])
        assert.ok(contrastRatio(tokens[role], surface) >= 4.5, `${theme} ${role} on ${surface}`);
    }
    for (const surface of [pane, sidebar, fieldRest, fieldFocus])
      assert.ok(
        contrastRatio(tokens["--color-ring"], surface) >= 3,
        `${theme} focused outline on ${surface}`
      );
    assert.ok(contrastRatio(tokens["--color-input-border"], fieldRest) >= 3, `${theme} field edge`);
  }
});

test("[change-driving] search chrome stays in interface flow independently of automatic query direction", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-search-chrome-flow-" })
  );
  const { SettingsSearchField } = await vite.ssrLoadModule(
    "/components/settings/SettingsSearchField.tsx"
  );
  const parse = (html) => {
    const root = { children: [] };
    const stack = [root];
    for (const [tag] of html.matchAll(/<[^>]+>/g)) {
      if (tag.startsWith("</")) {
        stack.pop();
        continue;
      }
      const name = tag.match(/^<([\w-]+)/)?.[1];
      if (!name) continue;
      const node = { name, tag, children: [] };
      stack.at(-1).children.push(node);
      if (!/\/>$/.test(tag) && !["input", "br", "hr"].includes(name)) stack.push(node);
    }
    return root.children[0];
  };
  for (const direction of ["ltr", "rtl"]) {
    for (const query of ["", "ميكروفون", "mic"]) {
      const html = renderToStaticMarkup(
        React.createElement(
          "div",
          { dir: direction },
          React.createElement(SettingsSearchField, {
            value: query,
            onChange() {},
            onKeyDown() {},
            onEscape: () => false,
          })
        )
      );
      const parent = parse(html);
      const chrome = parent.children[0];
      assert.equal(
        chrome.name,
        "label",
        "the entire field surface natively focuses its wrapped input"
      );
      assert.match(parent.tag, new RegExp(`dir="${direction}"`));
      assert.match(
        chrome.tag,
        /class="[^"]*\bflex\b/,
        `${direction}/${query}: one UI-direction flex row owns all chrome`
      );
      const chromeClasses = chrome.tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];
      assert.ok(chromeClasses.includes("flex"), "the chrome is an actual flex container");
      assert.ok(chromeClasses.includes("h-8"), "the compact field keeps its existing height");
      assert.doesNotMatch(
        chromeClasses.join(" "),
        /flex-col|flex-row-reverse|flex-wrap/,
        "interface direction controls the normal row"
      );
      assert.doesNotMatch(
        chrome.tag,
        /\bdir=/,
        "chrome inherits the interface direction, never the query direction"
      );
      assert.deepEqual(
        chrome.children.map((child) => child.name),
        ["svg", "input", "kbd"],
        "icon, query and shortcut occupy distinct direct flex items"
      );
      const [icon, input, shortcut] = chrome.children;
      for (const adornment of [icon, shortcut]) {
        assert.match(adornment.tag, /\bshrink-0\b/);
        assert.doesNotMatch(
          adornment.tag,
          /\babsolute\b|\b(?:start|end)-/,
          "content direction cannot move an adornment onto the other one"
        );
      }
      assert.match(input.tag, /dir="auto"/);
      assert.equal(input.tag.match(/value="([^"]*)"/)?.[1] ?? "", query);
      assert.match(input.tag, /\binput-inline\b/);
      assert.match(input.tag, /\bmin-w-0\b/);
      assert.match(input.tag, /\bflex-1\b/);
      assert.doesNotMatch(
        input.tag,
        /\b(?:ps|pe)-\d/,
        "input content direction never controls chrome spacing"
      );
      assert.match(shortcut.tag, /dir="ltr"/);
      assert.match(chrome.tag, /border-input-border/);
      assert.match(chrome.tag, /focus-within:ring-2/);
      assert.match(chrome.tag, /focus-within:ring-ring(?:\s|")/);
      assert.match(chrome.tag, /focus-within:ring-offset-1/);
    }
  }
});
