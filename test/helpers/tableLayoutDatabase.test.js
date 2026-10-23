const test = require("node:test");
const assert = require("node:assert/strict");
const { createDb } = require("./harness/db");
const DatabaseManager = require("../../src/helpers/database");

function seed(db) {
  const spaceId = db.getPrivateSpaceId();
  const note = db.saveNote(
    "Pricing FAQ",
    "See [Review](note:999) and [web](https://x.test) and [@Maya](mention:maya%40x.test)",
    "personal",
    null,
    null,
    null,
    spaceId
  ).note;
  const meeting = db.saveNote(
    "Pricing review",
    "Decision: Thursday",
    "meeting",
    null,
    null,
    null,
    spaceId
  ).note;
  const dictation = db.saveTranscription(
    "Remind me to send the announcement.",
    "Remind me to send the announcement."
  ).id;
  const chat = db.createAgentConversation("Pricing", note.id, spaceId, null);
  db.addAgentMessage(chat.id, "user", "When does it ship?");
  db.addAgentMessage(chat.id, "assistant", "Thursday, not Monday.");
  return { spaceId, note, meeting, dictation, chatId: chat.id };
}
const keys = (list) => list.map((e) => `${e.ref.type}:${e.ref.id}`).sort();

test("a fresh board shows the space's notes unplaced and recent captures in the inbox", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, meeting, dictation, chatId } = seed(db);
  const board = db.getTableBoard(spaceId);
  assert.deepEqual(keys(board.cards), [`note:${meeting.id}`, `note:${note.id}`].sort());
  assert.ok(board.cards.every((c) => c.layout === null));
  assert.equal(board.cards.find((c) => c.ref.id === meeting.id).kind, "meeting");
  assert.deepEqual(keys(board.inbox), [`chat:${chatId}`, `dictation:${dictation}`].sort());
  assert.equal(board.inbox.find((e) => e.ref.type === "chat").excerpt, "Thursday, not Monday.");
  assert.equal(board.inbox.find((e) => e.ref.type === "chat").noteId, note.id);
  assert.deepEqual(
    board.cards.find((c) => c.ref.id === note.id).hrefs,
    ["note:999"],
    "web and person links are not entity links"
  );
  assert.equal(board.viewport, null);
  assert.equal(board.truncated, false);
});

test("placements persist across a reopen and only real entities can be placed", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, dictation } = seed(db);
  const res = db.placeTableCards(spaceId, [
    { type: "note", id: note.id, x: 232, y: 32 },
    { type: "dictation", id: dictation, x: 248, y: 240, w: 220 },
    { type: "note", id: 424242, x: 0, y: 0 },
    { type: "note", id: note.id + 0.5, x: 0, y: 0 },
    { type: "bogus", id: 1, x: 0, y: 0 },
    { type: "dictation", id: dictation, x: Number.NaN, y: 0 },
  ]);
  assert.deepEqual(res, {
    success: true,
    placed: 2,
    placedKeys: [`note:${note.id}`, `dictation:${dictation}`],
  });
  db.setTableViewport(spaceId, { x: -40, y: 12, scale: 9 });
  db.db.close();
  const reopened = new DatabaseManager();
  t.after(() => reopened.db.close());
  const board = reopened.getTableBoard(spaceId);
  assert.deepEqual(board.cards.find((c) => c.ref.type === "note" && c.ref.id === note.id).layout, {
    x: 232,
    y: 32,
    w: null,
    h: null,
    z: 0,
    hidden: false,
  });
  assert.equal(board.cards.find((c) => c.ref.type === "dictation").layout.w, 220);
  assert.ok(
    !board.inbox.some((e) => e.ref.type === "dictation"),
    "placed dictations leave the inbox"
  );
  assert.deepEqual(board.viewport, { x: -40, y: 12, scale: 2 }, "scale is clamped");
});

test("removing a note hides it and keeps the note; placing it again brings it back", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, dictation } = seed(db);
  db.placeTableCards(spaceId, [
    { type: "note", id: note.id, x: 40, y: 40 },
    { type: "dictation", id: dictation, x: 0, y: 0 },
  ]);
  db.hideTableCards(spaceId, [
    { type: "note", id: note.id },
    { type: "dictation", id: dictation },
  ]);
  let board = db.getTableBoard(spaceId);
  assert.ok(db.getNote(note.id), "the note itself is untouched");
  assert.ok(board.inbox.some((e) => e.ref.type === "note" && e.ref.id === note.id));
  assert.ok(!board.cards.some((c) => c.ref.type === "note" && c.ref.id === note.id));
  assert.ok(
    board.inbox.some((e) => e.ref.type === "dictation" && e.layout?.hidden),
    "a removed dictation goes back to the inbox"
  );
  db.placeTableCards(spaceId, [{ type: "note", id: note.id, x: 80, y: 80 }]);
  board = db.getTableBoard(spaceId);
  assert.equal(
    board.cards.find((c) => c.ref.type === "note" && c.ref.id === note.id).layout.hidden,
    false
  );
});

