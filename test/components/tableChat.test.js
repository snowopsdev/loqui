const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { createDb } = require("../helpers/harness/db");
const DatabaseManager = require("../../src/helpers/database");
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");
const act = (fn) =>
  React.act(async () => {
    await fn();
    await new Promise((r) => setTimeout(r, 0));
  });
function deferred() {
  let resolve, reject;
  const promise = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}
const item = (id, type = "note", text = "A source") => ({
  ref: { type, id },
  kind: type,
  title: "Source " + id,
  excerpt: text,
  at: "2026-10-20",
  durationMs: null,
  participants: [],
  hrefs: [],
  noteId: null,
  layout: null,
});
const READY = {
  id: "chat",
  kind: "text",
  locality: "remote",
  providerId: "openai",
  provider: "OpenAI",
  model: "fixture-model",
  host: "api.example.test",
  state: { status: "ready" },
  settingsPath: "llms",
  sends: "",
};
const MOCKS = {
  "/lib/routes": `export const useResolvedRoute=()=>globalThis.__tableRoute;export const resolveRoute=()=>globalThis.__tableRoute;export const routeSnapshotFromSettings=()=>({});`,
  "/services/ReasoningService": `export default {processTextStreamingAI(...args){return globalThis.__tableStream(...args);},cancelActiveStream(){}};`,
  "/services/tools": `export const createToolRegistry=(options)=>{globalThis.__tableToolScopes.push(options.searchScope);return {getAll:()=>[],toAISDKFormat:()=>({})};};`,
  "/ui/useToast": TOAST_MOCK,
  "/useVoiceDraft": `export const useVoiceDraft=()=>({status:'idle',start(){},stop(){},cancel(){},elapsed:0,readLevel:()=>0});`,
  "/chat/ChatMessages": `import React from 'react';export const ChatMessages=({messages})=>React.createElement('div',null,messages.map(m=>React.createElement('p',{key:m.id},m.content)));`,
  "/ConversationPicker": `import React from 'react';export const ConversationPicker=({onNewChat,onSwitchConversation})=>React.createElement('div',null,React.createElement('button',{onClick:onNewChat},'NEW'),React.createElement('button',{onClick:()=>onSwitchConversation(8)},'SWITCH B'));`,
  "/routing/RouteChips": `import React from 'react';export const RouteDestinationChip=({route})=>React.createElement('span',{'data-destination':route.providerId},route.providerId);export const RouteStateChip=({state})=>React.createElement('span',null,state.status);`,
  "/utils/logger": `export default {error(...args){globalThis.__tableDiagnostics.push(args);},warn(){},debug(){},info(){}};`,
};
async function setup(t, { api = {}, creation, write, stream, board, spaceId = 3 } = {}) {
  let root;
  t.after(async () => {
    if (root) await act(() => root.unmount());
  });
  const saved = [],
    creates = [],
    places = [],
    links = [],
    requests = [];
  let nextId = 7;
  let currentBoard = board ?? {
    spaceId: 3,
    cards: [item(1), item(2)],
    inbox: [],
    links: [],
    viewport: null,
    truncated: false,
  };
  const histories = new Map([
    [7, []],
    [8, [{ role: "user", content: "B private history" }]],
  ]);
  const bridge = {
    getTableBoard: async () => structuredClone(currentBoard),
    createAgentConversation: async (...args) => {
      creates.push(args);
      return creation ? creation.promise : { id: nextId++ };
    },
    getConversationsForContainer: async () => [
      { id: 7, title: "A" },
      { id: 8, title: "B" },
    ],
    getAgentConversation: async (id) => ({ id, messages: histories.get(id) ?? [] }),
    addAgentMessage: async (id, role, content, metadata) => {
      if (write && role === "user") await write.promise;
      saved.push({ id, role, content, metadata });
      histories.set(id, [...(histories.get(id) ?? []), { role, content }]);
      return { id: saved.length };
    },
    placeTableCards: async (s, p) => {
      places.push({ s, p });
      return { success: true, placed: p.length, placedKeys: p.map((r) => `${r.type}:${r.id}`) };
    },
    linkTableCards: async (s, a, b) => {
      links.push({ s, a, b });
      return { success: true };
    },
    getRelevantNotes: async () => [],
    ...api,
  };
  installBrowserGlobals(t, { window: { electronAPI: bridge } });
  installHookDom(t);
  const tree = installTree();
  const make = globalThis.document.createElement;
  globalThis.document.createElement = (...args) => {
    const n = make(...args);
    n.style.setProperty = (k, v) => (n.style[k] = v);
    n.style.removeProperty = (k) => delete n.style[k];
    n.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 800 });
    n.hasPointerCapture = () => false;
    n.setPointerCapture = () => {};
    n.releasePointerCapture = () => {};
    n.contains = () => false;
    n.focus = () => {
      globalThis.document.activeElement = n;
    };
    n.isConnected = true;
    Object.defineProperty(n, "dataset", {
      get: () => ({ cardKey: n.attributes["data-card-key"] }),
    });
    n.closest = (selector) => {
      const match =
        selector === "[data-card-key]"
          ? n.attributes["data-card-key"] != null
          : selector === "[data-resize-handle]" && n.attributes["data-resize-handle"] != null;
      return match ? n : (n.parentNode?.closest?.(selector) ?? null);
    };
    return n;
  };
  globalThis.window.matchMedia = () => ({ matches: false });
  globalThis.__tableRoute = { ...READY, state: { status: "ready" } };
  globalThis.__tableDiagnostics = [];
  globalThis.__tableToolScopes = [];
  globalThis.__tableStream = async function* (...args) {
    requests.push(args);
    if (stream) yield* stream(...args);
    else yield { type: "content", text: "A reply" };
  };
  t.after(() => {
    for (const k of [
      "__tableRoute",
      "__tableStream",
      "__tableDiagnostics",
      "__tableToolScopes",
      "__toasts",
    ])
      delete globalThis[k];
  });
  const vite = await createRendererServer(t, rendererOptions("loqui-table-chat-", MOCKS));
  const store = await vite.ssrLoadModule("/stores/settingsStore.ts");
  store.useSettingsStore.setState({
    chatAgentMode: "providers",
    chatAgentProvider: "openai",
    chatAgentModel: "fixture-model",
    isSignedIn: false,
  });
  const { default: View } = await vite.ssrLoadModule("/components/table/TableView.tsx");
  root = createRoot(tree.container);
  const props = {
    space: { id: spaceId, name: "Original space", kind: "private" },
    onOpenNote() {},
    viewSwitch: React.createElement("span", null, "LIST"),
  };
  const render = () => act(() => root.render(React.createElement(View, { ...props })));
  await render();
  const node = (pred) => tree.find(pred);
  const button = (label) =>
    node(
      (n) =>
        n.tagName === "BUTTON" && (n.textContent === label || n.attributes["aria-label"] === label)
    );
  const click = (label) =>
    act(() => {
      const n = button(label);
      assert.ok(n, `button ${label}`);
      void tree.props(n).onClick();
    });
  const select = async (id = 1) =>
    act(() => {
      const canvas = node((n) => n.attributes.role === "listbox");
      const card = node((n) => n.attributes["data-card-key"] === `note:${id}`);
      assert.ok(card);
      tree.props(canvas).onKeyDown({
        key: " ",
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        target: card,
        preventDefault() {},
      });
    });
  const value = () => tree.props(node((n) => n.tagName === "TEXTAREA"))?.value;
  return {
    tree,
    store,
    vite,
    render,
    rawUnmount: () => {
      root.unmount();
      root = null;
    },
    rawRender: () => root.render(React.createElement(View, { ...props })),
    saved,
    creates,
    places,
    links,
    requests,
    bridge,
    props,
    select,
    click,
    button,
    route: async (state) => {
      globalThis.__tableRoute = { ...globalThis.__tableRoute, ...state };
      await render();
    },
    type: (v) =>
      act(() =>
        tree.props(node((n) => n.tagName === "TEXTAREA")).onChange({ target: { value: v } })
      ),
    enter: () =>
      act(() =>
        tree.props(node((n) => n.tagName === "TEXTAREA")).onKeyDown({
          key: "Enter",
          shiftKey: false,
          nativeEvent: { isComposing: false, keyCode: 13 },
          preventDefault() {},
        })
      ),
    value,
    setBoard: (b) => {
      currentBoard = b;
    },
    unmount: async () => {
      await act(() => root.unmount());
      root = null;
    },
  };
}
test("selection summary saves once and result links bind admitted A after A→B→new-null", async (t) => {
  const creation = deferred(),
    write = deferred(),
    end = deferred();
  const c = await setup(t, {
    creation,
    write,
    stream: async function* () {
      yield { type: "content", text: "A partial" };
      await end.promise;
      yield { type: "content", text: " tail" };
    },
  });
  await c.select();
  await c.click("table.selection.summarise");
  assert.equal(c.creates.length, 1);
  await c.click("SWITCH B");
  await c.click("NEW");
  await c.type("newer words");
  await act(() => creation.resolve({ id: 7 }));
  assert.equal(c.requests.length, 0);
  await act(() => c.store.useSettingsStore.setState({ chatAgentModel: "changed-after-admission" }));
  await act(() => write.resolve());
  assert.equal(c.requests.length, 1);
  assert.equal(c.requests[0][1], "fixture-model");
  assert.match(c.requests[0][3].systemPrompt, /A source/);
  assert.doesNotMatch(c.requests[0][3].systemPrompt, /B private/);
  assert.equal(c.places[0].p[0].id, 7);
  assert.deepEqual(
    c.links.map((l) => l.a),
    [{ type: "note", id: 1 }]
  );
  await act(() => end.resolve());
  assert.deepEqual(
    c.saved.map((m) => [m.id, m.role]),
    [
      [7, "user"],
      [7, "assistant"],
    ]
  );
  assert.equal(c.saved[1].content, "A partial tail");
  assert.equal(c.value(), "newer words");
  assert.deepEqual(globalThis.__tableToolScopes, [{ spaceId: 3, folderId: null }]);
  assert.equal(c.saved[1].metadata.context.route.providerId, "openai");
});
for (const kind of ["create", "save"])
  test(`summary ${kind} rejection keeps prompt and intent visibly for manual recovery`, async (t) => {
    const wait = deferred();
    const c = await setup(t, kind === "create" ? { creation: wait } : { write: wait });
    await c.select();
    await c.click("table.selection.summarise");
    await act(() => wait.reject(Error("SQLITE_FULL")));
    assert.match(c.tree.text(), /table.ask.sendFailed/);
    assert.match(c.tree.text(), /table.selection.summarisePrompt/);
    assert.equal(c.requests.length, 0);
  });
