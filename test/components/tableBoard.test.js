const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { createDb } = require("../helpers/harness/db");
const DatabaseManager = require("../../src/helpers/database");
const act = (fn) =>
  React.act(async () => {
    await fn();
    await new Promise((r) => setTimeout(r, 0));
  });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });
  return { resolve, reject, promise };
};
const entity = (id, type = "note", layout = null) => ({
  ref: { type, id },
  kind: type,
  title: "T" + id,
  excerpt: "body",
  at: "2026-10-20",
  durationMs: null,
  participants: [],
  hrefs: [],
  noteId: null,
  layout,
});
const data = (cards = [entity(1)], inbox = []) => ({
  spaceId: 1,
  cards,
  inbox,
  links: [],
  viewport: null,
  truncated: false,
});
async function mount(t, api, spaceId = 1) {
  let root;
  t.after(async () => {
    if (root) await act(() => root.unmount());
  });
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-table-board-"));
  const { useTableBoard } = await vite.ssrLoadModule("/components/table/useTableBoard.ts");
  let h;
  function Harness({ id }) {
    h = useTableBoard(id);
    return null;
  }
  root = createRoot(container);
  const render = (id) => act(() => root.render(React.createElement(Harness, { id })));
  await render(spaceId);
  return {
    get h() {
      return h;
    },
    render,
    unmount: async () => {
      await act(() => root.unmount());
      root = null;
    },
  };
}
for (const operation of ["place", "hide", "link", "viewport"]) {
  for (const outcome of ["false", "absent", "reject", "partial"]) {
    if (outcome === "partial" && !["place", "hide"].includes(operation)) continue;
    test(`real board: ${operation} ${outcome} reports failure and reloads main`, async (t) => {
      let reads = 0;
      const api = {
        getTableBoard: async () => {
          reads++;
          return data();
        },
      };
      const names = {
        place: "placeTableCards",
        hide: "hideTableCards",
        link: "linkTableCards",
        viewport: "setTableViewport",
      };
      if (outcome !== "absent")
        api[names[operation]] = async () => {
          if (outcome === "reject") throw Error("IPC failed");
          if (outcome === "partial")
            return operation === "place"
              ? { success: true, placed: 1, placedKeys: ["note:1"] }
              : { success: true, hidden: 1 };
          return { success: false };
        };
      const c = await mount(t, api);
      await act(async () => {
        if (operation === "place")
          assert.equal(
            await c.h.place([
              { type: "note", id: 1, x: 40, y: 50 },
              { type: "note", id: 2, x: 60, y: 70 },
            ]),
            false
          );
        if (operation === "hide") await c.h.hide(["note:1", "note:2"]);
        if (operation === "link")
          await c.h.link({ type: "note", id: 1 }, { type: "dictation", id: 2 });
        if (operation === "viewport") {
          c.h.setViewport({ x: 400, y: 20, scale: 1 }, true);
          await new Promise((r) => setTimeout(r, 430));
        }
      });
      assert.equal(c.h.status, "saveFailed");
      assert.ok(reads >= 2, "authoritative read also happens after refusal/partial/rejection");
      assert.equal(c.h.state.board.cards[0].ref.id, 1, "content survives");
    });
  }
}
test("successful placement always reconciles unseen main content and preserves live identities", async (t) => {
  let board = data([entity(1)], [entity(2, "dictation")]);
  let reads = 0;
  const c = await mount(t, {
    getTableBoard: async () => {
      reads++;
      return structuredClone(board);
    },
    placeTableCards: async () => {
      board = data([
        entity(2, "dictation", { x: 80, y: 96, w: null, h: null, z: 0, hidden: false }),
        entity(3),
        entity(1),
      ]);
      return { success: true, placed: 1, placedKeys: ["dictation:2"] };
    },
  });
  await act(() => {
    c.h.dispatch({ type: "select", keys: ["note:1"] });
    c.h.dispatch({ type: "focus", key: "note:1" });
    c.h.setViewport({ x: -33, y: 25, scale: 1.2 }, false);
  });
  await act(() => c.h.place([{ type: "dictation", id: 2, x: 80, y: 96 }]));
  assert.ok(reads >= 2);
  assert.equal(c.h.cards.length, 3);
  assert.equal(c.h.state.focused, "note:1");
  assert.deepEqual(c.h.state.selection, ["note:1"]);
  assert.equal(c.h.state.viewport.x, -33);
});
test("out-of-order and old-space reads never reclaim a newer scope", async (t) => {
  const slow = deferred();
  let calls = 0;
  const c = await mount(t, {
    getTableBoard: async (id) => {
      calls++;
      if (calls === 2) return slow.promise;
      return { ...data([entity(id)]), spaceId: id };
    },
  });
  let pending;
  await act(() => {
    pending = c.h.reload();
  });
  await c.render(2);
  await act(() => slow.resolve(data([entity(99)])));
  await pending;
  assert.equal(c.h.state.board.spaceId, 2);
  assert.equal(c.h.cards[0].entity.ref.id, 2);
});
test("canonical reload preserves an active gesture preview until drop ACK", async (t) => {
  const c = await mount(t, {
    getTableBoard: async () => data(),
    placeTableCards: async () => ({ success: true, placed: 1, placedKeys: ["note:1"] }),
  });
  await act(() => c.h.dispatch({ type: "moved", positions: { "note:1": { x: 123, y: 456 } } }));
  await act(() => c.h.reload());
  assert.equal(c.h.cards[0].rect.x, 123);
});
test("real main projection after ACK is capped, arranged first and identical on reopen", async (t) => {
  const db = createDb(t);
  assert.ok(db);
  const id = db.getPrivateSpaceId();
  for (let n = 0; n < 500; n++)
    db.saveNote("N" + n, "original " + n, "personal", null, null, null, id);
  const d = db.saveTranscription("dictation full text", "dictation full text").id;
  const c = await mount(
    t,
    {
      getTableBoard: async (s) => db.getTableBoard(s),
      placeTableCards: async (s, p) => db.placeTableCards(s, p),
    },
    id
  );
  const retained = c.h.cards[0].key;
  await act(() => {
    c.h.dispatch({ type: "select", keys: [retained] });
    c.h.dispatch({ type: "focus", key: retained });
    c.h.setViewport({ x: -52, y: 24, scale: 1.1 }, false);
  });
  await act(() => c.h.place([{ type: "dictation", id: d, x: 80, y: 88 }]));
  assert.equal(c.h.cards.length, 500);
  assert.equal(c.h.cards[0].key, `dictation:${d}`);
  assert.equal(c.h.state.board.truncated, true);
  const reopened = new DatabaseManager();
  t.after(() => reopened.db.close());
  assert.deepEqual(c.h.state.board, reopened.getTableBoard(id));
  assert.equal(c.h.state.focused, retained);
  assert.equal(c.h.state.viewport.x, -52);
});
module.exports = { mount, entity, data, act, deferred };
test("an earlier drop ACK cannot clear a newer preview for the same card", async (t) => {
  const ack = deferred();
  const c = await mount(t, {
    getTableBoard: async () => data(),
    placeTableCards: () => ack.promise,
  });
  await act(() => c.h.dispatch({ type: "moved", positions: { "note:1": { x: 80, y: 88 } } }));
  let pending;
  await act(() => {
    pending = c.h.place([{ type: "note", id: 1, x: 80, y: 88 }]);
  });
  await act(() => c.h.dispatch({ type: "moved", positions: { "note:1": { x: 160, y: 176 } } }));
  await act(() => ack.resolve({ success: true, placed: 1, placedKeys: ["note:1"] }));
  await pending;
  assert.equal(c.h.cards[0].rect.x, 160);
  assert.equal(c.h.cards[0].rect.y, 176);
});
test("an accepted drop keeps its geometry while canonical read is pending", async (t) => {
  const read = deferred();
  let count = 0;
  const c = await mount(t, {
    getTableBoard: async () => (++count === 1 ? data() : read.promise),
    placeTableCards: async () => ({ success: true, placed: 1, placedKeys: ["note:1"] }),
  });
  await act(() => c.h.dispatch({ type: "moved", positions: { "note:1": { x: 80, y: 88 } } }));
  let pending;
  await act(() => {
    pending = c.h.place([{ type: "note", id: 1, x: 80, y: 88 }]);
  });
  assert.equal(c.h.cards[0].rect.x, 80);
  await act(() =>
    read.resolve(data([entity(1, "note", { x: 80, y: 88, w: null, h: null, z: 0, hidden: false })]))
  );
  await pending;
});
test("all capture/content/chat lifecycle events debounce an authoritative reload and unsubscribe", async (t) => {
  const callbacks = {},
    offs = [];
  let reads = 0;
  const api = {
    getTableBoard: async () => {
      reads++;
      return data();
    },
  };
  const names = [
    "onNoteAdded",
    "onNoteUpdated",
    "onNoteDeleted",
    "onTranscriptionAdded",
    "onTranscriptionUpdated",
    "onTranscriptionDeleted",
    "onTranscriptionsCleared",
    "onAgentConversationDeleted",
    "onAgentConversationArchived",
  ];
  for (const name of names)
    api[name] = (fn) => {
      callbacks[name] = fn;
      return () => offs.push(name);
    };
  const c = await mount(t, api);
  for (const name of names) assert.equal(typeof callbacks[name], "function");
  await act(async () => {
    for (const fn of Object.values(callbacks)) fn({ status: "completed", text: "new capture" });
    await new Promise((r) => setTimeout(r, 275));
  });
  assert.equal(reads, 2);
  await c.unmount();
  assert.deepEqual(offs.sort(), names.sort());
});
test("same-space later read wins; failed reads report saveFailed without dropping content", async (t) => {
  const slow = deferred();
  let calls = 0;
  let fail = false;
  const c = await mount(t, {
    getTableBoard: async () => {
      if (fail) throw Error("read failed");
      return ++calls === 2 ? slow.promise : data([entity(calls)]);
    },
  });
  let old;
  await act(() => {
    old = c.h.reload();
  });
  await act(() => c.h.reload());
  await act(() => slow.resolve(data([entity(99)])));
  await old;
  assert.equal(c.h.cards[0].key, "note:3");
  fail = true;
  await act(() => c.h.reload());
  assert.equal(c.h.status, "saveFailed");
  assert.equal(c.h.cards[0].key, "note:3");
});
test("viewport timers stop on unmount and old ACK cannot roll back a newer live view", async (t) => {
  const ack = deferred();
  let writes = 0;
  const c = await mount(t, {
    getTableBoard: async () => data(),
    setTableViewport: () => {
      writes++;
      return ack.promise;
    },
  });
  await act(async () => {
    c.h.setViewport({ x: 25, y: 50, scale: 1 }, true);
    await new Promise((r) => setTimeout(r, 425));
  });
  await act(() => c.h.setViewport({ x: 90, y: 100, scale: 1 }, false));
  await act(() => ack.resolve({ success: false }));
  assert.equal(c.h.state.viewport.x, 90);
  assert.equal(c.h.status, "saveFailed");
  await act(() => c.h.setViewport({ x: 30, y: 40, scale: 1 }, true));
  await c.unmount();
  await new Promise((r) => setTimeout(r, 425));
  assert.equal(writes, 1);
});
test("a retained reload callback does no Table IPC after unmount", async (t) => {
  let reads = 0;
  const c = await mount(t, {
    getTableBoard: async () => {
      reads++;
      return data();
    },
  });
  const reload = c.h.reload;
  await c.unmount();
  await act(() => reload());
  assert.equal(reads, 1);
});