test("deleted entities are pruned and their links disappear", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, meeting, dictation } = seed(db);
  db.placeTableCards(spaceId, [
    { type: "note", id: note.id, x: 0, y: 0 },
    { type: "dictation", id: dictation, x: 0, y: 200 },
  ]);
  db.linkTableCards(spaceId, { type: "note", id: note.id }, { type: "dictation", id: dictation });
  db.linkTableCards(spaceId, { type: "note", id: meeting.id }, { type: "note", id: note.id });
  assert.equal(db.getTableBoard(spaceId).links.length, 2);
  db.deleteTranscription(dictation);
  db.deleteNote(meeting.id);
  const board = db.getTableBoard(spaceId);
  assert.deepEqual(board.links, []);
  const rows = db.db.prepare("SELECT entity_type, entity_id FROM note_layout").all();
  assert.deepEqual(rows, [{ entity_type: "note", entity_id: note.id }]);
});

test("links are undirected, deduplicated, and never self-referential", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, meeting } = seed(db);
  const a = { type: "note", id: note.id };
  const b = { type: "note", id: meeting.id };
  assert.equal(db.linkTableCards(spaceId, a, b).success, true);
  db.linkTableCards(spaceId, b, a);
  assert.equal(db.linkTableCards(spaceId, a, a).success, false);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM note_layout_links").get().n, 1);
});

test("the table refuses a 501st placed card and keeps the first 500", (t) => {
  const db = createDb(t);
  if (!db) return;
  const spaceId = db.getPrivateSpaceId();
  const ids = Array.from({ length: 501 }, (_, i) => db.saveTranscription(`d${i}`, `d${i}`).id);
  const first = db.placeTableCards(
    spaceId,
    ids.slice(0, 500).map((id, i) => ({ type: "dictation", id, x: i * 8, y: 0 }))
  );
  assert.equal(first.placed, 500);
  assert.deepEqual(db.placeTableCards(spaceId, [{ type: "dictation", id: ids[500], x: 0, y: 0 }]), {
    success: false,
    code: "TABLE_FULL",
  });
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM note_layout").get().n, 500);
});

test("an arranged old note survives 500 newer notes, and truncation is reported", (t) => {
  const db = createDb(t);
  if (!db) return;
  const spaceId = db.getPrivateSpaceId();
  const old = db.saveNote("Old but arranged", "", "personal", null, null, null, spaceId).note;
  db.placeTableCards(spaceId, [{ type: "note", id: old.id, x: 0, y: 0 }]);
  for (let i = 0; i < 500; i++) db.saveNote(`n${i}`, "", "personal", null, null, null, spaceId);
  const board = db.getTableBoard(spaceId);
  assert.equal(board.cards.length, 500);
  assert.ok(
    board.cards.some((c) => c.ref.id === old.id && c.layout),
    "the arranged card is kept"
  );
  assert.equal(board.truncated, true);
});

test("deleting an entity frees its capacity without a board read in between", (t) => {
  const db = createDb(t);
  if (!db) return;
  const spaceId = db.getPrivateSpaceId();
  const ids = Array.from({ length: 501 }, (_, i) => db.saveTranscription(`d${i}`, `d${i}`).id);
  db.placeTableCards(
    spaceId,
    ids.slice(0, 500).map((id) => ({ type: "dictation", id, x: 0, y: 0 }))
  );
  db.deleteTranscription(ids[0]);
  assert.equal(
    db.placeTableCards(spaceId, [{ type: "dictation", id: ids[500], x: 0, y: 0 }]).success,
    true
  );
});

