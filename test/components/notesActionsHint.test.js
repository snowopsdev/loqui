const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderStatic } = require("../helpers/harness/reactSsr");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { makeRoute } = require("../lib/routeFixtures");

const root = path.join(__dirname, "../..");
const loadPure = () => import("../../src/components/notes/notesActionsHintModel.ts");
const K = "notes.actionsModelHint";
const cases = [
  [{ status: "ready" }, null],
  [{ status: "unknown" }, null],
  [{ status: "off" }, null],
  [{ status: "needsModel", sizeBytes: 1 }, ["title", "choose"]],
  [{ status: "needsKey", provider: "" }, ["needsProvider", "chooseProvider"]],
  [{ status: "needsKey", provider: "openai" }, ["needsKey", "addKey"]],
  [{ status: "needsUrl" }, ["needsUrl", "addUrl"]],
  [{ status: "unreachable", detail: "sealed" }, ["sealed", "openSettings"]],
  ...["retired", "unsupported", undefined].map((detail) => [
    { status: "unreachable", detail },
    ["unreachable", "openSettings"],
  ]),
];
/** @param {Partial<import("../../src/lib/routeGraph").ResolvedRoute>} over */
const route = (over = {}) => makeRoute({ id: "noteFormatting", ...over });

async function viewHarness(t) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    resolveAlias: { "@": path.join(root, "src") },
    mockModules: {
      "/ui/notices": "export const notify = () => { throw Error('unexpected notice'); };",
    },
  });
  const i18n = (await vite.ssrLoadModule("/i18n.ts")).default;
  await i18n.changeLanguage("en");
  const { NotesActionsHint } = await vite.ssrLoadModule("/components/notes/NotesActionsHint.tsx");
  return { vite, i18n, NotesActionsHint };
}

test("every published route state maps to its exact fix; dismissal always wins; only off disables the picker", async () => {
  const { notesActionsHint, notesActionsDisabledByRoute } = await loadPure();
  for (const [state, keys] of cases) {
    assert.deepEqual(
      notesActionsHint(state, false),
      keys ? { titleKey: `${K}.${keys[0]}`, actionKey: `${K}.${keys[1]}` } : null,
      JSON.stringify(state)
    );
    assert.equal(notesActionsHint(state, true), null, JSON.stringify(state));
    assert.equal(notesActionsDisabledByRoute(state), state.status === "off", JSON.stringify(state));
  }
  const { NOTES_ACTIONS_MODEL_HINT_KEY } = await import("../../src/components/notes/shared.ts");
  assert.equal(NOTES_ACTIONS_MODEL_HINT_KEY, "notesActionsModelHintDismissed");
});