for (const finalRead of ["success", "failure"])
  test(`fix1 I1: older ACK after newer ACK keeps accepted geometry before final ${finalRead} read`, async (t) => {
    const a = deferred(),
      b = deferred(),
      final = deferred();
    const newer = data([
      entity(1, "note", { x: 160, y: 176, w: null, h: null, z: 0, hidden: false }),
    ]);
    let reads = 0,
      writes = 0;
    const c = await mount(t, {
      getTableBoard: () => {
        reads++;
        return reads === 1
          ? Promise.resolve(data())
          : reads === 2
            ? Promise.resolve(newer)
            : final.promise;
      },
      placeTableCards: () => (++writes === 1 ? a.promise : b.promise),
    });
    let first, second;
    await act(() => {
      c.h.dispatch({ type: "moved", positions: { "note:1": { x: 80, y: 88 } } });
      first = c.h.place([{ type: "note", id: 1, x: 80, y: 88 }]);
    });
    await act(() => {
      c.h.dispatch({ type: "moved", positions: { "note:1": { x: 160, y: 176 } } });
      second = c.h.place([{ type: "note", id: 1, x: 160, y: 176 }]);
    });
    await act(() => b.resolve({ success: true, placed: 1, placedKeys: ["note:1"] }));
    assert.equal(await second, true);
    assert.deepEqual(c.h.state.overrides, {}, "B has settled its preview");
    assert.equal(c.h.cards[0].rect.x, 160);
    await act(() => a.resolve({ success: true, placed: 1, placedKeys: ["note:1"] }));
    try {
      assert.equal(reads, 3, "A still reconciles main after its obsolete ACK");
      assert.equal(c.h.cards[0].rect.x, 160, "before final read, A must not replay x80");
      assert.equal(c.h.cards[0].rect.y, 176);
    } finally {
      await act(() =>
        finalRead === "success"
          ? final.resolve(newer)
          : final.reject(Error("canonical read failed"))
      );
      assert.equal(await first, true, "main accepted A even though its local geometry is obsolete");
    }
    assert.equal(c.h.cards[0].rect.x, 160);
    assert.equal(c.h.cards[0].rect.y, 176);
    assert.equal(c.h.status, finalRead === "success" ? "idle" : "saveFailed");
  });