test("links and hides to missing entities or Spaces are refused, and dead links are pruned", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, dictation } = seed(db);
  assert.equal(
    db.linkTableCards(spaceId, { type: "note", id: note.id }, { type: "note", id: 424242 }).success,
    false
  );
  assert.equal(db.hideTableCards(spaceId, [{ type: "note", id: 424242 }]).hidden, 0);
  assert.equal(db.getTableBoard(9999).cards.length, 0, "unknown Space reads empty");
  assert.deepEqual(db.placeTableCards(9999, [{ type: "note", id: note.id, x: 0, y: 0 }]), {
    success: false,
    code: "INVALID",
  });
  db.linkTableCards(spaceId, { type: "note", id: note.id }, { type: "dictation", id: dictation });
  db.deleteTranscription(dictation);
  db.getTableBoard(spaceId);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM note_layout_links").get().n, 0);
});

test("a removed old dictation stays in the inbox", (t) => {
  const db = createDb(t);
  if (!db) return;
  const spaceId = db.getPrivateSpaceId();
  const id = db.saveTranscription("from last month", "from last month").id;
  db.db
    .prepare("UPDATE transcriptions SET timestamp = datetime('now', '-30 days') WHERE id = ?")
    .run(id);
  db.placeTableCards(spaceId, [{ type: "dictation", id, x: 0, y: 0 }]);
  db.hideTableCards(spaceId, [{ type: "dictation", id }]);
  assert.ok(
    db.getTableBoard(spaceId).inbox.some((e) => e.ref.type === "dictation" && e.ref.id === id)
  );
});

test("an archived chat leaves the board: its row, links and capacity are released", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, chatId } = seed(db);
  db.placeTableCards(spaceId, [
    { type: "chat", id: chatId, x: 0, y: 0 },
    { type: "note", id: note.id, x: 320, y: 0 },
  ]);
  db.linkTableCards(spaceId, { type: "chat", id: chatId }, { type: "note", id: note.id });
  db.archiveAgentConversation(chatId);
  const board = db.getTableBoard(spaceId);
  assert.ok(
    !board.cards.some((c) => c.ref.type === "chat") &&
      !board.inbox.some((e) => e.ref.type === "chat")
  );
  assert.equal(
    db.db.prepare("SELECT COUNT(*) AS n FROM note_layout WHERE entity_type = 'chat'").get().n,
    0
  );
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM note_layout_links").get().n, 0);
  assert.equal(
    db.db.prepare("SELECT COUNT(*) AS n FROM note_layout WHERE hidden = 0").get().n,
    1,
    "only the note counts toward the cap"
  );
  assert.equal(
    db.placeTableCards(spaceId, [{ type: "chat", id: chatId, x: 0, y: 0 }]).placed,
    0,
    "an archived chat cannot be placed"
  );
  assert.equal(
    db.linkTableCards(spaceId, { type: "chat", id: chatId }, { type: "note", id: note.id }).success,
    false
  );
});

test("archiving frees capacity without a board read in between", (t) => {
  const db = createDb(t);
  if (!db) return;
  const spaceId = db.getPrivateSpaceId();
  const chat = db.createAgentConversation("c", null, spaceId, null);
  const ids = Array.from({ length: 500 }, (_, i) => db.saveTranscription(`d${i}`, `d${i}`).id);
  db.placeTableCards(spaceId, [
    { type: "chat", id: chat.id, x: 0, y: 0 },
    ...ids.slice(0, 499).map((id) => ({ type: "dictation", id, x: 0, y: 0 })),
  ]);
  db.archiveAgentConversation(chat.id);
  assert.equal(
    db.placeTableCards(spaceId, [{ type: "dictation", id: ids[499], x: 0, y: 0 }]).success,
    true
  );
});

test("a profile created before Plan 08 gains the table tables on open", (t) => {
  const db = createDb(t);
  if (!db) return;
  db.db.exec(
    "DROP TABLE note_layout; DROP TABLE note_layout_links; DROP TABLE note_layout_viewport;"
  );
  db.db.close();
  const reopened = new DatabaseManager();
  t.after(() => reopened.db.close());
  const names = reopened.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'note_layout%'")
    .all()
    .map((r) => r.name)
    .sort();
  assert.deepEqual(names, ["note_layout", "note_layout_links", "note_layout_viewport"]);
  assert.ok(reopened.getTableBoard(reopened.getPrivateSpaceId()));
});

function reopen(t, db) {
  db.db.close();
  const reopened = new DatabaseManager();
  t.after(() => reopened.db.close());
  return reopened;
}

function tableRows(db) {
  return ["note_layout", "note_layout_links", "note_layout_viewport"].map((name) =>
    db.db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()
  );
}

