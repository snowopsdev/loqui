const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/table/tableModel.ts");
const loadEdges = () => import("../../src/components/table/tableEdges.ts");

const entity = (type, id, extra = {}) => ({
  ref: { type, id },
  kind: type === "chat" ? "chat" : type === "dictation" ? "dictation" : "note",
  title: type === "dictation" ? null : `T${id}`,
  excerpt: "body",
  at: "2026-10-14 10:00:00",
  durationMs: null,
  participants: [],
  hrefs: [],
  noteId: null,
  layout: null,
  ...extra,
});
const board = (cards, extra = {}) => ({
  spaceId: 1,
  cards,
  inbox: [],
  links: [],
  viewport: null,
  truncated: false,
  ...extra,
});

test("placed cards keep their spot; unplaced ones flow below them on the grid", async () => {
  const { buildCards } = await load();
  const cards = buildCards([
    entity("note", 1, { layout: { x: 96, y: 40, w: null, h: null, z: 2, hidden: false } }),
    entity("note", 2),
    entity("chat", 3),
  ]);
  assert.deepEqual(
    cards.map((c) => [c.key, c.placed, c.rect.x, c.rect.y, c.rect.w]),
    [
      ["note:1", true, 96, 40, 280],
      ["note:2", false, 96, 256, 280],
      ["chat:3", false, 472, 256, 340],
    ]
  );
  assert.equal(cards[0].z, 2);
});

test("measured heights replace estimates", async () => {
  const { buildCards } = await load();
  const [c] = buildCards([entity("note", 1)], { "note:1": 230 });
  assert.equal(c.rect.h, 230);
});

test("a resized height below the content height wins, and connectors follow it", async () => {
  const { buildCards } = await load();
  const { connectorPath } = await import("../../src/components/table/tableGeometry.ts");
  const [small, below] = buildCards(
    [
      entity("note", 1, { layout: { x: 0, y: 0, w: 280, h: 80, z: 0, hidden: false } }),
      entity("note", 2, { layout: { x: 0, y: 300, w: 280, h: null, z: 0, hidden: false } }),
    ],
    { "note:1": 230, "note:2": 152 }
  );
  assert.equal(small.rect.h, 80, "the stored h beats the measured 230");
  assert.equal(connectorPath(small.rect, below.rect), "M140 80 C140 190 140 190 140 300");
});

test("edges merge stored links, chat-about-note and mention links, once each, on-board only", async () => {
  const { buildCards, deriveEdges } = await load();
  const { parseEntityHref } = await loadEdges();
  const cards = buildCards([
    entity("note", 1, { hrefs: ["note:2", "note:9", "https://x"] }),
    entity("note", 2, { hrefs: ["note:1"] }),
    entity("chat", 3, { noteId: 1 }),
  ]);
  const edges = deriveEdges(
    cards,
    [
      { a: { type: "chat", id: 3 }, b: { type: "note", id: 1 } },
      { a: { type: "note", id: 2 }, b: { type: "dictation", id: 99 } },
    ],
    parseEntityHref
  );
  assert.deepEqual(edges, [
    { a: "chat:3", b: "note:1" },
    { a: "note:1", b: "note:2" },
  ]);
});

test("entity hrefs map meetings to note cards and ignore folders and people", async () => {
  const { parseEntityHref } = await loadEdges();
  assert.deepEqual(parseEntityHref("note:12"), { type: "note", id: 12 });
  assert.deepEqual(parseEntityHref("meeting:4"), { type: "note", id: 4 });
  assert.deepEqual(parseEntityHref("dictation:7"), { type: "dictation", id: 7 });
  assert.equal(parseEntityHref("folder:2"), null);
  assert.equal(parseEntityHref("mention:maya%40x"), null);
  assert.equal(parseEntityHref("note:abc"), null);
  assert.equal(parseEntityHref("note:0"), null);
});

test("excerpts drop markdown syntax and cut on a word", async () => {
  const { plainExcerpt } = await load();
  assert.equal(
    plainExcerpt("# Plan\n- [ ] Ship **Thursday** with [Maya](mention:m)\n> quoted `code`"),
    "Plan Ship Thursday with Maya quoted code"
  );
  assert.equal(plainExcerpt("one two three four", 9), "one two…");
});