test("complete dictation detail reads main and exposes meaningful text beyond excerpt, close never places", async (t) => {
  const full = "opening ".repeat(90) + "THE MEANINGFUL TAIL";
  const calls = [];
  const d = item(9, "dictation", full.slice(0, 600));
  d.layout = { x: 32, y: 32, w: null, h: null, z: 0, hidden: false };
  const c = await setup(t, {
    board: { spaceId: 3, cards: [d], inbox: [], links: [], viewport: null, truncated: false },
    api: {
      getTranscriptionById: async (id) => {
        calls.push(id);
        return { id, text: full };
      },
    },
  });
  const canvas = c.tree.find((n) => n.attributes.role === "listbox");
  const card = c.tree.find((n) => n.attributes["data-card-key"] === "dictation:9");
  await act(() =>
    c.tree.props(canvas).onKeyDown({ key: "Enter", target: card, preventDefault() {} })
  );
  assert.deepEqual(calls, [9]);
  assert.match(c.tree.text(), /THE MEANINGFUL TAIL/);
  await c.click("table.detail.close");
  assert.equal(c.places.length, 0);
  assert.equal(d.layout.h, null);
});
module.exports = { setup, act, deferred, item, READY };
for (const invalidation of [
  "unknown",
  "blocked",
  "switch",
  "new",
  "open note",
  "reset view",
  "close Ask",
  "unmount",
])
  test(`unadmitted summary invalidated by ${invalidation} never self-sends`, async (t) => {
    const c = await setup(t);
    await c.click("table.ask.open");
    await c.select();
    await act(() => {
      c.tree.props(c.button("table.selection.summarise")).onClick();
      if (invalidation === "unmount") c.rawUnmount();
      if (invalidation === "unknown" || invalidation === "blocked") {
        globalThis.__tableRoute = {
          ...globalThis.__tableRoute,
          state: {
            status: invalidation === "unknown" ? "unknown" : "unreachable",
            detail: "sealed",
          },
        };
        c.rawRender();
      }
      if (invalidation === "switch") c.tree.props(c.button("SWITCH B")).onClick();
      if (invalidation === "new") c.tree.props(c.button("NEW")).onClick();
      if (invalidation === "close Ask") c.tree.props(c.button("table.ask.close")).onClick();
      if (invalidation === "reset view") c.tree.props(c.button("table.resetView")).onClick();
      if (invalidation === "open note") {
        const canvas = c.tree.find((n) => n.attributes.role === "listbox");
        const card = c.tree.find((n) => n.attributes["data-card-key"] === "note:1");
        c.tree.props(canvas).onKeyDown({ key: "Enter", target: card, preventDefault() {} });
      }
    });
    if (invalidation === "unmount") {
      assert.equal(c.creates.length, 0);
      return;
    }
    assert.equal(c.creates.length, 0);
    assert.equal(c.saved.length, 0);
    assert.equal(c.requests.length, 0);
    if (["unknown", "blocked"].includes(invalidation)) {
      await c.route({ state: { status: "ready" } });
      assert.equal(c.requests.length, 0);
      assert.match(c.tree.text(), /table.ask.invalidated|table.ask.sendFailed/);
    }
  });