// A legacy/non-private row cannot be created through today's private-only schema.
// Inject it only in the isolated fixture to verify the IPC trust boundary still refuses it.
function legacySpace(db) {
  db.db.pragma("ignore_check_constraints = ON");
  try {
    return db.db.prepare("INSERT INTO spaces (kind, name) VALUES ('team', 'foreign')").run()
      .lastInsertRowid;
  } finally {
    db.db.pragma("ignore_check_constraints = OFF");
  }
}

test("all entry points refuse unsafe and non-private Spaces without writing", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, chatId } = seed(db);
  const foreign = legacySpace(db);
  const a = { type: "note", id: note.id };
  const b = { type: "chat", id: chatId };
  for (const id of [
    null,
    undefined,
    "1",
    0,
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    9999,
    foreign,
  ]) {
    assert.deepEqual(db.getTableBoard(id).cards, []);
    assert.deepEqual(db.placeTableCards(id, [{ ...a, x: 0, y: 0 }]), {
      success: false,
      code: "INVALID",
    });
    assert.deepEqual(db.hideTableCards(id, [a]), { success: false, hidden: 0 });
    assert.deepEqual(db.linkTableCards(id, a, b), { success: false });
    assert.deepEqual(db.setTableViewport(id, { x: 0, y: 0, scale: 1 }), { success: false });
  }
  assert.deepEqual(tableRows(db), [[], [], []]);
  db.db.prepare("UPDATE spaces SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(spaceId);
  assert.equal(db.placeTableCards(spaceId, [{ ...a, x: 0, y: 0 }]).success, false);
  assert.equal(db.setTableViewport(spaceId, { x: 0, y: 0, scale: 1 }).success, false);
});

test("foreign, deleted, incomplete and unsafe entities are refused in mixed batches", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, chatId } = seed(db);
  const foreign = legacySpace(db);
  const foreignNote = db.db
    .prepare("INSERT INTO notes (title, content, space_id) VALUES ('foreign', '', ?)")
    .run(foreign).lastInsertRowid;
  const foreignChat = db.db
    .prepare("INSERT INTO agent_conversations (title, space_id) VALUES ('foreign', ?)")
    .run(foreign).lastInsertRowid;
  const deleted = db.saveTranscription("gone").id;
  db.deleteTranscription(deleted);
  const incomplete = db.saveTranscription("pending", null, { status: "failed" }).id;
  const invalid = [
    null,
    {},
    { type: "toString", id: 1 },
    { type: "note", id: note.id + 0.5 },
    { type: "note", id: "1" },
    { type: "note", id: 0 },
    { type: "note", id: -1 },
    { type: "note", id: Number.MAX_SAFE_INTEGER + 1 },
    { type: "note", id: foreignNote },
    { type: "chat", id: foreignChat },
    { type: "dictation", id: deleted },
    { type: "dictation", id: incomplete },
  ];
  const placements = invalid.map((ref) => ({ ...ref, x: 0, y: 0 }));
  placements.push(
    { type: "note", id: note.id, x: NaN, y: 0 },
    { type: "note", id: note.id, x: 0, y: Infinity }
  );
  assert.deepEqual(
    db.placeTableCards(spaceId, [...placements, { type: "chat", id: chatId, x: 1, y: 2 }]),
    {
      success: true,
      placed: 1,
      placedKeys: [`chat:${chatId}`],
    }
  );
  assert.deepEqual(db.hideTableCards(spaceId, [...invalid, { type: "note", id: note.id }]), {
    success: true,
    hidden: 1,
  });
  for (const ref of invalid)
    assert.equal(db.linkTableCards(spaceId, { type: "note", id: note.id }, ref).success, false);
  assert.deepEqual(
    keys(db.getTableBoard(spaceId).cards),
    [`chat:${chatId}`, `note:${note.id + 1}`].sort()
  );
});

test("bounded batches refuse bad containers, deduplicate acknowledgements and normalize geometry", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note } = seed(db);
  const ref = { type: "note", id: note.id };
  for (const batch of [null, {}, "bad", Array(501).fill(ref)]) {
    assert.deepEqual(db.placeTableCards(spaceId, batch), { success: false, code: "INVALID" });
    assert.deepEqual(db.hideTableCards(spaceId, batch), { success: false, hidden: 0 });
  }
  assert.deepEqual(tableRows(db), [[], [], []]);
  assert.deepEqual(
    db.placeTableCards(spaceId, [
      { ...ref, x: 1, y: 2 },
      { ...ref, x: 2e6, y: -2e6, w: 5000, h: -1, z: Infinity },
    ]),
    {
      success: true,
      placed: 1,
      placedKeys: [`note:${note.id}`],
    }
  );
  assert.deepEqual(db.getTableBoard(spaceId).cards.find((card) => card.ref.id === note.id).layout, {
    x: 1e6,
    y: -1e6,
    w: 4000,
    h: null,
    z: 0,
    hidden: false,
  });
  assert.deepEqual(db.hideTableCards(spaceId, [ref, ref]), { success: true, hidden: 1 });
  assert.equal(
    db.getTableBoard(spaceId).inbox.find((card) => card.ref.type === "note").layout.x,
    1e6
  );
});

