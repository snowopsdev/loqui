const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { deferred } = require("../helpers/harness/deferred");
const en = require("../../src/locales/en/translation.json");
const note = (id, title, space_id = 1) => ({
  id,
  title,
  content: "",
  space_id,
  folder_id: 2,
  note_type: "personal",
  updated_at: "2026-10-19 12:00:00",
});
const conv = (id, title) => ({ id, title, updated_at: "2026-10-19 13:00:00" });
function all(node, pred) {
  if (Array.isArray(node)) return node.flatMap((n) => all(n, pred));
  if (!node || typeof node !== "object") return [];
  return [...(pred(node) ? [node] : []), ...all(node.props?.children, pred)];
}
async function mount(t, { api = {}, mode = "all", transcriptions = [] } = {}) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const calls = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getPlatform: () => "linux",
        getNotes: async () => [],
        searchNotes: async () => [],
        getFolders: async () => [{ id: 2, name: "Go to Notes", space_id: 1 }],
        getSpaces: async () => [
          { id: 1, kind: "private" },
          { id: 2, name: "Team", kind: "shared" },
        ],
        getAgentConversationsWithPreview: async (...args) => {
          calls.push(["recent", ...args]);
          return [];
        },
        semanticSearchConversations: async (...args) => {
          calls.push(["semantic", ...args]);
          return [];
        },
        toggleDictationFromControlPanel: () => calls.push(["toggle"]),
        ...api,
      },
    },
  });
  const container = installHookDom(t);
  globalThis.document.documentElement.classList = { contains: () => false };
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `const en = ${JSON.stringify(en)}; const t = (key, args = {}) => { const value = key.split('.').reduce((v, k) => v?.[k], en) ?? key; return String(value).replace(/{{(.*?)}}/g, (_, k) => args[k] ?? k); }; export const useTranslation = () => ({ t });`,
      "/hooks/useUiLocale": 'export const useUiLocale = () => "en";',
      "/stores/settingsStore": `import { create } from "zustand"; export const themes = []; export const useSettingsStore = create(() => ({ setTheme: value => themes.push(value), activeDictationKey: 'Ctrl+Space', route: 'before' }));`,
      "/lib/routes": `export const snapshots = []; export const routeSnapshotFromSettings = settings => { snapshots.push(settings.route); return settings; }; export const resolveRoute = (s, id) => { if(id !== 'dictationStt') throw Error(id); return { settingsPath: 'stt/' + s.route }; };`,
    },
  });
  const { default: CommandSearch } = await vite.ssrLoadModule("/components/CommandSearch.tsx");
  const { WorkspaceNavigationProvider } = await vite.ssrLoadModule(
    "/components/workspaceNavigation.tsx"
  );
  const home = await vite.ssrLoadModule("/stores/homeViewStore.ts");
  const settings = await vite.ssrLoadModule("/stores/settingsStore");
  const routes = await vite.ssrLoadModule("/lib/routes");
  const nav = Object.fromEntries(
    [
      "newNote",
      "recordMeeting",
      "focusAssistant",
      "openView",
      "openUpload",
      "startChat",
      "openSettings",
    ].map((k) => [k, (...args) => calls.push([k, ...args])])
  );
  let tree;
  let props = {
    open: true,
    mode,
    transcriptions,
    onOpenChange: (open) => calls.push(["open", open]),
    onNoteSelect: (...args) => calls.push(["note", ...args]),
    onTranscriptSelect: (id) => calls.push(["transcript", id]),
    onConversationSelect: (id) => calls.push(["conversation", id]),
    onContainerSelect: (...args) => calls.push(["container", ...args]),
  };
  function Probe() {
    tree = CommandSearch(props);
    return null;
  }
  root = createRoot(container);
  const render = async (over) => {
    props = { ...props, ...over };
    await React.act(async () =>
      root.render(
        React.createElement(WorkspaceNavigationProvider, { value: nav }, React.createElement(Probe))
      )
    );
  };
  await render();
  const input = () => all(tree, (n) => n.type === "input")[0];
  const rows = () => all(tree, (n) => n.type === "button" && n.props["data-idx"] != null);
  return {
    calls,
    home,
    settings,
    routes,
    render,
    rows,
    query: async (value) => React.act(async () => input().props.onChange({ target: { value } })),
    wait: async () => React.act(async () => new Promise((resolve) => setTimeout(resolve, 230))),
    key: async (key, shiftKey = false) => {
      let prevented = false;
      await React.act(async () =>
        input().props.onKeyDown({
          key,
          shiftKey,
          preventDefault() {
            prevented = true;
          },
        })
      );
      return prevented;
    },
    click: async (index) => React.act(async () => rows()[index].props.onClick()),
  };
}

