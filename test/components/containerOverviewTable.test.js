const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");

// Frozen byte-for-byte from 98f1710b:src/components/notes/overview/ContainerOverview.tsx.
// Keep the flag-off baseline runnable in shallow/source-only checkouts. Only import
// resolution and TSX compilation change; render the actual predecessor component.
const ts = require("typescript");
const baseSource = ts.transpileModule(
  fs
    .readFileSync(path.join(__dirname, "../fixtures/containerOverviewPlan08Base.tsx"), "utf8")
    .replace(
      /from "(\.[^"]+)"/g,
      (_, specifier) => `from "${path.posix.resolve("/components/notes/overview", specifier)}"`
    ),
  {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  }
).outputText;
const SPACE = { id: 1, kind: "private", name: "Personal" };
const NOTE = {
  id: 4,
  title: "Fixture",
  content: "Original note context",
  updated_at: "2026-10-20",
  note_type: "personal",
};
const READY = {
  id: "chat",
  kind: "text",
  locality: "remote",
  providerId: "openai",
  model: "fixture-model",
  host: "api.example.test",
  state: { status: "ready" },
  settingsPath: "llms",
};
const act = (fn) =>
  React.act(async () => {
    await fn();
    await new Promise((r) => setTimeout(r, 0));
  });

async function setup(t, { labsTable = false, storedView, realTable = false } = {}) {
  let root;
  t.after(async () => {
    if (root) await act(() => root.unmount());
  });
  const calls = [],
    requests = [],
    scopes = [];
  const record =
    (name, result) =>
    async (...args) => {
      calls.push([name, ...args]);
      return typeof result === "function" ? result(...args) : result;
    };
  const api = {
    getSpaceNotes: record("getSpaceNotes", [NOTE]),
    getConversationsForContainer: record("getConversationsForContainer", []),
    createAgentConversation: record("createAgentConversation", { id: 7 }),
    addAgentMessage: record("addAgentMessage", (_id, _role, _content) => ({ id: 9 })),
    getRelevantNotes: record("getRelevantNotes", []),
    getTableBoard: record("getTableBoard", {
      spaceId: 1,
      cards: [],
      inbox: [],
      links: [],
      viewport: null,
      truncated: false,
    }),
  };
  const { storage } = installBrowserGlobals(t, {
    initialStorage: {
      ...(labsTable ? { labsTable: "true" } : {}),
      ...(storedView ? { "notes.overview.view.1": storedView } : {}),
    },
    window: { electronAPI: api, matchMedia: () => ({ matches: false }) },
  });
  installHookDom(t);
  const tree = installTree();
  globalThis.__overviewRequests = requests;
  globalThis.__overviewScopes = scopes;
  globalThis.__overviewDiagnostics = [];
  globalThis.__overviewNotes = { notes: [NOTE], byContainer: {} };
  t.after(() => {
    for (const k of [
      "__overviewRequests",
      "__overviewScopes",
      "__overviewDiagnostics",
      "__overviewNotes",
      "__overviewAsk",
      "__toasts",
    ])
      delete globalThis[k];
  });
  const mocks = {
    "/BaseContainerOverview.tsx": baseSource,
    "/stores/noteStore": `export const useFolders=()=>[];export const useNotes=()=>globalThis.__overviewNotes.notes;export const useNotesByContainer=()=>globalThis.__overviewNotes.byContainer;export const useFolderCounts=()=>({});export const useSpaceRootCounts=()=>({1:1});`,
    "/lib/routes": `export const useResolvedRoute=()=>(${JSON.stringify(READY)});export const resolveRoute=()=>(${JSON.stringify(READY)});export const routeSnapshotFromSettings=()=>({});`,
    "/services/ReasoningService": `export default {async *processTextStreamingAI(...args){globalThis.__overviewRequests.push(args);yield {type:'content',text:'Fixture answer'};},cancelActiveStream(){}};`,
    "/services/tools": `export const createToolRegistry=(o)=>{globalThis.__overviewScopes.push(o.searchScope);return {getAll:()=>[],toAISDKFormat:()=>({})};};`,
    "/utils/logger": `export default {error(...a){globalThis.__overviewDiagnostics.push(a);},warn(){},debug(){},info(){}};`,
    "/ui/useToast": TOAST_MOCK,
    "/OverviewAskSection": `import React from 'react';export function OverviewAskSection(p){globalThis.__overviewAsk=p;return React.createElement('section',{'data-queue-key':p.queueKey},p.messages?.map(m=>React.createElement('p',{key:m.id},m.content)));}`,
    "/OverviewNoteList": `import React from 'react';export const OverviewNoteList=({notes})=>React.createElement('div',null,notes.map(n=>React.createElement('p',{key:n.id},n.title)));`,
    "/OverviewExplainerBanner": `export const OverviewExplainerBanner=()=>null;`,
    "/ContainerIcon": `export const ContainerIcon=()=>null;`,
    "/SpaceIconButton": `export const SpaceIconButton=()=>null;`,
    "/TableCanvas": `export const TableCanvas=()=>null;`,
  };
  if (!realTable)
    mocks["/table/TableView"] =
      `import React from 'react';export default function TableView(p){return React.createElement('div',{'data-table-view':''},p.viewSwitch);}`;
  const vite = await createRendererServer(t, rendererOptions("loqui-overview-table-", mocks));
  const store = await vite.ssrLoadModule("/stores/settingsStore.ts");
  store.useSettingsStore.setState({
    labsTable,
    chatAgentMode: "providers",
    chatAgentProvider: "openai",
    chatAgentModel: "fixture-model",
    isSignedIn: false,
  });
  const { ContainerOverview: Current } = await vite.ssrLoadModule(
    "/components/notes/overview/ContainerOverview.tsx"
  );
  const { ContainerOverview: Previous } = await vite.ssrLoadModule("/BaseContainerOverview.tsx");
  const props = { space: SPACE, folder: null, onOpenNote() {}, onNewNote() {}, onAddExisting() {} };
  return {
    Current,
    Previous,
    props,
    storage,
    store,
    tree,
    calls,
    requests,
    scopes,
    html: (Component = Current, overrides = {}) =>
      renderToStaticMarkup(React.createElement(Component, { ...props, ...overrides })),
    async mount(Component = Current, overrides = {}) {
      root ??= createRoot(tree.container);
      await act(() => root.render(React.createElement(Component, { ...props, ...overrides })));
    },
    async unmount() {
      await act(() => root.unmount());
      root = null;
    },
    async flag(value) {
      await act(() => store.useSettingsStore.setState({ labsTable: value }));
    },
  };
}