for (const operation of ["get", "place", "hide", "link", "viewport"]) {
  test(`${operation} validates, prunes deleted/archived/foreign rows and operates inside one transaction`, (t) => {
    const db = createDb(t);
    if (!db) return;
    const { spaceId, note, meeting, dictation, chatId } = seed(db);
    const a = { type: "note", id: note.id };
    const b = { type: "note", id: meeting.id };
    db.placeTableCards(spaceId, [
      { type: "dictation", id: dictation, x: 0, y: 0 },
      { type: "chat", id: chatId, x: 0, y: 0 },
    ]);
    db.linkTableCards(spaceId, a, { type: "dictation", id: dictation });
    db.linkTableCards(spaceId, a, { type: "chat", id: chatId });
    const moved = db.saveNote("moved out", "preserve foreign content").note;
    db.placeTableCards(spaceId, [{ type: "note", id: moved.id, x: 20, y: 30 }]);
    db.linkTableCards(spaceId, a, { type: "note", id: moved.id });
    db.db.prepare("UPDATE notes SET space_id = ? WHERE id = ?").run(legacySpace(db), moved.id);
    db.deleteTranscription(dictation);
    db.archiveAgentConversation(chatId);
    for (const method of ["_isTableSpace", "_pruneTableLayout", "_tableEntityExists"]) {
      const original = db[method];
      db[method] = function (...args) {
        assert.equal(this.db.inTransaction, true, `${method} stays in the operation transaction`);
        return original.apply(this, args);
      };
    }
    const run = {
      get: () => db.getTableBoard(spaceId),
      place: () => db.placeTableCards(spaceId, [{ ...a, x: 0, y: 0 }]),
      hide: () => db.hideTableCards(spaceId, [a]),
      link: () => db.linkTableCards(spaceId, a, b),
      viewport: () => db.setTableViewport(spaceId, { x: 0, y: 0, scale: 1 }),
    };
    run[operation]();
    assert.equal(
      db.db.prepare("SELECT count(*) AS n FROM note_layout WHERE entity_type != 'note'").get().n,
      0
    );
    assert.equal(
      db.db
        .prepare(
          "SELECT count(*) AS n FROM note_layout_links WHERE a_type != 'note' OR b_type != 'note'"
        )
        .get().n,
      0
    );
    assert.equal(
      db.db
        .prepare(
          "SELECT count(*) AS n FROM note_layout WHERE entity_type = 'note' AND entity_id = ?"
        )
        .get(moved.id).n,
      0
    );
    assert.equal(
      db.db
        .prepare("SELECT count(*) AS n FROM note_layout_links WHERE a_id = ? OR b_id = ?")
        .get(moved.id, moved.id).n,
      0
    );
    assert.equal(
      db.db.prepare("SELECT content FROM notes WHERE id = ?").get(moved.id).content,
      "preserve foreign content"
    );
  });
}

test("an SQLite failure rolls back both pruning and every placement in the batch", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, meeting, dictation } = seed(db);
  db.placeTableCards(spaceId, [{ type: "dictation", id: dictation, x: 0, y: 0 }]);
  db.deleteTranscription(dictation);
  const before = tableRows(db);
  db.db.exec(`CREATE TRIGGER reject_placement BEFORE INSERT ON note_layout
    WHEN NEW.entity_type = 'note' AND NEW.entity_id = ${meeting.id}
    BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;`);
  assert.throws(
    () =>
      db.placeTableCards(spaceId, [
        { type: "note", id: note.id, x: 50, y: 60 },
        { type: "note", id: meeting.id, x: 1, y: 2 },
      ]),
    /fixture write failure/
  );
  assert.deepEqual(tableRows(db), before);
});