test("real translated presentation covers every mapping, optional settings and dismissal without side effects", async (t) => {
  const { NotesActionsHint, i18n } = await viewHarness(t);
  for (const [state, keys] of cases) {
    const props = {
      route: route({ state, providerId: "openai" }),
      dismissed: false,
      onDismiss() {},
      onOpenSettings() {},
    };
    const html = renderStatic(NotesActionsHint, props);
    if (!keys) {
      assert.equal(html, "");
      continue;
    }
    assert.match(html, /role="note"/);
    assert.ok(html.includes(`data-route-state="${state.status}"`));
    // Render the expected copy through React too, to account for HTML escaping.
    const expectedTitle = renderStatic(
      "span",
      {},
      i18n.t(`${K}.${keys[0]}`, { provider: "OpenAI" })
    );
    assert.ok(html.includes(expectedTitle.slice(6, -7)), html);
    assert.ok(html.includes('data-settings-path="llms/noteFormatting"'));
    assert.match(html, /text-caption/);
    assert.doesNotMatch(html, /opacity-|text-muted-foreground\/|ring-ring\//);
    assert.equal((html.match(/focus-visible:ring-2 focus-visible:ring-ring/g) ?? []).length, 2);
    const noSettings = renderStatic(NotesActionsHint, { ...props, onOpenSettings: undefined });
    assert.equal((noSettings.match(/<button/g) ?? []).length, 1, "only native dismiss remains");
    assert.doesNotMatch(noSettings, /data-settings-path/);
    assert.equal(renderStatic(NotesActionsHint, { ...props, dismissed: true }), "");
  }
});

test("missing committed remote key uses route providerId and existing localized label semantics", async (t) => {
  const { NotesActionsHint, i18n } = await viewHarness(t);
  for (const [providerId, expected] of [
    ["openai", "OpenAI"],
    ["custom", i18n.t("locality.customEndpoint")],
    [null, i18n.t("locality.unknownProvider")],
    ["!!!", i18n.t("locality.unknownProvider")],
    ["new-provider", "New Provider"],
  ]) {
    const html = renderStatic(NotesActionsHint, {
      route: route({
        locality: "remote",
        provider: "Wrong display authority",
        providerId,
        state: { status: "needsKey", provider: "anthropic" },
      }),
      dismissed: false,
      onDismiss() {},
    });
    assert.ok(html.includes(`Actions need an API key for ${expected}`), html);
    assert.doesNotMatch(html, /Anthropic|Wrong display authority/);
  }
  await i18n.changeLanguage("ar");
  const html = renderStatic(NotesActionsHint, {
    route: route({ providerId: "custom", state: { status: "needsKey", provider: "openai" } }),
    dismissed: false,
    onDismiss() {},
  });
  assert.ok(html.includes(i18n.t("locality.customEndpoint")));
  assert.doesNotMatch(html, /\{\{provider\}\}|Custom endpoint/);
});

test("native hint handlers open precisely the supplied route path and dismiss only on activation", async (t) => {
  let host;
  t.after(async () => {
    if (host) await React.act(async () => host.unmount());
  });
  const { NotesActionsHint } = await viewHarness(t);
  installHookDom(t);
  const { installTree } = require("../helpers/harness/fakeDomTree");
  const tree = installTree();
  let settings = [],
    dismissed = 0;
  host = createRoot(tree.container);
  await React.act(async () =>
    host.render(
      React.createElement(NotesActionsHint, {
        route: route({
          settingsPath: "llms/noteFormatting/fixture-owned",
          providerId: "openai",
          state: { status: "needsKey", provider: "openai" },
        }),
        dismissed: false,
        onDismiss: () => dismissed++,
        onOpenSettings: (p) => settings.push(p),
      })
    )
  );
  assert.deepEqual(settings, []);
  assert.equal(dismissed, 0);
  await tree.click("Add the key");
  assert.deepEqual(settings, ["llms/noteFormatting/fixture-owned"]);
  assert.equal(dismissed, 0);
  const close = tree.find(
    (n) => n.tagName === "BUTTON" && tree.props(n)?.["aria-label"] === "Close"
  );
  assert.ok(close);
  await React.act(async () => tree.props(close).onClick());
  assert.equal(dismissed, 1);
  assert.deepEqual(settings, ["llms/noteFormatting/fixture-owned"]);
});

test("PersonalNotesView reuses its one resolved route and removes only temporary readiness", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/notes/PersonalNotesView.tsx"),
    "utf8"
  );
  assert.doesNotMatch(
    source,
    /useNoteActionsReady|shouldShowActionsModelHint|onOpenSettings\("intelligence"\)/
  );
  assert.equal((source.match(/useResolvedRoute\("noteFormatting"\)/g) ?? []).length, 1);
  assert.match(source, /<NotesActionsHint\b[\s\S]*?route=\{noteRoute\}/);
  assert.match(
    source,
    /actionProcessingState === "processing"\s*\|\|\s*notesActionsDisabledByRoute\(noteRoute.state\)/
  );
  assert.match(source, /localStorage\.setItem\(NOTES_ACTIONS_MODEL_HINT_KEY, "true"\)/);
  for (const file of ["src/hooks/useNoteActionsReady.ts", "src/utils/noteActionsReadiness.ts"])
    assert.equal(fs.existsSync(path.join(root, file)), false);
});