test("selection context names the space and fences each item", async () => {
  const { buildSelectionContext } = await load();
  const ctx = buildSelectionContext("Work", [
    entity("note", 1, { title: 'He said "hi"' }),
    entity("dictation", 2),
  ]);
  assert.match(ctx, /^The user selected 2 items on the canvas of the space "Work"\./);
  assert.match(ctx, /<item type="note" title="He said &quot;hi&quot;"/);
  assert.match(ctx, /<item type="dictation" title=""/);
});

test("pinning freezes up to 12 selected items and refuses more, never truncating", async () => {
  const { pinSelection, SELECTION_AI_LIMIT } = await load();
  assert.equal(SELECTION_AI_LIMIT, 12);
  const twelve = Array.from({ length: 12 }, (_, i) => entity("note", i + 1));
  const pin = pinSelection("Work", twelve);
  assert.equal(pin.keys.length, 12);
  assert.match(pin.context, /^The user selected 12 items/);
  assert.equal((pin.context.match(/<item /g) || []).length, 12);
  assert.deepEqual(pinSelection("Work", [...twelve, entity("note", 13)]), { error: "tooMany" });
  assert.deepEqual(pinSelection("Work", []), { error: "empty" });
});

test("board context names the total and says which items it left out", async () => {
  const { buildBoardContext } = await load();
  const ctx = buildBoardContext(
    "Work",
    Array.from({ length: 20 }, (_, i) => entity("note", i + 1))
  );
  assert.match(
    ctx,
    /holds 20 cards\. Excerpts of the first 12 are below; the rest are not included\./
  );
  assert.equal((ctx.match(/<item /g) || []).length, 12);
});

test("grouped notes list every source, untitled dictations by kind", async () => {
  const { buildGroupedNote } = await load();
  const out = buildGroupedNote(
    [entity("note", 1), entity("dictation", 2, { excerpt: "Remind me" })],
    {
      title: "Grouped",
      untitled: "Untitled",
      kind: { note: "Note", meeting: "Meeting", dictation: "Dictation", chat: "Answer" },
    }
  );
  assert.equal(out.title, "Grouped");
  assert.equal(out.content, "- **T1**: body\n- **Dictation**: Remind me");
});

test("a new dictation becomes an inbox entity", async () => {
  const { dictationEntityFromItem } = await load();
  const e = dictationEntityFromItem({
    id: 5,
    text: "Hi there",
    timestamp: "2026-10-14 11:00:00",
    audio_duration_ms: 4000,
  });
  assert.deepEqual(
    [e.ref, e.kind, e.excerpt, e.durationMs, e.layout],
    [{ type: "dictation", id: 5 }, "dictation", "Hi there", 4000, null]
  );
});

test("reducer: drag overrides move cards until placement lands in the board", async () => {
  const { initialTableState, tableReducer, cardsFor, placementsFor } = await load();
  let s = tableReducer(initialTableState(), { type: "loaded", board: board([entity("note", 1)]) });
  s = tableReducer(s, { type: "moved", positions: { "note:1": { x: 500, y: 60 } } });
  assert.deepEqual(cardsFor(s)[0].rect.x, 500);
  const placements = placementsFor(s, ["note:1"]);
  assert.deepEqual(placements, [{ type: "note", id: 1, x: 504, y: 64, w: null, h: null, z: 0 }]);
  s = tableReducer(s, { type: "placed", placements });
  assert.deepEqual(s.overrides, {});
  assert.deepEqual([cardsFor(s)[0].placed, cardsFor(s)[0].rect.x], [true, 504]);
});

