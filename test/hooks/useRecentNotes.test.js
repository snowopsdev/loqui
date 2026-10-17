const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { deferred } = require("../helpers/harness/deferred");

async function mount(t) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const requests = [];
  const listeners = new Map();
  const api = {
    getNotes: (...args) => {
      const d = deferred();
      requests.push({ ...d, args });
      return d.promise;
    },
  };
  for (const name of ["onNoteAdded", "onNoteUpdated", "onNoteDeleted", "onFolderDeleted"]) {
    api[name] = (callback) => {
      listeners.set(name, callback);
      return () => listeners.delete(name);
    };
  }
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const container = installHookDom(t);
  const vite = await createRendererServer(t);
  const { useRecentNotes } = await vite.ssrLoadModule("/hooks/useRecentNotes.ts");
  let notes;
  function Probe({ limit }) {
    notes = useRecentNotes(limit);
    return null;
  }
  root = createRoot(container);
  const render = async (limit) =>
    React.act(async () => root.render(React.createElement(Probe, { limit })));
  await render(4);
  return {
    notes: () => notes,
    requests,
    listeners,
    render,
    emit: async (name, payload) => React.act(async () => listeners.get(name)?.(payload)),
    resolve: async (index, rows) => React.act(async () => requests[index].resolve(rows)),
    unmount: async () => {
      await React.act(async () => root.unmount());
      root = null;
    },
  };
}
const row = (id, folder_id = null) => ({
  id,
  folder_id,
  title: `Fixture ${id}`,
  content: "Never delete drafts",
});

test("real hook keeps newest reload when IPC resolves out of order", async (t) => {
  const h = await mount(t);
  assert.deepEqual(h.requests[0].args, [null, 4]);
  await h.emit("onNoteUpdated", row(2));
  await h.resolve(1, [row(2)]);
  await h.resolve(0, [row(1)]);
  assert.deepEqual(
    h.notes().map((n) => n.id),
    [2]
  );
});

test("folder deletion boundary invalidates pending reload and removes stale recent rows without deleting content", async (t) => {
  const h = await mount(t);
  await h.resolve(0, [row(1, 8), row(2, 9)]);
  await h.emit("onNoteUpdated", row(1, 8));
  assert.ok(h.listeners.has("onFolderDeleted"), "subscribe actual preload folder-deleted boundary");
  await h.emit("onFolderDeleted", { id: 8 });
  assert.deepEqual(
    h.notes().map((n) => n.id),
    [2],
    "remove deleted-folder rows immediately"
  );
  await h.resolve(1, [row(1, 8), row(2, 9)]);
  assert.deepEqual(
    h.notes().map((n) => n.id),
    [2],
    "pre-deletion response is stale"
  );
  await h.resolve(2, [row(2, 9)]);
  assert.deepEqual(
    h.notes().map((n) => n.id),
    [2]
  );
  assert.equal(h.notes()[0].content, "Never delete drafts");
});

test("limit replacement and unmount invalidate old requests and unsubscribe all listeners", async (t) => {
  const h = await mount(t);
  await h.render(2);
  await h.resolve(1, [row(2)]);
  await h.resolve(0, [row(1)]);
  assert.deepEqual(
    h.notes().map((n) => n.id),
    [2]
  );
  await h.emit("onNoteAdded", row(3));
  await h.unmount();
  await h.resolve(2, [row(3)]);
  assert.equal(h.listeners.size, 0);
});