for (const field of ["vertexProject", "vertexLocation", "vertexAuthSource"])
  test(`same-host enterprise ${field} authority change disarms queued summary`, async (t) => {
    const c = await setup(t);
    const { ROUTE_ENTERPRISE_KEYS } = await c.vite.ssrLoadModule("/lib/providerSwitchPlans.ts");
    const current = Object.fromEntries(
      ROUTE_ENTERPRISE_KEYS.map((key) => [key, c.store.useSettingsStore.getState()[key]])
    );
    await act(() => {
      globalThis.__tableRoute = {
        ...READY,
        providerId: "vertex",
        host: "aiplatform.googleapis.com",
      };
      c.store.useSettingsStore.setState({ chatAgentProvider: "vertex" });
      assert.equal(c.store.reconcileEnterpriseRouteState({ current, version: 1 }), true);
    });
    await c.render();
    await c.click("table.ask.open");
    await c.select();
    await act(() => {
      c.tree.props(c.button("table.selection.summarise")).onClick();
      const changed = {
        ...current,
        [field]: field === "vertexAuthSource" ? "apiKey" : "changed-same-host",
      };
      assert.equal(c.store.reconcileEnterpriseRouteState({ current: changed, version: 2 }), true);
    });
    assert.equal(c.creates.length, 0);
    assert.equal(c.requests.length, 0);
    assert.match(c.tree.text(), /table.ask.invalidated|table.ask.sendFailed/);
  });