test("reducer: clicks select, shift-clicks toggle, hidden cards leave selection and go to the inbox", async () => {
  const { initialTableState, tableReducer } = await load();
  let s = tableReducer(initialTableState(), {
    type: "loaded",
    board: board([entity("note", 1), entity("note", 2)]),
  });
  s = tableReducer(s, { type: "clickCard", key: "note:1", additive: false });
  s = tableReducer(s, { type: "clickCard", key: "note:2", additive: true });
  assert.deepEqual(s.selection, ["note:1", "note:2"]);
  s = tableReducer(s, { type: "clickCard", key: "note:1", additive: true });
  assert.deepEqual(s.selection, ["note:2"]);
  s = tableReducer(s, { type: "hidden", keys: ["note:2"] });
  assert.deepEqual(s.selection, []);
  assert.deepEqual(
    s.board.cards.map((c) => c.ref.id),
    [1]
  );
  assert.deepEqual(
    s.board.inbox.map((c) => c.ref.id),
    [2]
  );
});

test("reducer: the first load restores the saved view; reloads keep the live view and drop stale selection", async () => {
  const { initialTableState, tableReducer } = await load();
  let s = tableReducer(initialTableState(), {
    type: "loaded",
    board: board([entity("note", 1)], { viewport: { x: 5, y: 6, scale: 0.5 } }),
  });
  assert.deepEqual(s.viewport, { x: 5, y: 6, scale: 0.5 });
  s = tableReducer(s, { type: "viewport", viewport: { x: 90, y: 0, scale: 1 } });
  s = tableReducer(s, { type: "select", keys: ["note:1"] });
  s = tableReducer(s, { type: "focus", key: "note:1" });
  s = tableReducer(s, {
    type: "loaded",
    board: board([], { viewport: { x: 5, y: 6, scale: 0.5 } }),
  });
  assert.deepEqual([s.selection, s.focused, s.viewport], [[], null, { x: 90, y: 0, scale: 1 }]);
});

test("reducer: arrivals join the inbox once", async () => {
  const { initialTableState, tableReducer, dictationEntityFromItem } = await load();
  let s = tableReducer(initialTableState(), { type: "loaded", board: board([]) });
  const e = dictationEntityFromItem({ id: 9, text: "x", timestamp: "t", audio_duration_ms: null });
  s = tableReducer(s, { type: "inboxArrived", entity: e });
  s = tableReducer(s, { type: "inboxArrived", entity: e });
  assert.equal(s.board.inbox.length, 1);
});

test("reference keys round-trip only positive safe entity IDs", async () => {
  const { refKey, parseRefKey } = await load();
  for (const type of ["note", "dictation", "chat"]) {
    const ref = { type, id: 7 };
    assert.deepEqual(parseRefKey(refKey(ref)), ref);
  }
  for (const key of [
    "meeting:1",
    "note:0",
    "note:-1",
    "note:1.5",
    "note:01",
    "note:9007199254740992",
    "note:1x",
  ]) {
    assert.equal(parseRefKey(key), null, key);
  }
  const { parseEntityHref } = await loadEdges();
  assert.equal(parseEntityHref("note:9007199254740992"), null);
});

test("each card kind has its intended natural size and connectors ignore self links", async () => {
  const { buildCards, deriveEdges } = await load();
  const { parseEntityHref } = await loadEdges();
  const cards = buildCards([
    entity("note", 1),
    entity("note", 2, { kind: "meeting" }),
    entity("dictation", 3),
    entity("chat", 4),
  ]);
  assert.deepEqual(
    cards.map((c) => [c.rect.w, c.rect.h]),
    [
      [280, 152],
      [320, 176],
      [220, 112],
      [340, 176],
    ]
  );
  assert.deepEqual(
    deriveEdges(cards, [{ a: cards[0].entity.ref, b: cards[0].entity.ref }], parseEntityHref),
    []
  );
});

test("pinning snapshots every item and source mutations cannot change the pin", async () => {
  const { buildSelectionContext, pinSelection } = await load();
  const sources = Array.from({ length: 12 }, (_, i) =>
    entity("note", i + 1, { excerpt: `unique body ${i + 1}` })
  );
  const pin = pinSelection("Work", sources);
  for (const source of sources) assert.ok(pin.context.includes(source.excerpt));
  const snapshot = structuredClone(pin);
  sources[0].ref.id = 999;
  sources[0].excerpt = "changed";
  sources.splice(1);
  assert.deepEqual(pin, snapshot);
  assert.equal(
    (
      buildSelectionContext(
        "Work",
        Array.from({ length: 13 }, (_, i) => entity("note", i + 1))
      ).match(/<item /g) || []
    ).length,
    13,
    "the builder never silently drops items; pinning is the admission limit"
  );
});