test("Labs off renders the immutable BASE overview exactly even with a remembered Table", async (t) => {
  const c = await setup(t, { storedView: "table" });
  assert.equal(c.html(), c.html(c.Previous));
  assert.doesNotMatch(c.html(), /table\.view\.|data-table-view/);
});
test("Labs root offers List first with pressed-state buttons; junk defaults to List", async (t) => {
  const c = await setup(t, { labsTable: true, storedView: "spreadsheet" });
  assert.match(c.html(), /role="group"[^>]*aria-label="table\.view\.label"/);
  assert.match(c.html(), /aria-pressed="true"[^>]*>table\.view\.list</);
  assert.match(c.html(), /aria-pressed="false"[^>]*>table\.view\.table</);
  assert.doesNotMatch(c.html(), /data-table-view/);
});
test("remembered Table includes the switch; folders never offer or mount Table", async (t) => {
  const c = await setup(t, { labsTable: true, storedView: "table" });
  assert.match(c.html(), /data-table-view/);
  assert.match(c.html(), /aria-pressed="true"[^>]*>table\.view\.table</);
  const folder = { id: 3, name: "Meetings", space_id: 1, is_default: 1 };
  assert.equal(c.html(c.Current, { folder }), c.html(c.Previous, { folder }));
});
test("mounted switch persists independently per Space across host-key remounts and flag changes", async (t) => {
  const c = await setup(t, { labsTable: true });
  await c.mount();
  await c.tree.click("table.view.table");
  assert.equal(c.storage.getItem("notes.overview.view.1"), "table");
  assert.ok(c.tree.find((n) => n.attributes?.["data-table-view"] !== undefined));
  await c.flag(false);
  assert.doesNotMatch(c.tree.text(), /table\.view\./);
  await c.flag(true);
  assert.ok(c.tree.find((n) => n.attributes?.["data-table-view"] !== undefined));
  await c.unmount();
  await c.mount(c.Current, { space: { ...SPACE, id: 2 } });
  assert.equal(
    c.tree.find((n) => n.tagName === "BUTTON" && n.textContent === "table.view.list").attributes[
      "aria-pressed"
    ],
    "true"
  );
  await c.tree.click("table.view.table");
  await c.tree.click("table.view.list");
  assert.equal(c.storage.getItem("notes.overview.view.2"), "list");
  await c.unmount();
  await c.mount();
  assert.ok(c.tree.find((n) => n.attributes?.["data-table-view"] !== undefined));
});

test("real mounted consumer makes no Table IPC when off; toggling off restores BASE calls, queue and request", async (t) => {
  const c = await setup(t, { realTable: true, storedView: "table" });
  async function ordinary(Component) {
    c.calls.length = c.requests.length = c.scopes.length = 0;
    await c.mount(Component);
    const queueKey = globalThis.__overviewAsk.queueKey;
    const initialCallCount = c.calls.length;
    let sent;
    await act(async () => {
      sent = await globalThis.__overviewAsk.onTextSubmit("Explain fixture");
    });
    assert.equal(sent, true);
    const result = structuredClone({
      calls: c.calls,
      sendCalls: c.calls.slice(initialCallCount),
      requests: c.requests,
      scopes: c.scopes,
      queueKey,
      text: c.tree.text(),
    });
    await c.unmount();
    return result;
  }
  const before = await ordinary(c.Previous);
  assert.deepEqual(await ordinary(c.Current), before);
  await c.mount();
  await c.flag(true);
  assert.equal(
    c.calls.filter(([name]) => name === "getTableBoard").length,
    1,
    "real Table board mounted"
  );
  await c.flag(false);
  const tableCalls = c.calls.filter(([name]) => /Table/.test(name)).length;
  await act(() => c.store.useSettingsStore.setState({ isSignedIn: false }));
  assert.equal(c.calls.filter(([name]) => /Table/.test(name)).length, tableCalls);
  assert.doesNotMatch(c.tree.text(), /table\.view\./);
  assert.equal(globalThis.__overviewAsk.queueKey, before.queueKey);
  c.calls.length = c.requests.length = c.scopes.length = 0;
  await act(async () => {
    assert.equal(await globalThis.__overviewAsk.onTextSubmit("Explain fixture"), true);
  });
  assert.deepEqual(
    c.calls,
    before.sendCalls,
    "same-mounted toggled-off typed IPC payloads match BASE"
  );
  assert.deepEqual(
    c.requests,
    before.requests,
    "same-mounted request history/context/inference match BASE"
  );
  assert.deepEqual(c.scopes, before.scopes);
  assert.equal(c.tree.text(), before.text);
  await c.unmount();
  assert.deepEqual(await ordinary(c.Current), before);
  assert.deepEqual(globalThis.__overviewDiagnostics, []);
});
