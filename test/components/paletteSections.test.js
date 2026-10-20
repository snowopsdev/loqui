const assert = require("node:assert/strict");
const test = require("node:test");

const loadSections = () => import("../../src/components/commandSearch/paletteSections.ts");
const loadCommands = () => import("../../src/components/commandSearch/commands.ts");

const labelled = async () => {
  const { WORKSPACE_COMMANDS } = await loadCommands();
  const labels = { newNote: "New note", recordMeeting: "Record meeting", goNotes: "Go to Notes" };
  return WORKSPACE_COMMANDS.map((command) => ({
    command,
    label: labels[command.id] ?? command.id,
  }));
};
const note = (id, title, note_type = "personal", updated_at = "2026-10-14 10:00:00") => ({
  id,
  title,
  note_type,
  folder_id: 2,
  space_id: 1,
  updated_at,
  created_at: updated_at,
});
const tx = (id, text, timestamp = "2026-10-14 09:00:00") => ({
  id,
  text,
  timestamp,
  created_at: timestamp,
  status: "completed",
});

test("an empty query shows Suggested then Recent", async () => {
  const { buildPaletteSections } = await loadSections();
  const sections = buildPaletteSections({
    query: "",
    commands: await labelled(),
    notes: [note(1, "Pricing FAQ draft", "personal", "2026-10-14 08:00:00")],
    transcripts: [tx(9, "Let's set aside some time", "2026-10-14 19:51:00")],
    conversations: [
      { id: 3, title: "Pricing decision summary", updated_at: "2026-10-14 12:00:00" },
    ],
    containers: [],
  });
  assert.deepEqual(
    sections.map((s) => s.id),
    ["suggested", "recent"]
  );
  assert.deepEqual(
    sections[0].rows.map((r) => r.command.id),
    ["newNote", "startDictation", "askAssistant", "goNotes"]
  );
  assert.deepEqual(
    sections[1].rows.map((r) => r.key),
    ["transcript-9", "conversation-3", "note-1"]
  );
});

test("results are ordered Commands, Notes, Meetings, Transcripts, Chats", async () => {
  const { buildPaletteSections } = await loadSections();
  const sections = buildPaletteSections({
    query: "meet",
    commands: await labelled(),
    notes: [note(1, "Meeting prep"), note(2, "Design sync", "meeting")],
    transcripts: [tx(5, "bring notes to the meeting")],
    conversations: [{ id: 3, title: "meeting recap", updated_at: "2026-10-14 12:00:00" }],
    containers: [],
  });
  assert.deepEqual(
    sections.map((s) => s.id),
    ["commands", "notes", "meetings", "transcripts", "chats"]
  );
  assert.equal(sections[0].rows[0].command.id, "recordMeeting");
  assert.deepEqual(sections[0].rows[0].ranges, [[7, 11]]);
});

test("transcripts cap at 8 with a See all row that carries the total", async () => {
  const { buildPaletteSections } = await loadSections();
  const transcripts = Array.from({ length: 11 }, (_, i) => tx(i + 1, `standup item ${i}`));
  const sections = buildPaletteSections({
    query: "standup",
    commands: [],
    notes: [],
    transcripts,
    conversations: [],
    containers: [],
  });
  const rows = sections.find((s) => s.id === "transcripts").rows;
  assert.equal(rows.filter((r) => r.kind === "transcript").length, 8);
  assert.deepEqual(rows.at(-1), {
    kind: "seeAllTranscripts",
    key: "see-all-transcripts",
    total: 11,
  });
});

test("nothing found offers to ask the assistant, which only seeds a draft", async () => {
  const { buildPaletteSections, resolvePaletteSelection } = await loadSections();
  const sections = buildPaletteSections({
    query: "what did we decide",
    commands: [],
    notes: [],
    transcripts: [],
    conversations: [],
    containers: [],
  });
  assert.deepEqual(sections, [
    { id: "nothing", rows: [{ kind: "ask", key: "ask", query: "what did we decide" }] },
  ]);
  assert.deepEqual(resolvePaletteSelection(sections[0].rows[0], "what did we decide"), {
    type: "askDraft",
    draft: "what did we decide",
  });
});

test("a transcript hit deep-links by id; See all keeps the query", async () => {
  const { resolvePaletteSelection } = await loadSections();
  assert.deepEqual(
    resolvePaletteSelection(
      { kind: "transcript", key: "transcript-9", transcript: tx(9, "x"), ranges: [] },
      "x"
    ),
    {
      type: "transcript",
      transcriptId: 9,
    }
  );
  assert.deepEqual(
    resolvePaletteSelection(
      { kind: "seeAllTranscripts", key: "see-all-transcripts", total: 11 },
      " standup "
    ),
    {
      type: "showAllTranscripts",
      query: "standup",
    }
  );
});

test("each queried section keeps its prescribed cap and fuzzy folder candidates survive", async () => {
  const { buildPaletteSections, PALETTE_CAPS } = await loadSections();
  const sections = buildPaletteSections({
    query: "m",
    commands: await labelled(),
    notes: Array.from({ length: 20 }, (_, i) =>
      note(i, "meeting", i < 10 ? "personal" : "meeting")
    ),
    transcripts: Array.from({ length: 12 }, (_, i) => tx(i, "meeting")),
    conversations: Array.from({ length: 10 }, (_, i) => ({
      id: i,
      title: "meeting",
      updated_at: "2026-10-14 12:00:00",
    })),
    containers: Array.from({ length: 10 }, (_, i) => ({
      spaceId: 1,
      folderId: i,
      label: "Meeting folder",
    })),
  });
  for (const id of ["commands", "notes", "meetings", "chats", "folders"])
    assert.ok(sections.find((s) => s.id === id).rows.length <= PALETTE_CAPS[id], id);
  assert.equal(sections.find((s) => s.id === "notes").rows.length, 6);
  assert.equal(sections.find((s) => s.id === "meetings").rows.length, 4);
  assert.equal(sections.find((s) => s.id === "chats").rows.length, 4);
  assert.equal(sections.find((s) => s.id === "folders").rows.length, 5);
  assert.deepEqual(
    sections.map((s) => s.id),
    ["commands", "notes", "meetings", "transcripts", "chats", "folders"]
  );
  const fuzzy = buildPaletteSections({
    query: "gnot",
    commands: [],
    notes: [],
    transcripts: [],
    conversations: [],
    containers: [{ spaceId: 2, folderId: 19, label: "Go to Notes" }],
  });
  assert.equal(fuzzy[0].id, "folders");
  assert.deepEqual(fuzzy[0].rows[0].ranges, [
    [0, 1],
    [6, 9],
  ]);
});
