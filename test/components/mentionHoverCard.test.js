const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");

async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8")
    );
    await i18next.use(initReactI18next).init({
      lng: "en",
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
    });
  }
  return import("../../src/components/ui/MentionHoverCard.tsx");
}
const ready = {
  status: "ready",
  title: "Pricing review",
  meta: "Fri 9 Oct · 55 min",
  excerpt: "so Thursday, not Monday",
};

test("meetings and dictations can be quoted; notes and folders only opened", async () => {
  const { MentionPreview } = await load();
  const meeting = renderStatic(MentionPreview, {
    kind: "meeting",
    state: ready,
    onOpen: () => {},
    onInsertQuote: () => {},
  });
  assert.match(meeting, />Open</);
  assert.match(meeting, />Insert quote</);
  const noteCard = renderStatic(MentionPreview, { kind: "note", state: ready, onOpen: () => {} });
  assert.doesNotMatch(noteCard, /Insert quote/);
});

test("a deleted target says so instead of opening nothing", async () => {
  const { MentionPreview } = await load();
  const html = renderStatic(MentionPreview, {
    kind: "note",
    state: { status: "missing" },
    onOpen: () => {},
  });
  assert.match(html, /no longer exists/);
  assert.doesNotMatch(html, />Open</);
});

test("failure is truthful and recoverable; empty excerpts do not offer quote; all native actions use opaque rings", async () => {
  const { MentionPreview } = await load();
  const error = renderStatic(MentionPreview, {
    kind: "meeting",
    state: { status: "error" },
    onOpen() {},
    onRetry() {},
  });
  assert.match(error, /could not be loaded/);
  assert.match(error, />Retry</);
  assert.doesNotMatch(error, /no longer exists|>Open</);
  const empty = renderStatic(MentionPreview, {
    kind: "meeting",
    state: { ...ready, excerpt: "" },
    onOpen() {},
    onInsertQuote() {},
  });
  assert.doesNotMatch(empty, /Insert quote/);
  for (const html of [
    error,
    renderStatic(MentionPreview, {
      kind: "meeting",
      state: ready,
      onOpen() {},
      onInsertQuote() {},
    }),
  ]) {
    for (const button of html.matchAll(/<button[^>]*>/g)) {
      assert.match(button[0], /focus-visible:ring-2 focus-visible:ring-ring/);
      assert.doesNotMatch(button[0], /ring-ring\//);
    }
  }
});

test("mounted production node view owns deferred previews, Retry, navigation and local quote callbacks", async (t) => {
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const {
    installBrowserGlobals,
    installHookDom,
    createRendererServer,
  } = require("../lib/rendererTestHarness");
  const pending = [];
  installBrowserGlobals(t, {
    window: {
      setTimeout,
      clearTimeout,
      electronAPI: {
        getNote: (id) => new Promise((resolve, reject) => pending.push({ id, resolve, reject })),
        getTranscriptionById: (id) =>
          new Promise((resolve, reject) => pending.push({ id, resolve, reject })),
      },
    },
  });
  installHookDom(t);
  const captured = { element: null, opens: [], folders: [{ id: 3, space_id: 2 }] };
  globalThis.__mentionProbe = captured;
  t.after(() => delete globalThis.__mentionProbe);
  const vite = await createRendererServer(t, {
    resolveAlias: {
      "@tiptap/react": "\0mock:@tiptap/react",
      "react-i18next": "\0mock:react-i18next",
    },
    mockModules: {
      "@tiptap/react": `export const NodeViewWrapper = ({children}) => { globalThis.__mentionProbe.element = children; return null; };`,
      "react-i18next": `const t = key => key; const i18n = { language: 'en' }; export const useTranslation = () => ({ t, i18n });`,
      "../workspaceNavigation": `export const useWorkspaceNavigation = () => ({ openNote: id => globalThis.__mentionProbe.opens.push(['note', id]), openTranscript: id => globalThis.__mentionProbe.opens.push(['dictation', id]), openFolder: (space,id) => globalThis.__mentionProbe.opens.push(['folder',space,id]) });`,
      "../../stores/noteStore": `export const getFoldersValue = () => globalThis.__mentionProbe.folders;`,
    },
  });
  const { default: MentionChip } = await vite.ssrLoadModule("/components/ui/MentionChip.tsx");
  let root = createRoot(globalThis.document.documentElement);
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const inserted = [];
  let node = { attrs: { kind: "meeting", entityId: "17", label: "A", email: null } };
  let editor = {
    isDestroyed: false,
    isEditable: true,
    state: { doc: { nodeAt: () => node, resolve: () => ({ after: () => 12 }) } },
    chain: () => ({
      focus() {
        return this;
      },
      insertContentAt(pos, content) {
        inserted.push({ pos, content });
        return this;
      },
      run() {},
    }),
  };
  const render = async (attrs = {}) => {
    node = { attrs: { ...node.attrs, ...attrs } };
    await React.act(async () =>
      root.render(React.createElement(MentionChip, { node, editor, getPos: () => 3 }))
    );
  };
  const act = (fn) =>
    React.act(async () => {
      fn();
      await Promise.resolve();
    });
  const card = () => captured.element.props.children[1]?.props?.children;
  await render();
  await act(() => captured.element.props.onFocus());
  assert.equal(pending[0].id, 17);
  await render({ entityId: "38", label: "B" });
  assert.equal(card().props.state.status, "loading");
  await act(() =>
    pending[1].resolve({ title: "B", content: "**B quote**", created_at: "2026-10-19" })
  );
  assert.equal(card().props.state.title, "B");
  const old = card().props;
  await act(() => pending[0].resolve({ title: "A", content: "A quote", created_at: "2026-10-19" }));
  assert.equal(card().props.state.title, "B", "A cannot take over B");
  await act(() => old.onInsertQuote());
  assert.equal(inserted[0].content.content[0].content[0].text, "B quote");
  await act(() => old.onOpen());
  assert.deepEqual(captured.opens, [["note", 38]]);
  await render({ entityId: "39", label: "C" });
  await act(() => old.onInsertQuote());
  await act(() => old.onOpen());
  assert.equal(inserted.length, 1);
  assert.equal(captured.opens.length, 1);
  await act(() => pending[2].reject(Error("offline")));
  assert.equal(card().props.state.status, "error");
  await act(() => card().props.onRetry());
  assert.equal(card().props.state.status, "loading");
  assert.equal(pending[3].id, 39);
  await act(() => pending[3].resolve(null));
  assert.equal(card().props.state.status, "missing");
  await render({ entityId: "9007199254740993" });
  await act(() => captured.element.props.children[0].props.onClick());
  assert.equal(card().props.state.status, "error");
  assert.equal(pending.length, 4, "unsafe numeric adapter never calls preload");
  assert.equal(captured.opens.length, 1);
  await render({ kind: "folder", entityId: "3" });
  await act(() => captured.element.props.children[0].props.onClick());
  assert.deepEqual(captured.opens.at(-1), ["folder", 2, 3]);
  await render({ kind: "dictation", entityId: "311" });
  await act(() =>
    captured.element.props.onBlur({ relatedTarget: null, currentTarget: { contains: () => false } })
  );
  await act(() => pending[4].resolve({ text: "late dictation", created_at: "2026-10-19" }));
  assert.equal(card(), undefined, "close prevents deferred painting");
  await act(() => captured.element.props.onFocus());
  assert.equal(card().props.state.status, "loading");
  await act(() => pending[5].resolve({ text: "ready in old editor", created_at: "2026-10-19" }));
  const prior = card().props;
  editor = { ...editor };
  await render();
  assert.equal(
    card().props.state.status,
    "loading",
    "a different editor clears the prior ready excerpt"
  );
  await act(() => prior.onInsertQuote());
  await act(() => prior.onOpen());
  assert.equal(inserted.length, 1, "old editor callback cannot quote in the new editor");
  assert.equal(captured.opens.length, 2, "old editor callback cannot navigate");
  await React.act(async () => root.unmount());
  root = null;
  await act(() => pending[6].resolve({ text: "unmounted", created_at: "2026-10-19" }));
  await act(() => prior.onOpen());
  assert.equal(captured.opens.length, 2, "unmounted callbacks are inert");
});