test("mounted all-mode keyboard selects the rendered flattened row, Tab cycles scope both directions", async (t) => {
  const scopes = [];
  const h = await mount(t, {
    api: {
      searchNotes: async (_q, _type, scope) => {
        scopes.push(scope);
        return [note(1, "Go note")];
      },
    },
  });
  assert.equal(h.rows().length, 4, "suggestions are rendered");
  await h.key("ArrowDown");
  await h.key("Enter");
  assert.ok(h.calls.some((c) => c[0] === "toggle"));
  await h.query("go");
  await h.wait();
  assert.equal(await h.key("Tab"), true);
  await h.wait();
  assert.equal(scopes.at(-1), 1);
  assert.equal(await h.key("Tab", true), true);
  await h.wait();
  assert.equal(scopes.at(-1), null);
  await h.query("gnot");
  await h.wait();
  assert.ok(
    h.rows().some((r) => r.key === "container-1-2"),
    "fuzzy folders reach rendered pipeline without literal prefilter"
  );
});

test("duplicate folder results retain containing-space hints from existing target data", async (t) => {
  const h = await mount(t, {
    api: {
      getFolders: async () => [
        { id: 2, name: "Archive", space_id: 1 },
        { id: 3, name: "Archive", space_id: 2 },
      ],
    },
  });
  await h.query("Archive");
  await h.wait();
  const text = (node) =>
    typeof node === "string"
      ? node
      : Array.isArray(node)
        ? node.map(text).join("")
        : node && typeof node === "object"
          ? (node.props?.text ?? text(node.props?.children))
          : "";
  const folders = h
    .rows()
    .map(text)
    .filter((value) => value.includes("Archive"));
  assert.equal(folders.length, 2);
  assert.ok(folders.some((value) => value.includes("Personal")));
  assert.ok(folders.some((value) => value.includes("Team")));
});

test("mounted result dispatch uses owner callbacks; See all retains query and Ask only seeds", async (t) => {
  const transcriptions = Array.from({ length: 11 }, (_, i) => ({
    id: i + 1,
    text: "standup item",
    timestamp: "2026-10-19 12:00:00",
    created_at: "2026-10-19 12:00:00",
  }));
  const h = await mount(t, {
    transcriptions,
    api: {
      searchNotes: async (q) =>
        q === "standup"
          ? [note(9, "standup prep"), { ...note(10, "standup meeting"), note_type: "meeting" }]
          : [],
      semanticSearchConversations: async (q) => (q === "standup" ? [conv(30, "standup chat")] : []),
    },
  });
  await h.query(" standup ");
  await h.wait();
  // Search receives the query text; the renderer highlights trimmed text.
  await h.query("standup");
  await h.wait();
  for (const key of ["note-9", "meeting-10", "transcript-1", "conversation-30"])
    await h.click(h.rows().findIndex((r) => r.key === key));
  assert.ok(h.calls.some((c) => c[0] === "note" && c[1] === 9 && c[2] === 2 && c[3] === 1));
  assert.ok(h.calls.some((c) => c[0] === "note" && c[1] === 10));
  assert.ok(h.calls.some((c) => c[0] === "transcript" && c[1] === 1));
  assert.ok(h.calls.some((c) => c[0] === "conversation" && c[1] === 30));
  await h.click(h.rows().findIndex((r) => r.key === "see-all-transcripts"));
  assert.equal(h.home.useHomeViewStore.getState().query, "standup");
  assert.ok(h.calls.some((c) => c[0] === "openView" && c[1] === "home"));
  await h.query("what did we decide");
  await h.wait();
  assert.equal(h.rows().length, 1);
  await h.key("Enter");
  assert.deepEqual(
    h.calls.find((c) => c[0] === "startChat"),
    ["startChat", { draft: "what did we decide" }]
  );
  assert.equal(h.calls.filter((c) => /send|provider|create/i.test(c[0])).length, 0);
});