test("capacity refusal rolls back existing geometry and new content remains intact", (t) => {
  const db = createDb(t);
  if (!db) return;
  const spaceId = db.getPrivateSpaceId();
  const ids = db.db.transaction(() =>
    Array.from({ length: 500 }, (_, i) => db.saveTranscription(`d${i}`).id)
  )();
  db.placeTableCards(
    spaceId,
    ids.map((id) => ({ type: "dictation", id, x: 8, y: 9 }))
  );
  const note = db.saveNote("Keep this answer", "full answer").note;
  assert.deepEqual(
    db.placeTableCards(spaceId, [
      { type: "dictation", id: ids[0], x: 900, y: 800 },
      { type: "note", id: note.id, x: 0, y: 0 },
    ]),
    { success: false, code: "TABLE_FULL" }
  );
  assert.equal(db.getNote(note.id).content, "full answer");
  const board = db.getTableBoard(spaceId);
  assert.equal(board.cards.length, 500);
  assert.equal(board.cards.find((card) => card.ref.id === ids[0]).layout.x, 8);
  assert.equal(board.truncated, true);
});

test("placing Inbox content reconciles 500 automatic notes to the same bounded projection after reopen", (t) => {
  let db = createDb(t);
  if (!db) return;
  const spaceId = db.getPrivateSpaceId();
  db.db.transaction(() => {
    for (let i = 0; i < 500; i++) db.saveNote(`n${i}`, "");
  })();
  const id = db.saveTranscription("new capture").id;
  db.placeTableCards(spaceId, [{ type: "dictation", id, x: 10, y: 20 }]);
  const board = db.getTableBoard(spaceId);
  assert.equal(board.cards.length, 500);
  assert.deepEqual(board.cards[0].ref, { type: "dictation", id });
  assert.equal(board.truncated, true);
  db = reopen(t, db);
  assert.deepEqual(db.getTableBoard(spaceId), board);
});

for (const type of ["note", "dictation", "chat"]) {
  test(`removed old ${type} is first in the bounded tray after 51 hidden items and reopen; all content survives`, (t) => {
    let db = createDb(t);
    if (!db) return;
    const spaceId = db.getPrivateSpaceId();
    const create = (i) =>
      type === "note"
        ? db.saveNote(`n${i}`, `body${i}`).note.id
        : type === "dictation"
          ? db.saveTranscription(`body${i}`).id
          : db.createAgentConversation(`c${i}`, null, spaceId).id;
    const ids = db.db.transaction(() => Array.from({ length: 52 }, (_, i) => create(i)))();
    // Freeze SQLite's clock for layout timestamp calculation so these removals
    // definitely share one clock tick. Delegate conversions to real SQLite on
    // another in-memory connection; removal rows are never backdated.
    const clockDb = new (require("better-sqlite3"))(":memory:");
    t.after(() => clockDb.close());
    const frozenNow = clockDb.prepare("SELECT datetime('now') AS at").get().at;
    const julian = clockDb.prepare("SELECT julianday(?) AS at");
    db.db.function("julianday", (value) => julian.get(value === "now" ? frozenNow : value).at);
    const old = ids[0];
    const entityTable = { note: "notes", dictation: "transcriptions", chat: "agent_conversations" }[
      type
    ];
    const dateColumn = type === "dictation" ? "timestamp" : "updated_at";
    db.db
      .prepare(`UPDATE ${entityTable} SET ${dateColumn} = datetime('now', '-30 days') WHERE id = ?`)
      .run(old);
    const contentBefore = db.db.prepare(`SELECT * FROM ${entityTable} ORDER BY id`).all();
    db.placeTableCards(spaceId, [{ type, id: old, x: 123, y: 456 }]);
    db.hideTableCards(
      spaceId,
      ids.slice(1).map((id) => ({ type, id }))
    );
    assert.equal(
      db.getTableBoard(spaceId).inbox.filter((card) => card.ref.type === type).length,
      50
    );
    db.hideTableCards(spaceId, [{ type, id: old }]);
    let inbox = db.getTableBoard(spaceId).inbox.filter((card) => card.ref.type === type);
    assert.equal(inbox.length, 50);
    assert.equal(inbox[0].ref.id, old);
    assert.equal(inbox[0].layout.x, 123);
    assert.deepEqual(
      inbox.slice(1).map((card) => card.ref.id),
      ids.slice(3).reverse()
    );
    db = reopen(t, db);
    assert.deepEqual(
      db.getTableBoard(spaceId).inbox.filter((card) => card.ref.type === type),
      inbox
    );
    assert.deepEqual(
      db.db.prepare(`SELECT * FROM ${entityTable} ORDER BY id`).all(),
      contentBefore
    );
    assert.equal(
      db.db.prepare("SELECT count(*) AS n FROM note_layout WHERE hidden = 1").get().n,
      52
    );
  });
}

