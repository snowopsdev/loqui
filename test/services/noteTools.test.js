const test = require("node:test");
const assert = require("node:assert/strict");

const transcript = JSON.stringify([
  { text: "We will ship the beta on Friday.", speaker: "speaker_0" },
  { text: "QA signs off Thursday.", speakerName: "Ana" },
]);
const meeting = {
  id: 42,
  title: "Release sync",
  content: "",
  enhanced_content: null,
  transcript,
  note_type: "meeting",
  folder_id: null,
  space_id: 1,
  created_at: "2026-11-20",
  updated_at: "2026-11-20",
};

function stub(electronAPI) {
  global.window = { electronAPI };
}

test("[change-driving] get_note returns a transcript-only meeting's transcript, not empty content", async () => {
  const { getNoteTool } = await import("../../src/services/tools/getNoteTool.ts");
  stub({ getNote: async () => meeting });
  const result = await getNoteTool.execute({ id: 42 });
  assert.equal(result.success, true);
  assert.equal(
    result.data.content,
    "We will ship the beta on Friday.\nAna: QA signs off Thursday."
  );
});

test("get_note still prefers the AI summary, then non-blank typed notes", async () => {
  const { getNoteTool } = await import("../../src/services/tools/getNoteTool.ts");
  stub({ getNote: async () => ({ ...meeting, enhanced_content: "Summary", content: "Typed" }) });
  assert.equal((await getNoteTool.execute({ id: 42 })).data.content, "Summary");
  stub({ getNote: async () => ({ ...meeting, enhanced_content: "  ", content: "Typed" }) });
  assert.equal((await getNoteTool.execute({ id: 42 })).data.content, "Typed");
});

test("[change-driving] search_notes returns transcript text for meetings and keeps its 500-character limit", async () => {
  const { createSearchNotesTool } = await import("../../src/services/tools/searchNotesTool.ts");
  const long = { ...meeting, id: 43, transcript: JSON.stringify([{ text: "y".repeat(900) }]) };
  stub({
    getSpaces: async () => [],
    semanticSearchNotes: async () => [meeting, long],
    searchNotes: async () => [],
  });
  const result = await createSearchNotesTool({}).execute({ query: "beta" });
  assert.equal(result.success, true);
  assert.equal(
    result.data[0].content,
    "We will ship the beta on Friday.\nAna: QA signs off Thursday."
  );
  assert.equal(result.data[1].content, "y".repeat(500));
});