test("busy false retains actual typed words and pinned intent, without an extra user row", async (t) => {
  const creation = deferred();
  const c = await setup(t, { creation });
  await c.select();
  await c.click("table.selection.ask");
  await c.type("first words");
  await c.enter();
  await c.type("busy words");
  await c.enter();
  assert.equal(c.value(), "busy words");
  assert.match(c.tree.text(), /table.ask.sendFailed/);
  assert.equal(c.creates.length, 1);
  await act(() => creation.resolve({ id: 7 }));
  assert.deepEqual(
    c.saved.filter((m) => m.role === "user").map((m) => m.content),
    ["first words"]
  );
});
test("busy queued Ask freezes the source context before board updates, route changes drop it", async (t) => {
  const finish = deferred();
  let calls = 0;
  const c = await setup(t, {
    stream: async function* () {
      calls++;
      yield { type: "content", text: "first" };
      if (calls === 1) await finish.promise;
    },
  });
  await c.select();
  await c.click("table.selection.ask");
  await c.type("first question");
  await c.enter();
  await c.type("queued original words");
  await c.enter();
  assert.match(c.tree.text(), /agentMode.input.queued/);
  c.setBoard({
    spaceId: 3,
    cards: [item(1, "note", "CHANGED source"), item(2)],
    inbox: [],
    links: [],
    viewport: null,
    truncated: false,
  });
  // A note lifecycle event is separately covered by board tests; a route transition must disarm this real composer queue.
  await c.route({ state: { status: "unknown" } });
  await c.route({ state: { status: "ready" } });
  await act(() => finish.resolve());
  assert.equal(c.requests.length, 1);
  assert.equal(c.value(), "queued original words");
  assert.match(c.tree.text(), /agentMode.input.queueDropped/);
});
test("accepted reply failure is consumed once, with manual composer words preserved", async (t) => {
  const c = await setup(t, {
    stream: async function* () {
      yield* [];
      throw Error("fixture stream failure");
    },
  });
  await c.select();
  await c.click("table.selection.summarise");
  assert.equal(c.saved.filter((m) => m.role === "user").length, 1);
  assert.equal(c.places.length, 1);
  assert.doesNotMatch(c.tree.text(), /table.ask.sendFailed/);
  assert.equal(globalThis.__tableDiagnostics.length, 1);
  await c.render();
  assert.equal(c.saved.filter((m) => m.role === "user").length, 1);
});
for (const kind of ["group", "answer"])
  test(`real full-board ${kind}: new content survives TABLE_FULL, no false links`, async (t) => {
    const db = createDb(t);
    assert.ok(db);
    const spaceId = db.getPrivateSpaceId();
    const notes = [];
    for (let n = 0; n < 500; n++)
      notes.push(
        db.saveNote("N" + n, "preserved original " + n, "personal", null, null, null, spaceId).note
      );
    db.placeTableCards(
      spaceId,
      notes.map((n, i) => ({ type: "note", id: n.id, x: i * 8, y: 0 }))
    );
    const links = [];
    let savedNote;
    const c = await setup(t, {
      spaceId,
      api: {
        getTableBoard: async (s) => db.getTableBoard(s),
        saveNote: async (...args) => {
          const result = db.saveNote(...args);
          savedNote = result.note;
          return result;
        },
        createAgentConversation: async (...args) => db.createAgentConversation(...args),
        addAgentMessage: async (...args) => db.addAgentMessage(...args),
        placeTableCards: async (s, p) => db.placeTableCards(s, p),
        linkTableCards: async (...args) => {
          links.push(args);
          return db.linkTableCards(...args);
        },
      },
    });
    await c.select(notes[0].id);
    await c.click(kind === "group" ? "table.selection.group" : "table.selection.summarise");
    assert.match(c.tree.text(), /table.status.full/);
    assert.deepEqual(links, []);
    assert.equal(db.getTableBoard(spaceId).cards.length, 500);
    if (kind === "group")
      assert.ok(db.getNote(savedNote.id).content.includes("preserved original"));
    else {
      const list = db.getConversationsForContainer(spaceId, null);
      assert.ok(list.length);
      assert.equal(db.getAgentConversation(list[0].id).messages.length, 2);
    }
    const reopened = new DatabaseManager();
    t.after(() => reopened.db.close());
    assert.deepEqual(db.getTableBoard(spaceId), reopened.getTableBoard(spaceId));
  });