test("viewport refuses nonfinite payloads, clamps valid values and survives reopen", (t) => {
  let db = createDb(t);
  if (!db) return;
  const spaceId = db.getPrivateSpaceId();
  for (const viewport of [
    null,
    {},
    { x: "0", y: 0, scale: 1 },
    { x: 0, y: NaN, scale: 1 },
    { x: 0, y: 0, scale: Infinity },
  ]) {
    assert.deepEqual(db.setTableViewport(spaceId, viewport), { success: false });
  }
  assert.equal(db.getTableBoard(spaceId).viewport, null);
  assert.deepEqual(db.setTableViewport(spaceId, { x: 2e6, y: -2e6, scale: -1 }), { success: true });
  db = reopen(t, db);
  assert.deepEqual(db.getTableBoard(spaceId).viewport, { x: 1e6, y: -1e6, scale: 0.25 });
});

test("board bounds excerpts, participants, hrefs and recent capture buckets without modifying full content", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, meeting } = seed(db);
  const body =
    "long body ".repeat(100) +
    Array.from({ length: 55 }, (_, i) => `[n${i}](note:${i + 1})`).join(" ");
  db.db
    .prepare(
      "UPDATE notes SET enhanced_content = ?, participants = ?, audio_duration_seconds = 1.234 WHERE id = ?"
    )
    .run(
      body,
      JSON.stringify([
        null,
        { name: 12 },
        ...Array.from({ length: 8 }, (_, i) => ({ displayName: `p${i}` })),
      ]),
      note.id
    );
  db.db.prepare("UPDATE notes SET participants = 'invalid json' WHERE id = ?").run(meeting.id);
  const ids = db.db.transaction(() =>
    Array.from({ length: 25 }, (_, i) => db.saveTranscription(`recent${i}`).id)
  )();
  db.db
    .prepare("UPDATE transcriptions SET timestamp = datetime('now', '-8 days') WHERE id = ?")
    .run(ids[0]);
  const pending = db.createAgentConversation("no answer", null, spaceId);
  db.addAgentMessage(pending.id, "user", "unanswered");
  db.db.transaction(() => {
    for (let i = 0; i < 12; i++) {
      const chat = db.createAgentConversation(`answered${i}`, null, spaceId);
      db.addAgentMessage(chat.id, "assistant", "old reply");
      db.addAgentMessage(chat.id, "assistant", "answer ".repeat(100));
    }
  })();
  const board = db.getTableBoard(spaceId);
  const card = board.cards.find((card) => card.ref.id === note.id);
  assert.equal(card.excerpt, body.slice(0, 600));
  assert.equal(card.durationMs, 1234);
  assert.deepEqual(
    card.participants,
    Array.from({ length: 6 }, (_, i) => `p${i}`)
  );
  assert.equal(card.hrefs.length, 50);
  assert.equal(card.hrefs[49], "note:50");
  assert.deepEqual(board.cards.find((card) => card.ref.id === meeting.id).participants, []);
  assert.equal(board.inbox.filter((card) => card.ref.type === "dictation").length, 20);
  assert.ok(!board.inbox.some((card) => card.ref.type === "dictation" && card.ref.id === ids[0]));
  const chats = board.inbox.filter((card) => card.ref.type === "chat");
  assert.equal(chats.length, 10);
  assert.ok(chats.every((card) => card.excerpt === "answer ".repeat(100).slice(0, 600)));
  assert.ok(!chats.some((card) => card.ref.id === pending.id));
  assert.equal(db.getNote(note.id).enhanced_content, body);
});

test("links only project present endpoints and persist canonically without duplicates after reopen", (t) => {
  let db = createDb(t);
  if (!db) return;
  const { spaceId, note, meeting, dictation } = seed(db);
  const a = { type: "note", id: note.id };
  const b = { type: "note", id: meeting.id };
  const old = { type: "dictation", id: dictation };
  db.db
    .prepare("UPDATE transcriptions SET timestamp = datetime('now', '-30 days') WHERE id = ?")
    .run(dictation);
  db.linkTableCards(spaceId, a, b);
  db.linkTableCards(spaceId, b, a);
  db.linkTableCards(spaceId, a, old);
  assert.equal(db.getTableBoard(spaceId).links.length, 1);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM note_layout_links").get().n, 2);
  db.hideTableCards(spaceId, [old]);
  const board = db.getTableBoard(spaceId);
  assert.equal(board.links.length, 2);
  db = reopen(t, db);
  assert.deepEqual(db.getTableBoard(spaceId).links, board.links);
  db.deleteNote(meeting.id);
  db = reopen(t, db);
  assert.equal(db.getTableBoard(spaceId).links.length, 1);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM note_layout_links").get().n, 1);
  assert.ok(db.getNote(note.id));
});