test("board context is honest for empty and small boards; event excerpts stay bounded", async () => {
  const { buildBoardContext, dictationEntityFromItem } = await load();
  assert.match(buildBoardContext("Empty", []), /holds 0 cards/);
  assert.match(
    buildBoardContext("Small", [entity("note", 1)]),
    /Excerpts of all of them are below/
  );
  const e = dictationEntityFromItem({
    id: 1,
    text: "x".repeat(700),
    timestamp: "t",
    audio_duration_ms: null,
  });
  assert.equal(e.excerpt.length, 600);
  assert.equal(e.durationMs, null);
});

test("grouping includes every selected source, including sources after twelve", async () => {
  const { buildGroupedNote } = await load();
  const sources = Array.from({ length: 14 }, (_, i) => entity("note", i + 1));
  const before = structuredClone(sources);
  const result = buildGroupedNote(sources, {
    title: "Grouped",
    untitled: "Untitled",
    kind: { note: "Note", meeting: "Meeting", dictation: "Dictation", chat: "Answer" },
  });
  assert.equal(result.content.split("\n").length, 14);
  assert.match(result.content, /\*\*T14\*\*/);
  assert.deepEqual(sources, before, "grouping does not alter or delete sources");
});

test("natural measured geometry never becomes persisted sizing on move and reopen", async () => {
  const { initialTableState, tableReducer, cardsFor, placementsFor } = await load();
  let s = tableReducer(initialTableState(), {
    type: "loaded",
    board: board([
      entity("note", 1),
      entity("note", 2, { layout: { x: 0, y: 0, w: 300, h: 80, z: 3, hidden: false } }),
    ]),
  });
  s = tableReducer(s, { type: "measured", key: "note:1", h: 240 });
  s = tableReducer(s, { type: "measured", key: "note:2", h: 300 });
  s = tableReducer(s, { type: "moved", positions: { "note:1": { x: 101, y: 107 } } });
  const placements = placementsFor(s, ["note:1", "note:2"], { "note:2": { x: 72, y: 16 } });
  assert.deepEqual(
    placements.find((p) => p.id === 1),
    { type: "note", id: 1, x: 104, y: 104, w: null, h: null, z: 0 }
  );
  assert.deepEqual(
    placements.find((p) => p.id === 2),
    { type: "note", id: 2, x: 72, y: 16, w: 300, h: 80, z: 3 }
  );
  s = tableReducer(s, { type: "placed", placements });
  s = tableReducer(s, { type: "loaded", board: structuredClone(s.board) });
  s = tableReducer(s, { type: "measured", key: "note:1", h: 360 });
  assert.equal(cardsFor(s).find((c) => c.key === "note:1").rect.h, 360);
  assert.equal(placementsFor(s, ["note:1"])[0].h, null);
  assert.equal(cardsFor(s).find((c) => c.key === "note:2").rect.h, 80);
});

test("placement prunes displaced selection and focus by identity and leaves unrelated overrides", async () => {
  const { initialTableState, tableReducer } = await load();
  const notes = Array.from({ length: 500 }, (_, i) => entity("note", 500 - i));
  let s = tableReducer(initialTableState(), {
    type: "loaded",
    board: board(notes, {
      inbox: [entity("dictation", 7)],
      links: [
        { a: { type: "note", id: 1 }, b: { type: "note", id: 500 } },
        { a: { type: "dictation", id: 7 }, b: { type: "note", id: 500 } },
      ],
    }),
  });
  s = tableReducer(s, { type: "select", keys: ["note:500", "note:1"] });
  s = tableReducer(s, { type: "focus", key: "note:1" });
  s = tableReducer(s, {
    type: "moved",
    positions: {
      "note:500": { x: 8, y: 16 },
      "note:1": { x: 24, y: 32 },
      "dictation:7": { x: 0, y: 0 },
    },
  });
  s = tableReducer(s, { type: "placed", placements: [{ type: "dictation", id: 7, x: 40, y: 48 }] });
  assert.equal(s.board.cards.length, 500);
  assert.equal(s.board.cards[0].ref.type, "dictation");
  assert.deepEqual(s.selection, ["note:500"]);
  assert.equal(s.focused, null);
  assert.deepEqual(s.overrides, { "note:500": { x: 8, y: 16 } });
  assert.equal(s.board.truncated, true);
  assert.equal(s.board.inbox.length, 0, "displaced automatic notes are not removed content");
  assert.deepEqual(
    s.board.links,
    [{ a: { type: "dictation", id: 7 }, b: { type: "note", id: 500 } }],
    "projection only retains links whose endpoints remain available"
  );
});