test("fix1 I1: per-key write ownership also orders placements without move previews", async (t) => {
  const a = deferred(),
    b = deferred(),
    final = deferred();
  const initial = data([entity(1), entity(2)]);
  const newer = data([
    entity(1, "note", { x: 160, y: 176, w: null, h: null, z: 0, hidden: false }),
    entity(2),
  ]);
  let reads = 0,
    writes = 0;
  const c = await mount(t, {
    getTableBoard: () =>
      ++reads === 1
        ? Promise.resolve(initial)
        : reads === 2
          ? Promise.resolve(newer)
          : final.promise,
    placeTableCards: () => (++writes === 1 ? a.promise : b.promise),
  });
  let first, second;
  await act(() => {
    first = c.h.place([
      { type: "note", id: 1, x: 80, y: 88 },
      { type: "note", id: 2, x: 240, y: 248 },
    ]);
  });
  await act(() => {
    second = c.h.place([{ type: "note", id: 1, x: 160, y: 176 }]);
  });
  await act(() => b.resolve({ success: true, placed: 1, placedKeys: ["note:1"] }));
  await second;
  await act(() => a.resolve({ success: true, placed: 2, placedKeys: ["note:1", "note:2"] }));
  try {
    assert.equal(c.h.cards.find((card) => card.key === "note:1").rect.x, 160);
    assert.equal(
      c.h.cards.find((card) => card.key === "note:2").rect.x,
      240,
      "uncontested key in A's batch still applies"
    );
  } finally {
    await act(() =>
      final.resolve(
        data([
          newer.cards[0],
          entity(2, "note", { x: 240, y: 248, w: null, h: null, z: 0, hidden: false }),
        ])
      )
    );
    await first;
  }
});