test("unknown route keeps Ask editable but disables its send control before admission", async (t) => {
  const c = await setup(t);
  await c.click("table.ask.open");
  await c.type("keep these words");
  await c.route({ state: { status: "unknown" } });
  const send = c.tree.find((n) => n.attributes["aria-label"] === "agentMode.input.send");
  assert.equal(c.tree.props(send).disabled, true);
  assert.equal(c.value(), "keep these words");
  assert.equal(c.requests.length, 0);
});
test("queued whole-table words use their frozen excerpts after a real lifecycle reload", async (t) => {
  const end = deferred();
  let call = 0,
    reload;
  const c = await setup(t, {
    api: {
      onNoteUpdated: (fn) => {
        reload = fn;
        return () => {};
      },
    },
    stream: async function* () {
      yield { type: "content", text: "reply" };
      if (++call === 1) await end.promise;
    },
  });
  await c.click("table.ask.open");
  await c.type("first");
  await c.enter();
  await c.type("queued with original sources");
  await c.enter();
  c.setBoard({
    spaceId: 3,
    cards: [item(1, "note", "UNSEEN replacement source")],
    inbox: [],
    links: [],
    viewport: null,
    truncated: false,
  });
  await act(async () => {
    reload();
    await new Promise((r) => setTimeout(r, 275));
  });
  await act(() => end.resolve());
  assert.equal(c.requests.length, 2);
  assert.match(c.requests[1][3].systemPrompt, /A source/);
  assert.doesNotMatch(c.requests[1][3].systemPrompt, /UNSEEN replacement/);
  assert.equal(c.value(), "");
});
for (const finish of ["stop", "unmount"])
  test(`Table ${finish} keeps accepted user and original partial-persistence policy`, async (t) => {
    const end = deferred();
    const c = await setup(t, {
      stream: async function* () {
        yield { type: "content", text: "visible partial" };
        await end.promise;
      },
    });
    await c.select();
    await c.click("table.selection.summarise");
    if (finish === "stop") await c.click("common.cancel");
    else await c.unmount();
    await act(() => end.resolve());
    assert.equal(c.saved[0].id, 7);
    assert.equal(c.saved[0].role, "user");
    assert.equal(
      c.saved.filter((m) => m.role === "assistant").length,
      finish === "unmount" ? 1 : 0
    );
    if (finish === "unmount") assert.equal(c.saved[1].content, "visible partial");
  });
test("group freezes sources and position before save; changing selection never retargets links", async (t) => {
  const saved = deferred();
  const c = await setup(t, { api: { saveNote: () => saved.promise } });
  await c.select(1);
  await c.click("table.selection.group");
  await c.select(2);
  await act(() => saved.resolve({ success: true, note: { id: 55 } }));
  assert.deepEqual(
    c.links.map((l) => l.a),
    [{ type: "note", id: 1 }]
  );
  assert.equal(c.places[0].p[0].id, 55);
  assert.equal(c.places[0].p[0].x, 32);
});
for (const failure of ["false", "absent", "reject"])
  test(`group save ${failure} reports localized failure without content deletion or links`, async (t) => {
    const api = {
      saveNote:
        failure === "absent"
          ? undefined
          : async () => {
              if (failure === "reject") throw Error("write failed");
              return { success: false };
            },
    };
    const c = await setup(t, { api });
    await c.select();
    await c.click("table.selection.group");
    assert.match(c.tree.text(), /table.status.saveFailed/);
    assert.equal(c.places.length, 0);
    assert.equal(c.links.length, 0);
    assert.match(c.tree.text(), /Source 1/);
  });