test("placing an automatic old note retains every arranged card and its exact geometry", async () => {
  const { initialTableState, tableReducer } = await load();
  const layout = { x: -120, y: 640, w: 340, h: 80, z: 9, hidden: false };
  const arranged = entity("chat", 7, { at: "2020-01-01 00:00:00", layout });
  const automatic = Array.from({ length: 499 }, (_, i) => entity("note", 499 - i));
  let s = tableReducer(initialTableState(), {
    type: "loaded",
    board: board([arranged, ...automatic]),
  });
  s = tableReducer(s, { type: "select", keys: ["chat:7", "note:1"] });
  s = tableReducer(s, { type: "focus", key: "chat:7" });
  const before = structuredClone(s);
  s = tableReducer(s, { type: "placed", placements: [{ type: "note", id: 1, x: 8, y: 16 }] });
  assert.equal(s.board.cards.length, 500);
  assert.deepEqual(
    s.board.cards.slice(0, 2).map((e) => e.ref),
    [
      { type: "note", id: 1 },
      { type: "chat", id: 7 },
    ]
  );
  assert.deepEqual(s.board.cards[1], arranged);
  assert.deepEqual(s.board.cards[1].layout, layout);
  assert.equal(s.board.truncated, false, "promoting an on-board card does not omit content");
  assert.deepEqual(s.selection, ["chat:7", "note:1"]);
  assert.equal(s.focused, "chat:7");
  assert.deepEqual(before.board.cards[0], arranged, "projection did not mutate the previous board");
});