test("mounted commands resolve route at click time, toggle once and use theme owner", async (t) => {
  const h = await mount(t);
  await h.query("Switch speech model");
  await h.wait();
  h.settings.useSettingsStore.setState({ route: "at-click" });
  await h.key("Enter");
  assert.deepEqual(h.routes.snapshots, ["at-click"]);
  assert.ok(h.calls.some((c) => c[0] === "openSettings" && c[1] === "stt/at-click"));
  await h.query("Toggle dark theme");
  await h.wait();
  await h.key("Enter");
  assert.deepEqual(h.settings.themes, ["dark"]);
});

test("mounted async A→B completion and failure retain only admitted visible data", async (t) => {
  const a = deferred(),
    b = deferred(),
    ca = deferred(),
    cb = deferred();
  const h = await mount(t, {
    api: {
      searchNotes: (q) =>
        q === "a" ? a.promise : q === "b" ? b.promise : Promise.reject(Error("fixture DB failure")),
      semanticSearchConversations: (q) =>
        q === "a"
          ? ca.promise
          : q === "b"
            ? cb.promise
            : Promise.reject(Error("fixture DB failure")),
    },
  });
  await h.query("a");
  await h.wait();
  await h.query("b");
  await h.wait();
  await React.act(async () => {
    b.resolve([note(2, "B data")]);
    cb.resolve([conv(2, "B chat")]);
  });
  await React.act(async () => {
    a.resolve([note(1, "A data")]);
    ca.resolve([conv(1, "A chat")]);
  });
  assert.ok(h.rows().some((r) => r.key === "note-2"));
  assert.ok(!h.rows().some((r) => r.key === "note-1"));
  assert.ok(h.rows().some((r) => r.key === "conversation-2"));
  await h.query("fails");
  await h.wait();
  assert.ok(h.rows().some((r) => r.key === "note-2"));
  assert.ok(h.rows().some((r) => r.key === "conversation-2"));
});

test("mounted empty→query and close/reopen invalidate old notes and chats; scope invalidates both", async (t) => {
  const empty = deferred(),
    emptyChats = deferred(),
    old = deferred(),
    oldChats = deferred();
  let gets = 0;
  const h = await mount(t, {
    api: {
      getNotes: () => (++gets === 1 ? empty.promise : Promise.resolve([note(8, "new empty")])),
      getAgentConversationsWithPreview: () => emptyChats.promise,
      searchNotes: (q) => (q === "old" ? old.promise : Promise.resolve([note(2, "current", 2)])),
      semanticSearchConversations: (q) =>
        q === "old" ? oldChats.promise : Promise.resolve([conv(2, "current")]),
    },
  });
  await h.query("current");
  await h.wait();
  await React.act(async () => {
    empty.resolve([note(1, "stale empty")]);
    emptyChats.resolve([conv(1, "stale empty chat")]);
  });
  assert.ok(h.rows().some((r) => r.key === "conversation-2"));
  assert.ok(!h.rows().some((r) => r.key === "conversation-1"));
  assert.ok(!h.rows().some((r) => r.key === "note-1"));
  await h.query("old");
  await h.wait();
  await h.render({ open: false });
  await h.render({ open: true });
  await React.act(async () => {
    old.resolve([note(5, "old")]);
    oldChats.resolve([conv(5, "old")]);
  });
  assert.ok(!h.rows().some((r) => r.key === "note-5" || r.key === "conversation-5"));
  await h.query("current");
  await h.wait();
  await h.key("Tab");
  await h.wait();
  assert.ok(!h.rows().some((r) => r.key === "note-2"), "scope filters loaded results immediately");
});