for (const kind of ["group", "answer"])
  test(`new unseen ${kind} reconciles the real arranged-first500 projection after full ACK`, async (t) => {
    const db = createDb(t);
    assert.ok(db);
    const spaceId = db.getPrivateSpaceId();
    let latest;
    for (let n = 0; n < 500; n++)
      latest = db.saveNote(
        "N" + n,
        "durable body " + n,
        "personal",
        null,
        null,
        null,
        spaceId
      ).note;
    let created;
    const c = await setup(t, {
      spaceId,
      api: {
        getTableBoard: async (s) => db.getTableBoard(s),
        saveNote: async (...args) => {
          const res = db.saveNote(...args);
          created = { type: "note", id: res.note.id };
          return res;
        },
        createAgentConversation: async (...args) => {
          const res = db.createAgentConversation(...args);
          created = { type: "chat", id: res.id };
          return res;
        },
        addAgentMessage: async (...args) => db.addAgentMessage(...args),
        placeTableCards: async (...args) => db.placeTableCards(...args),
        linkTableCards: async (...args) => db.linkTableCards(...args),
      },
    });
    await c.select(latest.id);
    await c.click(kind === "group" ? "table.selection.group" : "table.selection.summarise");
    const canonical = db.getTableBoard(spaceId);
    assert.equal(canonical.cards.length, 500);
    assert.equal(canonical.cards[0].ref.type, created.type);
    assert.equal(canonical.cards[0].ref.id, created.id);
    assert.ok(canonical.cards[0].layout);
    assert.ok(canonical.links.some((l) => l.a.id === latest.id || l.b.id === latest.id));
    assert.match(c.tree.text(), /table.status.truncated/);
    const card = c.tree.find(
      (n) => n.attributes["data-card-key"] === `${created.type}:${created.id}`
    );
    assert.ok(card);
    assert.equal(c.tree.props(card).style.left, canonical.cards[0].layout.x);
    const reopened = new DatabaseManager();
    t.after(() => reopened.db.close());
    assert.deepEqual(canonical, reopened.getTableBoard(spaceId));
  });
test("dictation double-click focuses a complete reader; Escape closes and restores card focus", async (t) => {
  const full = "long words ".repeat(70) + "FINAL DECISION TAIL";
  const d = item(9, "dictation", full.slice(0, 600));
  const c = await setup(t, {
    board: { spaceId: 3, cards: [d], inbox: [], links: [], viewport: null, truncated: false },
    api: { getTranscriptionById: async () => ({ id: 9, text: full }) },
  });
  const canvas = c.tree.find((n) => n.attributes.role === "listbox");
  const card = c.tree.find((n) => n.attributes["data-card-key"] === "dictation:9");
  globalThis.document.activeElement = card;
  globalThis.document.elementFromPoint = () => card;
  await act(() => c.tree.props(canvas).onDoubleClick({ clientX: 50, clientY: 60 }));
  const detail = c.tree.find((n) => n.attributes.role === "region");
  assert.ok(detail);
  assert.equal(globalThis.document.activeElement, detail);
  assert.match(detail.textContent, /FINAL DECISION TAIL/);
  await act(() => c.tree.props(detail).onKeyDown({ key: "Escape", stopPropagation() {} }));
  assert.equal(
    c.tree.find((n) => n.attributes.role === "region"),
    null
  );
  assert.equal(globalThis.document.activeElement, card);
  assert.equal(c.places.length, 0);
});
test("blocked selection actions retain the actual readiness explanation on the Table", async (t) => {
  const c = await setup(t);
  await c.select();
  await c.route({ state: { status: "needsKey", provider: "OpenAI" } });
  const bar = c.tree.find(
    (n) =>
      n.attributes.role === "toolbar" &&
      n.attributes["aria-label"]?.startsWith("table.selection.count")
  );
  assert.match(bar.textContent, /needsKey/);
  assert.equal(c.tree.props(c.button("table.selection.summarise")).disabled, true);
});

