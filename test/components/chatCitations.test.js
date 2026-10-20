const assert = require("node:assert/strict");
const test = require("node:test");
const {
  toToolMetadata,
  collectSources,
  numberCitations,
} = require("../../src/components/chat/citations.ts");

const searchResult = [
  {
    id: 38,
    title: "Pricing review",
    date: "2026-10-09",
    type: "meeting",
    space: "Work",
    content: "so Thursday, not Monday, because legal needs one more day",
  },
  {
    id: 5,
    title: "Product catch-up",
    date: "2026-10-14",
    type: "personal",
    space: "Work",
    content: "Maya owns FAQ copy",
  },
  { id: null, title: "bad" },
];

test("search_notes results become compact source hits; bad ids are dropped", () => {
  const meta = toToolMetadata("search_notes", searchResult);
  assert.deepEqual(
    meta.map((h) => h.id),
    [38, 5]
  );
  assert.equal(meta[0].quote, "so Thursday, not Monday, because legal needs one more day");
  assert.equal(meta[0].type, "meeting");
});

test("note tools become one hit; errors and other tools carry nothing", () => {
  assert.equal(
    toToolMetadata("get_note", {
      id: 9,
      title: "Roadmap",
      content: "x".repeat(900),
      type: "personal",
      created_at: "2026-10-01",
    }).quote.length <= 240,
    true
  );
  assert.equal(toToolMetadata("get_note", { error: "Note with ID 9 not found" }), undefined);
  assert.equal(toToolMetadata("copy_to_clipboard", { ok: true }), undefined);
});

test("citations are numbered in order of first appearance; unknown ids are ignored", () => {
  const candidates = collectSources(
    [
      {
        id: "t1",
        name: "search_notes",
        arguments: "{}",
        status: "completed",
        result: "Found 2",
        metadata: toToolMetadata("search_notes", searchResult),
      },
    ],
    [
      {
        id: 17,
        title: "Pricing FAQ draft",
        type: "personal",
        date: null,
        quote: "Local transcription is always included",
      },
    ]
  );
  const { numbers, sources } = numberCitations(
    "Thursday, not Monday [note:38]. Maya owns the FAQ [note:5]. Local stays included [note:17]. Again [note:38]. Invented [note:999].",
    candidates
  );
  assert.deepEqual(
    [...numbers],
    [
      [38, 1],
      [5, 2],
      [17, 3],
    ]
  );
  assert.deepEqual(
    sources.map((s) => [s.n, s.noteId, s.kind]),
    [
      [1, 38, "meeting"],
      [2, 5, "note"],
      [3, 17, "note"],
    ]
  );
});

test("an answer with no markers still lists what was read, unnumbered", () => {
  const candidates = collectSources(
    [
      {
        id: "t1",
        name: "search_notes",
        arguments: "{}",
        status: "completed",
        metadata: toToolMetadata("search_notes", searchResult),
      },
    ],
    []
  );
  const { numbers, sources } = numberCitations("A plain answer.", candidates);
  assert.equal(numbers.size, 0);
  assert.deepEqual(
    sources.map((s) => [s.n, s.noteId]),
    [
      [null, 38],
      [null, 5],
    ]
  );
});

test("tool calls still running contribute nothing yet", () => {
  const candidates = collectSources(
    [
      {
        id: "t1",
        name: "search_notes",
        arguments: "{}",
        status: "executing",
        metadata: toToolMetadata("search_notes", searchResult),
      },
    ],
    []
  );
  assert.equal(candidates.size, 0);
});

const completed = (metadata) => [
  { id: "tool", name: "search_notes", arguments: "{}", status: "completed", metadata },
];

test("tool metadata is compact, truthful, and validates ids and scalar fields", () => {
  for (const id of [
    null,
    undefined,
    true,
    false,
    0,
    -1,
    1.5,
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
    "",
    "bad",
    {},
    [],
  ]) {
    assert.equal(toToolMetadata("get_note", { id, title: "bad" }), undefined, String(id));
  }
  assert.deepEqual(toToolMetadata("create_note", { id: 9, title: "Created", folder_id: 2 }), {
    id: 9,
    title: "Created",
    date: null,
    type: null,
    quote: "",
  });
  assert.deepEqual(toToolMetadata("update_note", { id: 9, title: "Updated" }), {
    id: 9,
    title: "Updated",
    date: null,
    type: null,
    quote: "",
  });
  const hit = toToolMetadata("get_note", {
    id: 9,
    title: 123,
    date: {},
    updated_at: "2026-10-01",
    type: [],
    content: " a\n b ",
  });
  assert.deepEqual(hit, { id: 9, title: "", date: "2026-10-01", type: null, quote: "a b" });
  const boundary = toToolMetadata("get_note", { id: 1, content: "x".repeat(239) + "😀tail" });
  assert.equal(boundary.quote, "x".repeat(239));
  assert.equal(boundary.quote.isWellFormed(), true);
});

test("malformed stored tool metadata cannot contribute invalid sources; first valid hit wins", () => {
  const valid = toToolMetadata("get_note", { id: 5, title: "First", content: "first" });
  const candidates = collectSources(
    completed([null, {}, { id: -1 }, { id: 0 }, { id: 2, title: {} }, valid]),
    [
      { id: 5, title: "Duplicate", type: "meeting", date: null, quote: "second" },
      { id: 6, title: "RAG", type: "meeting", date: null, quote: "rag" },
    ]
  );
  assert.deepEqual([...candidates.keys()], [5, 6]);
  assert.equal(candidates.get(5).title, "First");
});

test("Markdown/GFM excluded-first code and links do not consume citation numbers", () => {
  const candidates = collectSources(
    completed(
      Array.from({ length: 9 }, (_, i) => ({
        id: i + 1,
        title: `N${i + 1}`,
        type: null,
        date: null,
        quote: "",
      }))
    ),
    []
  );
  const content = [
    "`[note:1]`",
    "```md",
    "[note:2]",
    "```",
    "    [note:3]",
    "",
    "[[note:4]](https://example.invalid) [[note:5]][ref]",
    "",
    '[ref]: https://example.invalid "[note:6]"',
    "",
    "| Real | Sources |",
    "| --- | --- |",
    "| ~~[note:8]~~ | [note:7] |",
    "",
    "Again [note:8]. Unknown [note:999]. Escaped \\[note:9].",
  ].join("\n");
  const { numbers, sources } = numberCitations(content, candidates);
  // Markdown unescapes the opening bracket in a text node; the shared traversal
  // sees that same value that Task20's text-node transform will consume.
  assert.deepEqual(
    [...numbers],
    [
      [8, 1],
      [7, 2],
      [9, 3],
    ]
  );
  assert.deepEqual(
    sources.map((s) => s.noteId),
    [8, 7, 9]
  );
});

test("only excluded/unknown markers use the capped uncited fallback", () => {
  const candidates = collectSources(
    completed(
      Array.from({ length: 7 }, (_, i) => ({
        id: i + 1,
        title: `N${i}`,
        type: null,
        date: null,
        quote: "",
      }))
    ),
    []
  );
  const { numbers, sources } = numberCitations(
    "`[note:1]` [[note:2]](https://example.invalid) [note:999]",
    candidates
  );
  assert.equal(numbers.size, 0);
  assert.deepEqual(
    sources.map((s) => [s.n, s.noteId]),
    [
      [null, 1],
      [null, 2],
      [null, 3],
      [null, 4],
      [null, 5],
    ]
  );
});