test("mounted conversations picker retains 20-limit semantic API, callback, legacy rows and Tab behavior", async (t) => {
  const h = await mount(t, {
    mode: "conversations",
    api: {
      getNotes: () => {
        throw Error("all-mode DB call");
      },
      getFolders: () => {
        throw Error("all-mode DB call");
      },
      getSpaces: () => {
        throw Error("all-mode DB call");
      },
      getAgentConversationsWithPreview: async () => {
        return [conv(1, "picker")];
      },
    },
  });
  await h.wait();
  assert.equal(h.rows().length, 1);
  assert.equal(await h.key("Tab"), false);
  await h.key("Enter");
  assert.ok(h.calls.some((c) => c[0] === "conversation" && c[1] === 1));
  await h.query("semantic");
  await h.wait();
  assert.ok(h.calls.some((c) => c[0] === "semantic" && c[1] === "semantic" && c[2] === 20));
  assert.equal(
    h.calls.some((c) => c[0] === "startChat" || c[0] === "toggle"),
    false
  );
});

test("mounted all-mode async section shrink keeps Arrow/Enter on a valid rendered row", async (t) => {
  const result = deferred();
  const h = await mount(t, {
    api: {
      getNotes: async () => Array.from({ length: 8 }, (_, i) => note(i + 1, "old")),
      searchNotes: () => result.promise,
    },
  });
  await h.query("absent");
  await h.wait();
  for (let i = 0; i < 20; i++) await h.key("ArrowDown");
  await React.act(async () => result.resolve([]));
  assert.equal(h.rows().length, 1);
  await h.key("Enter");
  assert.deepEqual(
    h.calls.find((c) => c[0] === "startChat"),
    ["startChat", { draft: "absent" }]
  );
});

test("mounted closed all-mode issues no search requests and cancels pending debounce", async (t) => {
  let searches = 0;
  const h = await mount(t, {
    api: {
      searchNotes: async () => {
        searches++;
        return [];
      },
    },
  });
  await h.query("cancel");
  await h.render({ open: false });
  await h.wait();
  assert.equal(searches, 0);
  await h.render({ open: true });
  await h.query("current");
  await h.wait();
  assert.equal(searches, 1);
});

test("each mounted command dispatches exactly once through its owner dependency", async (t) => {
  const h = await mount(t);
  const cases = [
    ["newNote", "New note", "newNote"],
    ["startDictation", "Start dictation", "toggle"],
    ["askAssistant", "Ask the assistant", "focusAssistant"],
    ["goNotes", "Go to Notes", "openView", "personal-notes"],
    ["goHome", "Go to Home", "openView", "home"],
    ["goChat", "Go to Chat", "openView", "chat"],
    ["recordMeeting", "Record meeting", "recordMeeting"],
    ["uploadAudio", "Upload audio", "openUpload"],
    ["newChat", "New chat", "startChat"],
    ["openSettings", "Open settings", "openSettings"],
    ["switchSpeechModel", "Switch speech model", "openSettings", "stt/before"],
  ];
  for (const [id, query, owner, argument] of cases) {
    await h.query(query);
    await h.wait();
    const before = h.calls.length;
    await h.click(h.rows().findIndex((r) => r.key === `command-${id}`));
    assert.deepEqual(
      h.calls.slice(before),
      [["open", false], ...(argument === undefined ? [[owner]] : [[owner, argument]])],
      id
    );
  }
  await h.query("Toggle dark theme");
  await h.wait();
  await h.key("Enter");
  assert.deepEqual(h.settings.themes, ["dark"]);
  assert.equal(
    h.calls.filter((c) => /send|stream|provider|createAgent|addAgent/i.test(c[0])).length,
    0
  );
});

test("scope changes retire both pending streams even when old notes belong to the new scope", async (t) => {
  const a = deferred(),
    b = deferred(),
    ca = deferred(),
    cb = deferred();
  let chats = 0;
  const h = await mount(t, {
    api: {
      searchNotes: (_q, _type, scope) => (scope == null ? a.promise : b.promise),
      semanticSearchConversations: () => (++chats === 1 ? ca.promise : cb.promise),
    },
  });
  await h.query("same");
  await h.wait();
  await h.key("Tab");
  await h.wait();
  await React.act(async () => {
    b.resolve([note(2, "current scope")]);
    cb.resolve([conv(2, "current")]);
  });
  await React.act(async () => {
    a.resolve([note(1, "late same space")]);
    ca.resolve([conv(1, "late")]);
  });
  assert.ok(h.rows().some((r) => r.key === "note-2"));
  assert.ok(h.rows().some((r) => r.key === "conversation-2"));
  assert.ok(!h.rows().some((r) => r.key === "note-1" || r.key === "conversation-1"));
});
