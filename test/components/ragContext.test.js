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

test("RAG captures scope, keeps 500-character prompt snippets, and compacts Unicode-safe quotes", async () => {
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
      enhanced_content: null,
      note_type: "meeting",
      updated_at: "2026-10-15",
    }),
  };
  const result = await buildRagContext(api, "question", { spaceId: 3, folderId: 4 });
  assert.deepEqual(calls, [["question", 5, 3, 4]]);
  assert.match(result.text, /title="A &amp; &quot;B&quot; &lt;C&gt;"/);
  assert.ok(result.text.includes(content.slice(0, 500)));
  assert.ok(!result.text.includes(content.slice(0, 501)));
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

const segments = (rows) => JSON.stringify(rows);
const ragFor = async (note) => {
  const { buildRagContext } = await load();
  return buildRagContext(
    {
      semanticSearchNotes: async () => [{ id: note.id, title: note.title }],
      getNote: async () => note,
    },
    "q"
  );
};

test("[change-driving] a recorded meeting with no typed notes injects its transcript", async () => {
  const { text, notes } = await ragFor({
    id: 9,
    title: "Vendor sync",
    content: "",
    enhanced_content: null,
    note_type: "meeting",
    transcript: segments([
      { text: "We agreed to renew the contract in March.", speaker: "speaker_0" },
      { text: "  ", speaker: "speaker_1" },
      { text: "Budget is capped at 40k.", speakerName: "Dana" },
      { text: "Placeholder name ignored.", speakerName: "Speaker 3", speakerIsPlaceholder: true },
    ]),
  });
  assert.match(
    text,
    /<note id="9" title="Vendor sync">\nWe agreed to renew the contract in March\.\nDana: Budget is capped at 40k\.\nPlaceholder name ignored\.\n<\/note>/
  );
  assert.equal(
    notes[0].quote,
    "We agreed to renew the contract in March. Dana: Budget is capped at 40k. Placeholder name ignored."
  );
});

test("[change-driving] the AI summary is preferred over typed notes and the transcript, matching get_note", async () => {
  const { text, notes } = await ragFor({
    id: 3,
    title: "Upload",
    content: "typed",
    enhanced_content: "Summary of the uploaded call",
    note_type: "upload",
    transcript: segments([{ text: "spoken words" }]),
  });
  assert.match(text, /Summary of the uploaded call/);
  assert.doesNotMatch(text, /typed|spoken words/);
  assert.equal(notes[0].quote, "Summary of the uploaded call");
  const typed = await ragFor({
    id: 4,
    title: "T",
    content: "typed",
    transcript: segments([{ text: "spoken" }]),
  });
  assert.match(typed.text, /\ntyped\n/);
  assert.doesNotMatch(typed.text, /spoken/);
});

test("malformed or empty transcripts never throw and fall back safely", async () => {
  const { formatTranscript } = await import("../../src/lib/noteSourceText.ts");
  assert.equal(formatTranscript(null), "");
  assert.equal(formatTranscript(""), "");
  assert.equal(formatTranscript("{}"), "");
  assert.equal(formatTranscript("[]"), "");
  assert.equal(formatTranscript("plain text transcript "), "plain text transcript");
  assert.equal(formatTranscript(segments([null, { text: 5 }, { text: "ok" }])), "ok");
  const { text, notes } = await ragFor({ id: 5, title: "Empty", content: "", transcript: null });
  assert.equal(text, '<note id="5" title="Empty">\n\n</note>');
  assert.equal(notes[0].quote, "");
});

test("[change-driving] whitespace-only summaries or notes fall through to real text", async () => {
  const typed = await ragFor({
    id: 6,
    title: "Blank summary",
    content: "Typed agenda",
    enhanced_content: "  \n ",
    transcript: segments([{ text: "spoken" }]),
  });
  assert.match(typed.text, /\nTyped agenda\n/);
  assert.equal(typed.notes[0].quote, "Typed agenda");
  const spoken = await ragFor({
    id: 7,
    title: "Blank everything",
    content: " \n\t",
    enhanced_content: " ",
    transcript: segments([{ text: "Only the recording has words." }]),
  });
  assert.match(spoken.text, /\nOnly the recording has words\.\n/);
});