for (const prior of ["natural", "explicit", "widthOnly"])
  test(`Task9 actual consumer + SQLite: ${prior} resize cancel detail nudge and reopen, then keyboard/pointer size persists`, async (t) => {
    const db = createDb(t);
    assert.ok(db);
    const spaceId = db.getPrivateSpaceId();
    const full =
      "Minutes from the planning discussion. ".repeat(40) +
      "FINAL ACTION: publish the accessibility checklist on Friday.";
    const id = db.saveTranscription(full, full).id;
    const key = `dictation:${id}`;
    const original =
      prior === "explicit"
        ? { w: 304, h: 184 }
        : prior === "widthOnly"
          ? { w: 304, h: null }
          : { w: null, h: null };
    db.placeTableCards(spaceId, [{ type: "dictation", id, x: 32, y: 32, ...original }]);
    const writes = [],
      detailReads = [];
    const c = await setup(t, {
      spaceId,
      api: {
        getTableBoard: async (s) => db.getTableBoard(s),
        placeTableCards: async (s, p) => {
          writes.push(structuredClone(p));
          return db.placeTableCards(s, p);
        },
        getTranscriptionById: async (id) => {
          detailReads.push(id);
          return db.getTranscriptionById(id);
        },
      },
    });
    const frames = new Map();
    let frameId = 0;
    globalThis.requestAnimationFrame = (fn) => {
      frames.set(++frameId, fn);
      return frameId;
    };
    globalThis.cancelAnimationFrame = (id) => frames.delete(id);
    const flush = () =>
      act(() => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((fn) => fn());
      });
    const canvas = () => c.tree.find((n) => n.attributes.role === "listbox");
    const card = () => c.tree.find((n) => n.attributes["data-card-key"] === key);
    const handle = () => c.tree.find((n) => n.attributes["data-resize-handle"] != null);
    const event = (name, target, over = {}) =>
      act(() => {
        const handler = c.tree.props(canvas())[name];
        return handler({
          target,
          currentTarget: canvas(),
          button: 0,
          pointerId: 1,
          clientX: 0,
          clientY: 0,
          shiftKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          preventDefault() {},
          ...over,
        });
      });
    const layout = () => db.getTableBoard(spaceId).cards.find((e) => e.ref.id === id).layout;
    const style = () => c.tree.props(card()).style;
    await event("onPointerDown", handle());
    await event("onPointerMove", handle(), { clientX: 80, clientY: -400 });
    await flush();
    assert.equal(style().height, 80);
    await event("onPointerCancel", handle());
    assert.equal(style().height, original.h ?? undefined);
    assert.equal(style().overflow, original.h === null ? undefined : "hidden");
    assert.equal(writes.length, 0);
    // Full detail remains usable after natural-size rollback; closing never persists dimensions.
    globalThis.document.activeElement = card();
    await event("onKeyDown", card(), { key: "Enter" });
    let detail = c.tree.find((n) => n.attributes.role === "region");
    assert.equal(globalThis.document.activeElement, detail);
    assert.match(detail.textContent, /FINAL ACTION: publish the accessibility checklist on Friday/);
    await act(() => c.tree.props(detail).onKeyDown({ key: "Escape", stopPropagation() {} }));
    assert.equal(globalThis.document.activeElement, card());
    assert.equal(writes.length, 0);
    await event("onKeyDown", card(), { key: "ArrowRight", shiftKey: true });
    assert.deepEqual([layout().w, layout().h, layout().x], [original.w, original.h, 40]);
    const reopened = new DatabaseManager();
    t.after(() => reopened.db.close());
    assert.deepEqual(reopened.getTableBoard(spaceId), db.getTableBoard(spaceId));
    // The very same fixed 80px card must expose complete full text through both open paths.
    const originW = style().width;
    await event("onPointerDown", handle());
    await event("onPointerMove", handle(), { clientX: 21, clientY: -400 });
    await event("onPointerUp", handle(), { clientX: 43, clientY: -400 }); // before queued RAF
    assert.equal(frames.size, 0);
    const expectedW = Math.round((originW + 43) / 8) * 8;
    assert.deepEqual([layout().w, layout().h], [expectedW, 80]);
    assert.equal(style().height, 80);
    assert.equal(style().overflow, "hidden");
    const beforeDetail = writes.length;
    for (const open of ["Enter", "doubleclick"]) {
      globalThis.document.activeElement = card();
      if (open === "Enter") await event("onKeyDown", card(), { key: "Enter" });
      else {
        globalThis.document.elementFromPoint = card;
        await event("onDoubleClick", card(), { clientX: 50, clientY: 50 });
      }
      detail = c.tree.find((n) => n.attributes.role === "region");
      assert.ok(detail);
      assert.equal(globalThis.document.activeElement, detail);
      assert.match(
        detail.textContent,
        /FINAL ACTION: publish the accessibility checklist on Friday/
      );
      if (open === "Enter") await c.click("table.detail.close");
      else await act(() => c.tree.props(detail).onKeyDown({ key: "Escape", stopPropagation() {} }));
      assert.equal(globalThis.document.activeElement, card());
      assert.deepEqual([layout().w, layout().h], [expectedW, 80]);
    }
    assert.equal(writes.length, beforeDetail);
    assert.deepEqual(detailReads, [id, id, id]);
    await event("onKeyDown", card(), { key: "ArrowDown", altKey: true });
    assert.deepEqual([layout().w, layout().h], [expectedW, 88]);
    await event("onKeyDown", card(), { key: "ArrowRight", altKey: true });
    assert.deepEqual([layout().w, layout().h], [expectedW + 8, 88]);
    await event("onKeyDown", card(), { key: "ArrowUp", shiftKey: true });
    assert.deepEqual([layout().w, layout().h], [expectedW + 8, 88]);
    assert.deepEqual(reopened.getTableBoard(spaceId), db.getTableBoard(spaceId));
    assert.equal(reopened.getTranscriptionById(id).text, full, "D12 preserves every character");
    const count = writes.length;
    await flush();
    assert.equal(writes.length, count);
  });

