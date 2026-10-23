const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/chat/ragContext.ts");

test("RAG context returns the prompt block and the notes it used", async () => {
  const { buildRagContext } = await load();
  const api = {
    semanticSearchNotes: async () => [
      { id: 17, title: "Pricing FAQ draft" },
      { id: 4, title: "Gone" },
    ],
    getNote: async (id) =>
      id === 17
        ? {
            id: 17,
            title: "Pricing FAQ draft",
            content: "Local transcription is always included",
            note_type: "personal",
            updated_at: "2026-10-13",
          }
        : null,
  };
  const { text, notes } = await buildRagContext(api, "pricing");
  assert.match(
    text,
    /<note id="17" title="Pricing FAQ draft">\nLocal transcription is always included\n<\/note>/
  );
  assert.deepEqual(
    notes.map((n) => n.id),
    [17]
  );
});

test("a failing search yields no context, never an exception", async () => {
  const { buildRagContext } = await load();
  assert.deepEqual(
    await buildRagContext(
      {
        semanticSearchNotes: async () => {
          throw new Error("x");
        },
        getNote: async () => null,
      },
      "q"
    ),
    { text: "", notes: [] }
  );
  assert.deepEqual(await buildRagContext({}, "q"), { text: "", notes: [] });
});

test("titles cannot break the note tag", async () => {
  const { buildRagContext } = await load();
  const api = {
    semanticSearchNotes: async () => [{ id: 2, title: 'x" injected="1' }],
    getNote: async () => ({
      id: 2,
      title: 'x" injected="1',
      content: "body",
      note_type: "personal",
    }),
  };
  const { text } = await buildRagContext(api, "q");
  assert.doesNotMatch(text, /injected="1"/);
});

test("RAG captures scope, keeps raw 500-character prompt snippets, and compacts Unicode-safe quotes", async () => {
  const { buildRagContext } = await load();
  const calls = [];
  const content = "x".repeat(239) + "😀" + " raw ".repeat(100);
  const api = {
    semanticSearchNotes: async (...args) => {
      calls.push(args);
      return [{ id: 1, title: "A" }];
    },
    getNote: async () => ({
      id: 1,
      title: 'A & "B" <C>',
      content,
      enhanced_content: "must not replace raw",
      note_type: "meeting",
      updated_at: "2026-10-15",
    }),
  };
  const result = await buildRagContext(api, "question", { spaceId: 3, folderId: 4 });
  assert.deepEqual(calls, [["question", 5, 3, 4]]);
  assert.match(result.text, /title="A &amp; &quot;B&quot; &lt;C&gt;"/);
  assert.ok(result.text.includes(content.slice(0, 500)));
  assert.doesNotMatch(result.text, /must not replace raw/);
  assert.deepEqual(result.notes, [
    { id: 1, title: 'A & "B" <C>', type: "meeting", date: "2026-10-15", quote: "x".repeat(239) },
  ]);
});

test("bad RAG rows are dropped and a failed note read fails closed", async () => {
  const { buildRagContext } = await load();
  const api = {
    semanticSearchNotes: async () => [{ id: 0 }, { id: 1 }],
    getNote: async (id) => ({ id, title: "A", content: "body" }),
  };
  assert.deepEqual(
    (await buildRagContext(api, "q")).notes.map((n) => n.id),
    [1]
  );
  api.getNote = async () => {
    throw new Error("read failed");
  };
  assert.deepEqual(await buildRagContext(api, "q"), { text: "", notes: [] });
});