test("ActionPicker keeps readable full-opacity controls, opaque focus and shared motion without changing native admission", () => {
  const source = fs.readFileSync(path.join(root, "src/components/notes/ActionPicker.tsx"), "utf8");
  assert.equal((source.match(/focus-visible:ring-2 focus-visible:ring-ring/g) ?? []).length, 2);
  assert.equal((source.match(/disabled=\{disabled\}/g) ?? []).length, 2);
  assert.match(source, /text-caption/);
  assert.match(
    source,
    /text-foreground disabled:cursor-not-allowed/,
    "readable picker ink on its translucent Plum surface"
  );
  assert.equal((source.match(/duration-\(--motion-fast\)/g) ?? []).length, 2);
  assert.equal((source.match(/ease-\(--motion-ease-std\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /ease-\(--motion-ease\)/);
  const styles = fs.readFileSync(path.join(root, "src/index.css"), "utf8");
  assert.match(styles, /--motion-fast:\s*150ms;/);
  assert.match(styles, /--motion-ease-std:\s*cubic-bezier\(0\.2, 0, 0, 1\);/);
  assert.doesNotMatch(
    source,
    /opacity-40|text-\[11px\]|text-(?:accent|muted-foreground)\/|duration-150/
  );
  assert.match(source, /onClick=\{\(\) => handleRun\(activeAction\)\}/);
  assert.match(source, /<DropdownMenuTrigger asChild>/);
  assert.match(source, /onClick=\{onManageActions\}/);
});

function findElement(node, predicate) {
  if (Array.isArray(node))
    return node.map((child) => findElement(child, predicate)).find(Boolean) ?? null;
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : findElement(node.props?.children, predicate);
}

// Mount production PersonalNotesView's hooks and inspect its child boundary.
// Layout/native keyboard and full descendants are exercised by the retained
// T3 fixture; no route, credential, note-store or onboarding authority is mocked.
async function notesHarness(t) {
  let host;
  t.after(async () => {
    if (host) await React.act(async () => host.unmount());
  });
  const writes = [],
    unexpected = [];
  const note = {
    id: 26,
    space_id: 1,
    folder_id: null,
    title: "Fixture note",
    content: "Original draft",
    enhanced_content: null,
    created_at: "2026-10-19T12:00:00Z",
    updated_at: "2026-10-19T12:00:00Z",
  };
  const api = {
    getSpaces: async () => [{ id: 1, name: "Personal", kind: "private" }],
    getFolders: async () => [],
    getFolderNoteCounts: async () => [],
    getNotes: async () => [note],
    getNote: async () => note,
    updateNote: async (id, updates) => {
      writes.push({ id, updates });
      return { success: true };
    },
    getActions: async () => [
      {
        id: 1,
        name: "Fixture action",
        sort_order: 0,
        prompt: "Fixture",
        description: "Local fixture",
      },
    ],
    personalInference: {
      textGenerate: async () => {
        unexpected.push("textGenerate");
        throw Error("unexpected inference");
      },
      textStream: async () => {
        unexpected.push("textStream");
        throw Error("unexpected inference");
      },
      onTextEvent: () => () => {},
    },
  };
  const { storage } = installBrowserGlobals(t, {
    window: { electronAPI: api },
    initialStorage: {
      notesStructureIntroVersion: "1",
      useLocalWhisper: "true",
      uploadUseLocalWhisper: "true",
    },
  });
  const container = installHookDom(t);
  container.style = {};
  const vite = await createRendererServer(t, {
    resolveAlias: { "@": path.join(root, "src") },
    mockModules: {
      "/ui/notices": "export const notify = () => { throw Error('unexpected notice'); };",
    },
  });
  const i18n = (await vite.ssrLoadModule("/i18n.ts")).default;
  await i18n.changeLanguage("en");
  const Component = (await vite.ssrLoadModule("/components/notes/PersonalNotesView.tsx")).default;
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteFactsStore } = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  const notes = await vite.ssrLoadModule("/stores/noteStore.ts");
  const { useActionProcessingStore } = await vite.ssrLoadModule("/stores/actionProcessingStore.ts");
  const actions = await vite.ssrLoadModule("/stores/actionStore.ts");
  useSettingsStore.setState({
    noteFormattingMode: "providers",
    noteFormattingProvider: "openai",
    noteFormattingModel: "gpt-4o",
    noteFormattingCloudMode: "byok",
  });
  await actions.initializeActions();
  let tree,
    opened = [];
  function Harness() {
    tree = Component({ onOpenSettings: (p) => opened.push(p) });
    return null;
  }
  host = createRoot(container);
  const mount = () =>
    React.act(async () => {
      host.render(React.createElement(Harness));
      await new Promise((r) => setTimeout(r, 0));
    });
  await mount();
  const edit = () => findElement(tree, (e) => e.props?.slash && e.props?.onContentChange);
  const hint = () => findElement(tree, (e) => e.type?.name === "NotesActionsHint");
  const mutate = (fn) =>
    React.act(async () => {
      await fn();
      await new Promise((r) => setTimeout(r, 0));
    });
  const publish = (patch) =>
    mutate(() => useRouteFactsStore.setState(({ facts }) => ({ facts: { ...facts, ...patch } })));
  return {
    tree: () => tree,
    hint,
    edit,
    mutate,
    publish,
    storage,
    writes,
    unexpected,
    opened,
    notes,
    useSettingsStore,
    useActionProcessingStore,
    remount: async () => {
      await React.act(async () => host.unmount());
      host = createRoot(container);
      await mount();
    },
  };
}

test("mounted Notes follows committed route facts unknown → missing remote key → ready; dismissal survives route change and remount", async (t) => {
  const h = await notesHarness(t);
  assert.equal(h.hint().props.route.state.status, "unknown");
  assert.equal(renderStatic(h.hint().type, h.hint().props), "");
  assert.equal(
    h.edit().props.actionPicker.props.disabled,
    false,
    "unknown preserves whole-picker availability"
  );
  assert.equal(h.edit().props.slash.aiAvailable, false);
  assert.equal(h.edit().props.slash.aiNeedsSetup, false, "unknown has no setup nag");
  await h.publish({ credentials: new Map(), credentialFields: new Map() });
  assert.deepEqual(h.hint().props.route.state, { status: "needsKey", provider: "OpenAI" });
  assert.match(renderStatic(h.hint().type, h.hint().props), /Actions need an API key for OpenAI/);
  assert.equal(h.edit().props.actionPicker.props.disabled, false);
  assert.equal(h.edit().props.slash.aiAvailable, false);
  assert.equal(h.edit().props.slash.aiNeedsSetup, true);
  await h.mutate(() => h.hint().props.onOpenSettings(h.hint().props.route.settingsPath));
  assert.deepEqual(h.opened, ["llms/noteFormatting"]);
  await h.publish({ credentials: new Map([["openai", true]]) });
  assert.equal(h.hint().props.route.state.status, "ready");
  assert.equal(renderStatic(h.hint().type, h.hint().props), "");
  await h.publish({ credentials: new Map() });
  await h.mutate(() => h.hint().props.onDismiss());
  assert.equal(h.storage.getItem("notesActionsModelHintDismissed"), "true");
  await h.mutate(() =>
    h.useSettingsStore.setState({
      noteFormattingProvider: "anthropic",
      noteFormattingModel: "claude-sonnet",
    })
  );
  assert.equal(renderStatic(h.hint().type, h.hint().props), "");
  await h.remount();
  assert.equal(h.hint().props.dismissed, true);
  assert.equal(renderStatic(h.hint().type, h.hint().props), "");
  assert.deepEqual(h.unexpected, []);
  assert.deepEqual(h.writes, []);
});

test("mounted Notes preserves draft/switch writes, content and processing guards, and actual intro → manager handlers across all branches", async (t) => {
  const h = await notesHarness(t);
  const editor = h.edit();
  await h.mutate(() => editor.props.onContentChange(26, "Edited draft retained"));
  assert.equal(h.edit().props.note.content, "Edited draft retained");
  await h.mutate(() =>
    h.useActionProcessingStore.setState({
      noteStates: { 26: { status: "processing", actionName: "Fixture" } },
    })
  );
  assert.equal(h.edit().props.actionPicker.props.disabled, true);
  await h.mutate(() => h.useActionProcessingStore.setState({ noteStates: {} }));
  assert.equal(h.edit().props.actionPicker.props.disabled, false);
  await h.mutate(() => h.edit().props.onContentChange(26, "  "));
  assert.equal(h.edit().props.actionPicker.props.disabled, true, "content guard remains");
  await h.mutate(() => h.edit().props.onContentChange(26, "Edited draft retained"));
  let openActions = h.edit().props.slash.onManageActions;
  await h.mutate(openActions);
  const intro = () => findElement(h.tree(), (e) => e.type?.name === "NotesOnboarding");
  assert.ok(intro());
  await h.mutate(() => intro().props.onComplete());
  assert.equal(h.storage.getItem("notesOnboardingComplete"), "true");
  const manager = () => findElement(h.tree(), (e) => e.type?.name === "ActionManagerDialog");
  assert.equal(manager().props.open, true);
  await h.mutate(() => manager().props.onOpenChange(false));
  openActions = h.edit().props.slash.onManageActions;
  await h.mutate(() => h.notes.navigateToContainer(1, null));
  assert.equal(h.edit(), null, "container branch mounted");
  assert.ok(h.writes.some((w) => w.id === 26 && w.updates.content === "Edited draft retained"));
  await h.mutate(openActions);
  assert.equal(manager().props.open, true);
  const introDialog = findElement(
    h.tree(),
    (e) =>
      typeof e.props?.open === "boolean" &&
      findElement(e.props.children, (child) => child.type?.name === "NotesOnboarding")
  );
  assert.equal(introDialog.props.open, false, "intro is not repeated");
  await h.mutate(() => manager().props.onOpenChange(false));
  await h.mutate(() => h.notes.navigateToContainer(999, null));
  assert.equal(h.edit(), null, "empty branch mounted");
  await h.mutate(openActions);
  assert.equal(manager().props.open, true, "shared manager handler remains live outside editor");
  assert.deepEqual(h.unexpected, []);
});

test("supplemental guard covers the new hint and local picker presentation without extending the frozen list", () => {
  const { scanFiles } = require("../helpers/workspaceTokenGuard");
  assert.deepEqual(
    scanFiles([
      "src/components/notes/notesActionsHintModel.ts",
      "src/components/notes/NotesActionsHint.tsx",
      "src/components/notes/ActionPicker.tsx",
    ]),
    []
  );
});
