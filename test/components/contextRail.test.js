const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/chat/contextRail.ts");

test("@ at a word start opens the picker; an email address does not", async () => {
  const { detectMentionQuery } = await load();
  assert.deepEqual(detectMentionQuery("what about @pri", 15), { start: 11, query: "pri" });
  assert.deepEqual(detectMentionQuery("@", 1), { start: 0, query: "" });
  assert.equal(detectMentionQuery("mail maya@acme", 14), null);
  assert.equal(detectMentionQuery("what about @pri and more", 24), null);
  assert.equal(detectMentionQuery(`@${"x".repeat(27)}`, 28), null);
});

test("picking removes only the typed @query", async () => {
  const { removeMentionQuery } = await load();
  assert.equal(
    removeMentionQuery("compare @pri with last week", { start: 8, query: "pri" }),
    "compare with last week"
  );
  assert.equal(removeMentionQuery("@pri", { start: 0, query: "pri" }), "");
});

test("people are not context; notes, meetings, folders and dictations are", async () => {
  const { pinnedFromMention } = await load();
  assert.equal(
    pinnedFromMention({
      kind: "person",
      label: "Maya",
      entityId: null,
      email: "m@a",
      key: "p",
      meta: null,
    }),
    null
  );
  assert.deepEqual(
    pinnedFromMention({
      kind: "meeting",
      label: "Pricing review",
      entityId: "38",
      email: null,
      key: "m",
      meta: null,
    }),
    {
      kind: "meeting",
      id: 38,
      label: "Pricing review",
    }
  );
});

test("the rail lists what was found, apart from what you pinned, and every tool step in order", async () => {
  const { buildRailModel } = await load();
  const messages = [
    { id: "u", role: "user", content: "q", isStreaming: false },
    {
      id: "a",
      role: "assistant",
      content: "x",
      isStreaming: false,
      context: {
        ragNotes: [{ id: 17, title: "Pricing FAQ draft", type: "personal", date: null, quote: "" }],
      },
      toolCalls: [
        {
          id: "t1",
          name: "search_notes",
          arguments: "{}",
          status: "completed",
          result: "Found 2",
          metadata: [
            { id: 38, title: "Pricing review", type: "meeting", date: null, quote: "" },
            { id: 5, title: "Catch-up", type: "personal", date: null, quote: "" },
          ],
        },
        { id: "t2", name: "get_note", arguments: "{}", status: "executing" },
      ],
    },
  ];
  const model = buildRailModel(
    messages,
    [{ kind: "note", id: 5, label: "Catch-up" }],
    (tc) => tc.result ?? `${tc.name}…`
  );
  assert.deepEqual(
    model.found.map((f) => [f.noteId, f.kind]),
    [
      [38, "meeting"],
      [17, "note"],
    ]
  );
  assert.deepEqual(
    model.activity.map((a) => [a.toolName, a.status, a.label]),
    [
      ["search_notes", "completed", "Found 2"],
      ["get_note", "executing", "get_note…"],
    ]
  );
});

test("pinned context reaches the prompt; deleted items are skipped and long notes trimmed", async () => {
  const { buildPinnedContext } = await load();
  const api = {
    getNote: async (id) =>
      id === 38 ? { id: 38, title: "Pricing review", content: "y".repeat(5000) } : null,
    getNotes: async () => [{ id: 9, title: "In folder", content: "folder body" }],
    getTranscriptionById: async () => ({ id: 311, text: "Draft a reply to Maya" }),
  };
  const { text, notes } = await buildPinnedContext(
    [
      { kind: "meeting", id: 38, label: "Pricing review" },
      { kind: "note", id: 404, label: "Gone" },
      { kind: "folder", id: 2, label: "Work" },
      { kind: "dictation", id: 311, label: "Draft…" },
    ],
    api
  );
  assert.match(text, /<note id="38" title="Pricing review">\ny{1500}\n<\/note>/);
  assert.doesNotMatch(text, /id="404"/);
  assert.match(text, /<note id="9" title="In folder">/);
  assert.match(text, /<dictation id="311">\nDraft a reply to Maya\n<\/dictation>/);
  assert.deepEqual(
    notes.map((n) => n.id),
    [38, 9],
    "every note that reached the prompt is citable"
  );
});

test("a pinned-only note is cited even with empty RAG and tool results, and survives save and load (I12)", async () => {
  const { buildPinnedContext } = await load();
  const { collectSources, numberCitations } = require("../../src/components/chat/citations.ts");
  const { notes } = await buildPinnedContext(
    [{ kind: "note", id: 17, label: "Pricing FAQ draft" }],
    {
      getNote: async () => ({
        id: 17,
        title: "Pricing FAQ draft",
        content: "Local transcription is always included",
      }),
      getNotes: async () => [],
      getTranscriptionById: async () => null,
    }
  );
  const saved = JSON.parse(
    JSON.stringify({ context: { ragNotes: [], pinnedNotes: notes } })
  ).context;
  const { numbers, sources } = numberCitations(
    "Local stays included [note:17].",
    collectSources([], [...saved.ragNotes, ...saved.pinnedNotes])
  );
  assert.deepEqual([...numbers], [[17, 1]]);
  assert.equal(sources[0].title, "Pricing FAQ draft");
});

test("splice preserves unrelated Markdown whitespace and rejects a stale match", async () => {
  const { removeMentionQuery, pinnedFromMention } = await load();
  const prefix = "  leading\n    code  stay\ntext  \ncompare ";
  const suffix = " with  repeated\n    tail  \n  ";
  assert.equal(
    removeMentionQuery(prefix + "@pri" + suffix, { start: prefix.length, query: "pri" }),
    prefix + suffix.slice(1)
  );
  assert.equal(removeMentionQuery("newer @other", { start: 0, query: "pri" }), "newer @other");
  for (const entityId of ["0", "-1", "1.5", "Infinity", "9007199254740992", "1e2", " 1"])
    assert.equal(pinnedFromMention({ kind: "note", entityId, label: "bad" }), null);
});
test("context bounds are Unicode safe, IDs validated, deletion and failures independent", async () => {
  const { buildPinnedContext } = await load();
  const called = [];
  const api = {
    getNote: async (id) => {
      called.push(id);
      if (id === 2) throw Error("gone");
      return {
        id,
        title: 'A & "B"',
        content: "x".repeat(1499) + "😀tail",
        deleted_at: id === 3 ? "deleted" : null,
      };
    },
    getNotes: async () =>
      Array.from({ length: 7 }, (_, i) => ({
        id: 10 + i,
        title: "folder",
        content: "y".repeat(499) + "😀",
        deleted_at: i === 1 ? "deleted" : null,
      })),
    getTranscriptionById: async (id) => ({ id, text: "dictated", deleted_at: "deleted" }),
  };
  const result = await buildPinnedContext(
    [
      { kind: "note", id: NaN, label: "bad" },
      ...[1, 2, 3].map((id) => ({ kind: "note", id, label: "n" })),
      { kind: "folder", id: 8, label: "f" },
      { kind: "dictation", id: 9, label: "d" },
    ],
    api
  );
  assert.deepEqual(called, [1, 2, 3]);
  assert.doesNotMatch(
    result.text,
    /id="3"|id="9"|id="11"|id="15"|id="16"|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u
  );
  assert.match(result.text, /A &amp; &quot;B&quot;/);
  assert.deepEqual(
    result.notes.map((n) => n.id),
    [1, 10, 12, 13, 14]
  );
  assert.ok(result.notes.every((n) => n.quote.length <= 240));
});