test("reopen prunes deleted notes, deleted chats and archived chats without deleting the surviving content", (t) => {
  let db = createDb(t);
  if (!db) return;
  const { spaceId, note, meeting, dictation, chatId } = seed(db);
  const deletedChat = db.createAgentConversation("deleted chat", null, spaceId).id;
  db.placeTableCards(spaceId, [
    { type: "note", id: note.id, x: 0, y: 0 },
    { type: "note", id: meeting.id, x: 1, y: 1 },
    { type: "chat", id: chatId, x: 2, y: 2 },
    { type: "chat", id: deletedChat, x: 3, y: 3 },
  ]);
  for (const ref of [
    { type: "note", id: meeting.id },
    { type: "chat", id: chatId },
    { type: "chat", id: deletedChat },
  ]) {
    db.linkTableCards(spaceId, { type: "note", id: note.id }, ref);
  }
  db.deleteNote(meeting.id);
  db.deleteAgentConversation(deletedChat);
  db.archiveAgentConversation(chatId);
  db = reopen(t, db);
  const board = db.getTableBoard(spaceId);
  assert.deepEqual(keys(board.cards), [`note:${note.id}`]);
  assert.deepEqual(board.links, []);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM note_layout").get().n, 1);
  assert.equal(
    db.db.prepare("SELECT archived_at FROM agent_conversations WHERE id = ?").get(chatId)
      .archived_at != null,
    true
  );
  assert.ok(db.getNote(note.id));
  assert.ok(db.db.prepare("SELECT 1 FROM transcriptions WHERE id = ?").get(dictation));
});

for (const [operation, invoke] of [
  ["place", (db, spaceId) => db.placeTableCards(spaceId, null)],
  ["hide", (db, spaceId) => db.hideTableCards(spaceId, null)],
  ["link", (db, spaceId) => db.linkTableCards(spaceId, null, null)],
  ["viewport", (db, spaceId) => db.setTableViewport(spaceId, null)],
]) {
  test(`a refused ${operation} payload still prunes stale rows on a valid board`, (t) => {
    const db = createDb(t);
    if (!db) return;
    const { spaceId, dictation } = seed(db);
    db.placeTableCards(spaceId, [{ type: "dictation", id: dictation, x: 0, y: 0 }]);
    db.deleteTranscription(dictation);
    assert.equal(invoke(db, spaceId).success, false);
    assert.equal(db.db.prepare("SELECT count(*) AS n FROM note_layout").get().n, 0);
  });
}

test("integration: an existing accepted 04+05+06 database gains Table without losing content", (t) => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const Sqlite = require("better-sqlite3");
  const { setUserDataDir } = require("./harness/electronStub");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-table-seed-upgrade-"));
  let db;
  t.after(() => {
    db?.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  setUserDataDir(dir);
  const filename =
    process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db";
  const prior = new Sqlite(path.join(dir, filename));
  prior.exec(
    fs.readFileSync(path.join(__dirname, "../fixtures/tableIntegrationSeedSchema.sql"), "utf8")
  );
  prior
    .prepare(
      "INSERT INTO spaces (id,client_space_id,kind,name,sort_order) VALUES (1,'seed-private','private','Personal',0)"
    )
    .run();
  prior
    .prepare(
      "INSERT INTO notes (id,title,content,note_type,space_id) VALUES (1,'Seed note','Unchanged original words','personal',1)"
    )
    .run();
  assert.deepEqual(
    prior.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'note_layout%'").all(),
    []
  );
  prior.close();
  db = new DatabaseManager();
  assert.equal(db.getNote(1).content, "Unchanged original words");
  assert.equal(db.getTableBoard(1).cards.length, 1);
  assert.equal(db.placeTableCards(1, [{ type: "note", id: 1, x: 40, y: 80 }]).success, true);
  db.hideTableCards(1, [{ type: "note", id: 1 }]);
  assert.equal(
    db.getNote(1).content,
    "Unchanged original words",
    "D12 Remove preserves seed content"
  );
  db.db.close();
  db = new DatabaseManager();
  assert.equal(db.getNote(1).content, "Unchanged original words");
  assert.equal(
    db.getTableBoard(1).inbox.some((e) => e.ref.type === "note" && e.ref.id === 1),
    true
  );
});
