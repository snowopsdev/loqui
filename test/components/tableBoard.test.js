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
async function mount(t, api, spaceId = 1, framed = false) {
  let root;
  t.after(async () => {
    if (root) await act(() => root.unmount());
  });
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-table-board-"));
  const { useTableBoard } = await vite.ssrLoadModule("/components/table/useTableBoard.ts");
  let publication;
  const frames = new Map();
  if (framed) {
    publication = (
      await vite.ssrLoadModule("/components/table/tablePublication.ts")
    ).createTablePublication();
    let id = 0;
    globalThis.requestAnimationFrame = (fn) => {
      frames.set(++id, fn);
      return id;
    };
    globalThis.cancelAnimationFrame = (id) => frames.delete(id);
    t.after(() => publication.dispose());
  }
  let h;
  function DuringCommit({ run }) {
    React.useLayoutEffect(() => run(h), [run]);
    return null;
  }
  function Harness({ id, duringCommit }) {
    h = useTableBoard(id, publication);
    return duringCommit ? React.createElement(DuringCommit, { run: duringCommit }) : null;
  }
  root = createRoot(container);
  const commits = [];
  const render = (id, duringCommit) =>
    act(() =>
      root.render(
        React.createElement(
          React.Profiler,
          { id: "board", onRender: (...args) => commits.push(args) },
          React.createElement(Harness, { id, duringCommit })
        )
      )
    );
  await render(spaceId);
  return {
    commits,
    frames,
    publication,
    flush: () =>
      act(() => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((fn) => fn());
      }),
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

test("resize ownership: canonical read retains active size; ACK settles size without clearing newer move", async (t) => {
  const pending = deferred();
  const c = await mount(t, {
    getTableBoard: async () => data(),
    placeTableCards: async () => pending.promise,
  });
  await act(() => c.h.dispatch({ type: "resized", key: "note:1", size: { w: 320, h: 80 } }));
  await act(() => c.h.reload());
  assert.deepEqual(c.h.state.sizes, { "note:1": { w: 320, h: 80 } });
  let write;
  await act(() => {
    write = c.h.place([{ type: "note", id: 1, x: 40, y: 48, w: 320, h: 80 }]);
  });
  await act(() => c.h.dispatch({ type: "moved", positions: { "note:1": { x: 160, y: 176 } } }));
  await act(() => pending.resolve({ success: true, placed: 1, placedKeys: ["note:1"] }));
  await write;
  assert.deepEqual(c.h.state.sizes, {});
  assert.deepEqual(c.h.state.overrides, { "note:1": { x: 160, y: 176 } });
});
test("resize ownership: older move ACK cannot clear a newer size; refusal clears only owned size", async (t) => {
  const pending = deferred();
  let calls = 0;
  const c = await mount(t, {
    getTableBoard: async () => data(),
    placeTableCards: async () => (++calls === 1 ? pending.promise : { success: false }),
  });
  let write;
  await act(() => {
    write = c.h.place([{ type: "note", id: 1, x: 40, y: 48 }]);
  });
  await act(() => c.h.dispatch({ type: "resized", key: "note:1", size: { w: 400, h: 240 } }));
  await act(() => pending.resolve({ success: true, placed: 1, placedKeys: ["note:1"] }));
  await write;
  assert.deepEqual(c.h.state.sizes, { "note:1": { w: 400, h: 240 } });
  await act(() => c.h.place([{ type: "note", id: 1, x: 40, y: 48, w: 400, h: 240 }]));
  assert.deepEqual(c.h.state.sizes, {});
  assert.equal(c.h.status, "saveFailed");
});
test("resize ownership: later settled size survives old ACK while canonical read waits", async (t) => {
  const a = deferred(),
    b = deferred(),
    finalRead = deferred();
  let writes = 0,
    reads = 0;
  const layout = { x: 40, y: 48, w: 400, h: 240, z: 0, hidden: false };
  const c = await mount(t, {
    getTableBoard: async () =>
      ++reads >= 3 ? finalRead.promise : data([entity(1, "note", reads === 1 ? null : layout)]),
    placeTableCards: async () => (++writes === 1 ? a.promise : b.promise),
  });
  let wa, wb;
  await act(() => {
    c.h.dispatch({ type: "resized", key: "note:1", size: { w: 320, h: 80 } });
    wa = c.h.place([{ type: "note", id: 1, x: 40, y: 48, w: 320, h: 80 }]);
  });
  await act(() => {
    c.h.dispatch({ type: "resized", key: "note:1", size: { w: 400, h: 240 } });
    wb = c.h.place([{ type: "note", id: 1, x: 40, y: 48, w: 400, h: 240 }]);
  });
  await act(() => b.resolve({ success: true, placed: 1, placedKeys: ["note:1"] }));
  await wb;
  assert.deepEqual(c.h.state.sizes, {});
  await act(() => a.resolve({ success: true, placed: 1, placedKeys: ["note:1"] }));
  assert.equal(c.h.cards[0].fixedH, 240);
  await act(() => finalRead.resolve(data([entity(1, "note", layout)])));
  await wa;
  assert.equal(c.h.cards[0].fixedH, 240);
});
test("resize ownership: partial ACK settles only submitted keys, newer preview and scope reset retain authority", async (t) => {
  const pending = deferred();
  const c = await mount(t, {
    getTableBoard: async (id) => ({ ...data([entity(1), entity(2)]), spaceId: id }),
    placeTableCards: async () => pending.promise,
  });
  let write;
  await act(() => {
    for (const id of [1, 2])
      c.h.dispatch({ type: "resized", key: `note:${id}`, size: { w: 320, h: 80 } });
    write = c.h.place([1, 2].map((id) => ({ type: "note", id, x: 40, y: 48, w: 320, h: 80 })));
  });
  await act(() => c.h.dispatch({ type: "resized", key: "note:2", size: { w: 408, h: 248 } }));
  await act(() => pending.resolve({ success: true, placed: 1, placedKeys: ["note:1"] }));
  await write;
  assert.equal(c.h.status, "saveFailed");
  assert.deepEqual(c.h.state.sizes, { "note:2": { w: 408, h: 248 } });
  await c.render(2);
  assert.deepEqual(c.h.state.sizes, {});
});

test("Task10: chrome state keeps card and edge projections stable while geometry still updates", async (t) => {
  const f = await mount(t, { getTableBoard: async () => data() });
  const cards = f.h.cards;
  const edges = f.h.edges;
  await act(() => f.h.setViewport({ x: 24, y: 32, scale: 1.2 }, false));
  await act(() => f.h.dispatch({ type: "select", keys: ["note:1"] }));
  await act(() => f.h.dispatch({ type: "focus", key: "note:1" }));
  assert.equal(f.h.cards, cards);
  assert.equal(f.h.edges, edges);
  await act(() => f.h.dispatch({ type: "moved", positions: { "note:1": { x: 80, y: 88 } } }));
  assert.notEqual(f.h.cards, cards);
  assert.equal(f.h.cards[0].rect.x, 80);
  assert.equal(f.h.cards[0].rect.y, 88);
});

test("Task10 fix1: identical canonical read adds no second settlement update, changed content still wins", async (t) => {
  let canonical = data([
    entity(1, "note", { x: 32, y: 32, w: null, h: null, z: 0, hidden: false }),
  ]);
  let held = null;
  const f = await mount(t, {
    getTableBoard: async () => (held ? held.promise : structuredClone(canonical)),
    placeTableCards: async (_space, placements) => {
      canonical.cards[0].layout = { ...canonical.cards[0].layout, ...placements[0] };
      delete canonical.cards[0].layout.type;
      delete canonical.cards[0].layout.id;
      return { success: true, placed: 1, placedKeys: ["note:1"] };
    },
  });
  held = deferred();
  let operation;
  await act(() => {
    operation = f.h.place([{ type: "note", id: 1, x: 80, y: 88 }]);
  });
  const accepted = f.h.state;
  const acceptedCommits = f.commits.length;
  assert.equal(accepted.board.cards[0].layout.x, 80);
  await act(async () => {
    held.resolve(structuredClone(canonical));
    await operation;
  });
  assert.equal(f.h.state, accepted, "an identical main projection needs no second UI update");
  assert.equal(
    f.commits.length,
    acceptedCommits,
    "no-op reload must not publish even a zero-duration commit"
  );
  held = null;
  canonical.cards[0].title = "New authoritative content";
  await act(() => f.h.reload());
  assert.equal(f.h.state.board.cards[0].title, "New authoritative content");
  assert.notEqual(f.h.state, accepted);
});

test("Task10 fix1: synchronous action sequence retains every field before React publishes", async (t) => {
  const f = await mount(t, { getTableBoard: async () => data() });
  await act(() => {
    f.h.dispatch({ type: "moved", positions: { "note:1": { x: 40, y: 48 } } });
    f.h.dispatch({ type: "resized", key: "note:1", size: { w: 320, h: 80 } });
    f.h.dispatch({ type: "focus", key: "note:1" });
    f.h.dispatch({ type: "moved", positions: { "note:1": { x: 56, y: 64 } } });
  });
  assert.deepEqual(f.h.cards[0].rect, { x: 56, y: 64, w: 320, h: 80 });
  assert.equal(f.h.state.focused, "note:1");
});

test("Task10 fix1: identical ACK still writes and reads main without publishing unchanged UI", async (t) => {
  const canonical = data([
    entity(1, "note", { x: 32, y: 32, w: null, h: null, z: 0, hidden: false }),
  ]);
  let writes = 0,
    reads = 0;
  const f = await mount(t, {
    getTableBoard: async () => {
      reads++;
      return structuredClone(canonical);
    },
    placeTableCards: async () => {
      writes++;
      return { success: true, placed: 1, placedKeys: ["note:1"] };
    },
  });
  const before = f.commits.length;
  await act(() => f.h.place([{ type: "note", id: 1, x: 32, y: 32 }]));
  assert.equal(writes, 1);
  assert.equal(reads, 2, "canonical main read is never skipped");
  assert.equal(f.commits.length, before, "unchanged ACK and read are not UI changes");
});

test("Task10 fix2: logical actions and ACK reconciliation are current before one paint publication", async (t) => {
  let canonical = data([
    entity(1, "note", { x: 32, y: 32, w: null, h: null, z: 0, hidden: false }),
  ]);
  const f = await mount(
    t,
    {
      getTableBoard: async () => structuredClone(canonical),
      placeTableCards: async (_id, placements) => {
        const { type: _type, id: _entityId, ...layout } = placements[0];
        canonical.cards[0].layout = { ...canonical.cards[0].layout, ...layout };
        return { success: true, placed: 1, placedKeys: ["note:1"] };
      },
    },
    1,
    true
  );
  await f.flush();
  const before = f.commits.length;
  await act(async () => {
    f.h.dispatch({ type: "moved", positions: { "note:1": { x: 80, y: 88 } } });
    f.h.dispatch({ type: "resized", key: "note:1", size: { w: 320, h: 80 } });
    assert.deepEqual(f.h.read().overrides["note:1"], { x: 80, y: 88 });
    assert.deepEqual(f.h.read().sizes["note:1"], { w: 320, h: 80 });
    assert.equal(await f.h.place([{ type: "note", id: 1, x: 80, y: 88, w: 320, h: 80 }]), true);
    assert.equal(f.h.read().board.cards[0].layout.x, 80, "ACK settled synchronously before paint");
    assert.equal(f.h.read().sizes["note:1"], undefined);
    f.h.dispatch({ type: "focus", key: "note:1" });
  });
  assert.equal(f.commits.length, before);
  await f.flush();
  assert.equal(f.commits.length, before + 1);
  assert.deepEqual(f.h.cards[0].rect, { x: 80, y: 88, w: 320, h: 80 });
  assert.equal(f.h.state.focused, "note:1");
});

test("Task10 fix2: scope retirement cannot expose the previous paint board", async (t) => {
  const f = await mount(t, { getTableBoard: async (id) => ({ ...data(), spaceId: id }) }, 1, true);
  await f.flush();
  await act(() => f.h.dispatch({ type: "moved", positions: { "note:1": { x: 500, y: 500 } } }));
  await f.render(2);
  assert.notEqual(f.h.state.board?.spaceId, 1, "new scope must not paint the previous board");
  assert.equal(f.h.read().board.spaceId, 2);
  await f.flush();
  assert.equal(f.h.state.board.spaceId, 2);
  assert.deepEqual(f.h.state.overrides, {});
  const count = f.commits.length;
  await f.unmount();
  await f.flush();
  assert.equal(f.commits.length, count, "no scheduled publication survives unmount");
});

test("Task10 fix2: transient world actions notify the synchronous DOM owner without a React paint", async (t) => {
  const f = await mount(t, { getTableBoard: async () => data() }, 1, true);
  await f.flush();
  const before = f.commits.length;
  const observed = [];
  const off = f.h.subscribe?.(() => observed.push(f.h.read().viewport.x));
  await act(() => {
    f.h.setViewport({ x: 73, y: 19, scale: 0.25 }, false);
    f.h.dispatch({ type: "moved", positions: { "note:1": { x: 90, y: 99 } } });
  });
  assert.deepEqual(f.h.read().overrides["note:1"], { x: 90, y: 99 });
  assert.deepEqual(observed, [73, 73], "the DOM owner sees both logical actions immediately");
  await f.flush();
  assert.equal(
    f.commits.length,
    before,
    "transient projection is owned by semantic DOM, not a stale React repaint"
  );
  off();
});

test("Task10 fix2: changed canonical metadata preserves unchanged source identities, changed content invalidates", async (t) => {
  let canonical = data([entity(1)]);
  const f = await mount(t, { getTableBoard: async () => structuredClone(canonical) });
  const source = f.h.cards[0].entity;
  canonical.viewport = { x: 12, y: 24, scale: 0.5 };
  await act(() => f.h.reload());
  assert.deepEqual(f.h.state.board.viewport, canonical.viewport);
  assert.ok(
    f.h.cards[0].entity === source,
    "canonical metadata does not remount/rebuild unchanged content"
  );
  canonical.cards[0].title = "Changed authoritative title";
  await act(() => f.h.reload());
  assert.equal(f.h.cards[0].entity.title, canonical.cards[0].title);
  assert.notEqual(f.h.cards[0].entity, source);
});

test("Task10 fix2: measured values are synchronous and one native delivery projects layout once", async (t) => {
  const f = await mount(t, { getTableBoard: async () => data([entity(1), entity(2)]) }, 1, true);
  await f.flush();
  let notices = 0;
  const off = f.h.subscribe(() => notices++);
  await act(async () => {
    f.h.dispatch({ type: "measured", key: "note:1", h: 225 });
    f.h.dispatch({ type: "measured", key: "note:2", h: 250 });
    assert.equal(f.h.read().measured["note:1"], 225);
    assert.equal(f.h.read().measured["note:2"], 250);
    assert.equal(notices, 0);
    await Promise.resolve();
    assert.equal(notices, 1, "all actual measurements share a before-paint layout projection");
  });
  await act(() => f.h.dispatch({ type: "focus", key: "note:2" }));
  await f.flush();
  assert.equal(f.h.state.measured["note:2"], 250);
  off();
});

test("Task10 fix2: refusal authority and status notification precede its paint snapshot", async (t) => {
  const f = await mount(
    t,
    {
      getTableBoard: async () => data(),
      placeTableCards: async () => ({ success: false, code: "TABLE_FULL" }),
    },
    1,
    true
  );
  await f.flush();
  const observed = [];
  const off = f.h.subscribe(() => observed.push(f.h.readStatus()));
  await act(async () => {
    assert.equal(await f.h.place([{ type: "note", id: 1, x: 40, y: 48 }]), false);
    assert.equal(f.h.readStatus(), "full");
    assert.equal(
      f.h.status,
      "idle",
      "logical acceptance is independent of the pending paint snapshot"
    );
    assert.ok(observed.includes("full"), "visible status owner was notified synchronously");
  });
  await f.flush();
  assert.equal(f.h.status, "full");
  off();
});

test("Task10 fix2: a cancelled publication callback cannot flush a reactivated owner", async (t) => {
  const f = await mount(t, { getTableBoard: async () => data() }, 1, true);
  await f.flush();
  await act(() => f.h.dispatch({ type: "focus", key: "note:1" }));
  const old = [...f.frames.values()][0];
  f.publication.dispose();
  f.publication.activate();
  await act(() => f.h.dispatch({ type: "focus", key: null }));
  const before = f.commits.length;
  await act(() => old());
  assert.equal(
    f.commits.length,
    before,
    "retired callback must not publish the newer pending state"
  );
  await f.flush();
  assert.equal(f.commits.length, before + 1);
});

test("Task10 fix2: logical projection identity survives viewport actions and invalidates synchronously for geometry", async (t) => {
  const f = await mount(t, { getTableBoard: async () => data() }, 1, true);
  await f.flush();
  assert.ok(Array.isArray(f.h.readCards?.()), "logical owner provides the current projection");
  const before = f.h.readCards();
  await act(() => f.h.setViewport({ x: 12, y: 24, scale: 0.25 }, false));
  assert.equal(f.h.readCards(), before);
  await act(() => f.h.dispatch({ type: "moved", positions: { "note:1": { x: 77, y: 88 } } }));
  const moved = f.h.readCards();
  assert.notEqual(moved, before);
  assert.equal(moved[0].rect.x, 77);
  assert.equal(f.h.cards[0].rect.x, 32, "paint snapshot may lag, handler projection must not");
  await act(() => f.h.dispatch({ type: "measured", key: "note:1", h: 240 }));
  assert.equal(f.h.readCards()[0].rect.h, 240);
});

test("Task10 fix2: a retired scope handler cannot restore sizing into a same-key newer board", async (t) => {
  const f = await mount(t, { getTableBoard: async (id) => ({ ...data(), spaceId: id }) }, 1, true);
  await f.flush();
  const oldDispatch = f.h.dispatch;
  await f.render(2);
  await f.flush();
  await act(() => oldDispatch({ type: "resized", key: "note:1", size: { w: 600, h: 600 } }));
  assert.deepEqual(
    f.h.read().sizes,
    {},
    "old Canvas cleanup has no authority over a new scope's same key"
  );
});

test("Task10 fix3: intrinsic measurement projects current geometry without a separate React commit", async (t) => {
  const f = await mount(t, { getTableBoard: async () => data() }, 1, true);
  await f.flush();
  const before = f.commits.length;
  let height;
  const off = f.h.subscribe(() => {
    height = f.h.readCards()[0].rect.h;
  });
  await act(async () => {
    f.h.dispatch({ type: "measured", key: "note:1", h: 237 });
    assert.equal(f.h.readCards()[0].rect.h, 237);
    await Promise.resolve();
    assert.equal(height, 237, "the real layout owner receives the current intrinsic height");
  });
  await f.flush();
  assert.equal(f.commits.length, before, "measurement has a DOM owner, not another entry paint");
  await act(() => f.h.dispatch({ type: "focus", key: "note:1" }));
  await f.flush();
  assert.equal(f.h.cards[0].rect.h, 237, "later semantic publication retains the measurement");
  assert.equal(f.h.state.focused, "note:1");
  off();
});

test("Task10 fix4: an ancestor render consumes current board publication without a redundant frame", async (t) => {
  const f = await mount(t, { getTableBoard: async () => data() }, 1, true);
  assert.ok(f.h.read().board, "logical initial read is already current");
  assert.ok(f.frames.size, "initial snapshot still has a queued frame");
  await f.render(1);
  assert.equal(f.h.state.board, f.h.read().board, "ancestor paint includes the current snapshot");
  const afterAncestor = f.commits.length;
  await f.flush();
  assert.equal(f.commits.length, afterAncestor, "an already painted snapshot has no second commit");
  await act(() => f.h.dispatch({ type: "select", keys: ["note:1"] }));
  assert.deepEqual(f.h.read().selection, ["note:1"]);
  await f.flush();
  assert.equal(f.commits.length, afterAncestor + 1, "a later logical change still publishes");
  assert.deepEqual(f.h.state.selection, ["note:1"]);
});

test("Task10 fix4: a newer logical snapshot during commit keeps its scheduled publication", async (t) => {
  const f = await mount(t, { getTableBoard: async () => data() }, 1, true);
  await f.render(1, (board) => board.dispatch({ type: "select", keys: ["note:1"] }));
  assert.deepEqual(f.h.state.selection, [], "the ancestor rendered the earlier snapshot");
  assert.deepEqual(f.h.read().selection, ["note:1"], "the child layout action is synchronous");
  assert.ok(f.frames.size, "parent layout cannot cancel a newer logical snapshot");
  const before = f.commits.length;
  await f.flush();
  assert.equal(f.commits.length, before + 1);
  assert.deepEqual(f.h.state.selection, ["note:1"]);
});

test("Task10 fix5: immediate child layout measurement retires an already covered semantic publication", async (t) => {
  const f = await mount(t, { getTableBoard: async () => data() }, 1, true);
  assert.ok(f.frames.size, "the canonical board snapshot is queued");
  await f.render(1, (board) => board.dispatch({ type: "measured", key: "note:1", h: 468 }));
  assert.equal(f.h.readCards()[0].rect.h, 468, "logical natural measurement is immediate");
  assert.equal(f.h.state.board, f.h.read().board, "the semantic board is already in this commit");
  const count = f.commits.length;
  await f.flush();
  assert.equal(
    f.commits.length,
    count,
    "projection-only child measurement needs no extra semantic commit"
  );
  await act(() => f.h.dispatch({ type: "select", keys: ["note:1"] }));
  await f.flush();
  assert.equal(
    f.h.state.measured["note:1"],
    468,
    "later semantic snapshots preserve the measurement"
  );
});

test("final fix: live canonical edges change before the deferred React board snapshot", async (t) => {
  let canonical = data([entity(1), entity(2)]);
  const f = await mount(t, { getTableBoard: async () => structuredClone(canonical) }, 1, true);
  await f.flush();
  const count = f.commits.length;
  assert.deepEqual(f.h.readEdges(), []);
  canonical.links = [{ a: { type: "note", id: 1 }, b: { type: "note", id: 2 } }];
  await act(() => f.h.reload());
  assert.equal(f.commits.length, count);
  assert.deepEqual(
    f.h.readEdges().map((e) => [e.a, e.b]),
    [["note:1", "note:2"]]
  );
  const edges = f.h.readEdges();
  await act(() => f.h.dispatch({ type: "moved", positions: { "note:1": { x: 80, y: 90 } } }));
  assert.equal(f.h.readEdges(), edges, "geometry-only updates retain canonical edge identity");
  canonical.links = [];
  await act(() => f.h.reload());
  assert.deepEqual(f.h.readEdges(), []);
  assert.equal(f.commits.length, count);
  await f.flush();
  assert.deepEqual(f.h.edges, []);
});