test("fix1 I2: first board read accepts content without replacing a newer live viewport", async (t) => {
  const initial = deferred();
  const c = await mount(t, { getTableBoard: () => initial.promise });
  const live = { x: 90, y: 100, scale: 1.2 };
  await act(() => c.h.setViewport(live, false));
  await act(() => initial.resolve({ ...data(), viewport: { x: 0, y: 0, scale: 1 } }));
  assert.equal(c.h.state.board.spaceId, 1);
  assert.equal(c.h.cards[0].key, "note:1");
  assert.deepEqual(c.h.state.viewport, live);
});

test("fix1 I2: untouched initial load still restores the stored viewport", async (t) => {
  const initial = deferred();
  const stored = { x: -40, y: 12, scale: 0.8 };
  const c = await mount(t, { getTableBoard: () => initial.promise });
  await act(() => initial.resolve({ ...data(), viewport: stored }));
  assert.deepEqual(c.h.state.viewport, stored);
});

for (const navigateInB of [false, true])
  test(`fix1 I2: scope reset rejects old load and ${navigateInB ? "retains B live navigation" : "restores B stored view"}`, async (t) => {
    const a = deferred(),
      b = deferred();
    const c = await mount(t, { getTableBoard: (id) => (id === 1 ? a.promise : b.promise) });
    await act(() => c.h.setViewport({ x: 90, y: 100, scale: 1.2 }, false));
    await c.render(2);
    assert.deepEqual(
      c.h.state.viewport,
      { x: 0, y: 0, scale: 1 },
      "scope change resets live ownership"
    );
    const liveB = { x: 180, y: 200, scale: 1.4 };
    if (navigateInB) await act(() => c.h.setViewport(liveB, false));
    await act(() => a.resolve({ ...data(), viewport: { x: -40, y: 12, scale: 0.8 } }));
    assert.equal(c.h.state.board, null, "stale A cannot initialize B");
    const storedB = { x: -70, y: -50, scale: 0.7 };
    await act(() => b.resolve({ ...data([entity(2)]), spaceId: 2, viewport: storedB }));
    assert.equal(c.h.state.board.spaceId, 2);
    assert.deepEqual(c.h.state.viewport, navigateInB ? liveB : storedB);
  });