test("Task9 prior override: cancel restores pending size separately from nullable SQLite layout across ACK, nudge and reopen", async (t) => {
  const db = createDb(t);
  assert.ok(db);
  const spaceId = db.getPrivateSpaceId();
  const full = "Original full content. ".repeat(50) + "Keep the meaningful tail intact.";
  const id = db.saveTranscription(full, full).id;
  db.placeTableCards(spaceId, [{ type: "dictation", id, x: 32, y: 32, w: null, h: null }]);
  const ack = deferred(),
    writes = [];
  const c = await setup(t, {
    spaceId,
    api: {
      getTableBoard: async (s) => db.getTableBoard(s),
      getTranscriptionById: async (id) => db.getTranscriptionById(id),
      placeTableCards: async (s, p) => {
        writes.push(structuredClone(p));
        if (writes.length === 1) await ack.promise;
        return db.placeTableCards(s, p);
      },
    },
  });
  const frames = new Map();
  let frameId = 0;
  globalThis.requestAnimationFrame = (fn) => {
    frames.set(++frameId, fn);
    return frameId;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const canvas = () => c.tree.find((n) => n.attributes.role === "listbox");
  const card = () => c.tree.find((n) => n.attributes["data-card-key"] === `dictation:${id}`);
  const handle = () => c.tree.find((n) => n.attributes["data-resize-handle"] != null);
  const event = (name, target, over = {}) =>
    act(() => {
      const handler = c.tree.props(canvas())[name];
      return handler({
        target,
        currentTarget: canvas(),
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault() {},
        ...over,
      });
    });
  const style = () => c.tree.props(card()).style;
  await event("onKeyDown", card(), { key: "ArrowRight", altKey: true });
  const prior = { w: style().width, h: style().height };
  assert.deepEqual(prior, { w: 232, h: 112 });
  assert.deepEqual(
    [db.getTableBoard(spaceId).cards[0].layout.w, db.getTableBoard(spaceId).cards[0].layout.h],
    [null, null]
  );
  await event("onPointerDown", handle());
  await event("onPointerMove", handle(), { clientX: 80, clientY: -400 });
  await act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((fn) => fn());
  });
  assert.equal(style().height, 80);
  await event("onPointerCancel", handle());
  assert.deepEqual({ w: style().width, h: style().height }, prior);
  assert.equal(writes.length, 1);
  // Earlier successful ACK/read must retain the restored pre-existing preview.
  await act(() => ack.resolve());
  assert.deepEqual({ w: style().width, h: style().height }, prior);
  globalThis.document.activeElement = card();
  await event("onKeyDown", card(), { key: "Enter" });
  assert.match(c.tree.text(), /Keep the meaningful tail intact/);
  await c.click("table.detail.close");
  await event("onKeyDown", card(), { key: "ArrowRight", shiftKey: true });
  assert.equal(writes.length, 2);
  assert.deepEqual([writes[1][0].w, writes[1][0].h], [prior.w, prior.h]);
  const reopened = new DatabaseManager();
  t.after(() => reopened.db.close());
  assert.deepEqual(reopened.getTableBoard(spaceId), db.getTableBoard(spaceId));
  assert.equal(reopened.getTranscriptionById(id).text, full);
});