test("accepted Inbox placement matches main's capped projection and reopen without moving the live view", async () => {
  const { spawnSync } = require("node:child_process");
  // Keep native SQLite in a separate, loader-free process; the renderer test
  // runner uses tsx, whose loader worker can race SQLite during Node cleanup.
  const fixture = spawnSync(
    process.execPath,
    [
      "-e",
      `
    const { createDb } = require(${JSON.stringify(require.resolve("../helpers/harness/db"))});
    const cleanup = [];
    const db = createDb({ after: (fn) => cleanup.push(fn), skip: (why) => { throw Error(why); } });
    try {
      const spaceId = db.getPrivateSpaceId();
      db.db.transaction(() => { for (let i = 0; i < 500; i++) db.saveNote('n' + i, 'preserved ' + i); })();
      const id = db.saveTranscription('capture body').id;
      const before = db.getTableBoard(spaceId);
      const placements = [{ type: 'dictation', id, x: 240, y: 80, w: null, h: null, z: 4 }];
      const ack = db.placeTableCards(spaceId, placements);
      const after = db.getTableBoard(spaceId);
      db.db.close();
      const reopened = new db.constructor();
      try {
        process.stdout.write('TABLE_FIXTURE:' + JSON.stringify({ before, placements, ack, after, reopened: reopened.getTableBoard(spaceId), noteCount: reopened.db.prepare('SELECT COUNT(*) AS n FROM notes').get().n }) + '\\n');
      } finally { reopened.db.close(); }
    } finally { for (const fn of cleanup.reverse()) fn(); }
  `,
    ],
    { encoding: "utf8" }
  );
  assert.equal(fixture.status, 0, fixture.stderr || fixture.stdout);
  const snapshots = JSON.parse(
    fixture.stdout
      .split("\n")
      .find((line) => line.startsWith("TABLE_FIXTURE:"))
      .slice("TABLE_FIXTURE:".length)
  );
  assert.equal(snapshots.before.cards.length, 500);
  assert.equal(snapshots.ack.success, true);
  assert.equal(snapshots.noteCount, 500, "all source notes still exist");
  const { initialTableState, tableReducer } = await load();
  let s = tableReducer(initialTableState(), { type: "loaded", board: snapshots.before });
  const retained = `note:${snapshots.before.cards[0].ref.id}`;
  s = tableReducer(s, { type: "select", keys: [retained] });
  s = tableReducer(s, { type: "focus", key: retained });
  s = tableReducer(s, { type: "viewport", viewport: { x: 120, y: -80, scale: 0.75 } });
  s = tableReducer(s, { type: "placed", placements: snapshots.placements });
  assert.equal(s.board.cards.length, 500);
  assert.deepEqual(s.board.cards, snapshots.after.cards);
  assert.deepEqual(s.board.cards, snapshots.reopened.cards);
  assert.deepEqual(s.board.inbox, snapshots.after.inbox);
  assert.equal(s.board.truncated, true);
  assert.deepEqual(s.selection, [retained]);
  assert.equal(s.focused, retained);
  assert.deepEqual(s.viewport, { x: 120, y: -80, scale: 0.75 });
  const localCards = s.board.cards;
  s = tableReducer(s, { type: "loaded", board: snapshots.reopened });
  assert.deepEqual(s.board.cards, localCards);
  assert.deepEqual(s.selection, [retained]);
  assert.equal(s.focused, retained);
  assert.deepEqual(s.viewport, { x: 120, y: -80, scale: 0.75 });
});

test("resize previews serialize sizes, commit clears overrides, exact rollback restores nullable and prior override states", async () => {
  const { initialTableState, tableReducer, cardsFor, placementsFor } = await load();
  for (const persisted of [
    { w: null, h: null },
    { w: 312, h: 184 },
    { w: 312, h: null },
  ]) {
    for (const override of [null, { w: 408, h: 248 }]) {
      let s = tableReducer(initialTableState(), {
        type: "loaded",
        board: board([
          entity("note", 1, { layout: { x: 96, y: 40, ...persisted, z: 0, hidden: false } }),
        ]),
      });
      if (override) s = tableReducer(s, { type: "resized", key: "note:1", size: override });
      s = tableReducer(s, { type: "resized", key: "note:1", size: { w: 320, h: 80 } });
      assert.deepEqual(
        [cardsFor(s)[0].rect.w, cardsFor(s)[0].rect.h, cardsFor(s)[0].fixedH],
        [320, 80, 80]
      );
      assert.deepEqual(placementsFor(s, ["note:1"])[0], {
        type: "note",
        id: 1,
        x: 96,
        y: 40,
        w: 320,
        h: 80,
        z: 0,
      });
      s = tableReducer(s, { type: "sizeRestored", key: "note:1", sizing: { persisted, override } });
      assert.deepEqual(s.sizes, override ? { "note:1": override } : {});
      assert.deepEqual(
        [placementsFor(s, ["note:1"])[0].w, placementsFor(s, ["note:1"])[0].h],
        [override?.w ?? persisted.w, override?.h ?? persisted.h]
      );
      s = tableReducer(s, { type: "measured", key: "note:1", h: 400 });
      assert.equal(cardsFor(s)[0].fixedH, override?.h ?? persisted.h);
      if (!override && persisted.h === null) assert.equal(cardsFor(s)[0].rect.h, 400);
    }
  }
  let s = tableReducer(initialTableState(), { type: "loaded", board: board([entity("note", 1)]) });
  s = tableReducer(s, { type: "resized", key: "note:1", size: { w: 320, h: 200 } });
  s = tableReducer(s, { type: "placed", placements: placementsFor(s, ["note:1"]) });
  assert.deepEqual(s.sizes, {});
  assert.equal(cardsFor(s)[0].fixedH, 200);
});
