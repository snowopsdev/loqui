const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/mentionSearch.ts");
const note = (id, title, note_type = "personal") => ({
  id,
  title,
  note_type,
  content: "",
  folder_id: 1,
  space_id: 1,
  created_at: "2026-10-14 10:00:00",
  updated_at: "2026-10-14 10:00:00",
});
const sources = (over = {}) => ({
  people: [
    { name: "Maya Chen", email: "maya@acme.co" },
    { name: "Jonas Weber", email: null },
  ],
  searchContacts: async () => [
    { email: "maya@acme.co", display_name: "Maya Chen" },
    { email: "priya@acme.co", display_name: "Priya Nair" },
  ],
  searchNotes: async () => [note(17, "Pricing FAQ draft"), note(38, "Pricing review", "meeting")],
  recentNotes: [note(5, "Product catch-up")],
  transcriptions: [
    {
      id: 311,
      text: "Draft a reply to Maya: the pricing change goes out Thursday, not Monday.",
      timestamp: "2026-10-14 14:15:00",
      audio_duration_ms: 9000,
    },
  ],
  folders: [
    { id: 2, name: "Work", space_id: 1 },
    { id: 3, name: "Personal", space_id: 1 },
  ],
  describe: {
    note: () => "Work · today",
    meeting: () => "Fri 9 Oct · 55 min",
    dictation: () => "Today 2:15 PM · 0:09",
    folder: () => "3 notes",
  },
  ...over,
});

test("groups come back People, Notes, Meetings, Dictations, Folders, at most three each", async () => {
  const { searchMentionEntities } = await load();
  const groups = await searchMentionEntities("", sources());
  assert.deepEqual(
    groups.map((g) => g.kind),
    ["person", "note", "dictation", "folder"]
  );
  for (const group of groups) assert.ok(group.results.length <= 3, group.kind);
});

test("a query searches every kind and dedupes people by email", async () => {
  const { searchMentionEntities } = await load();
  const groups = await searchMentionEntities("ma", sources());
  const people = groups.find((g) => g.kind === "person").results;
  assert.deepEqual(
    people.map((p) => p.label),
    ["Maya Chen"]
  );
  const pricing = await searchMentionEntities("pricing", sources());
  assert.deepEqual(
    pricing.map((g) => g.kind),
    ["note", "meeting", "dictation"]
  );
  assert.deepEqual(pricing.find((g) => g.kind === "meeting").results[0], {
    key: "meeting-38",
    kind: "meeting",
    label: "Pricing review",
    entityId: "38",
    email: null,
    meta: "Fri 9 Oct · 55 min",
  });
});

test("one failing source never empties the others", async () => {
  const { searchMentionEntities } = await load();
  const groups = await searchMentionEntities(
    "pricing",
    sources({
      searchNotes: async () => {
        throw new Error("db");
      },
    })
  );
  assert.deepEqual(
    groups.map((g) => g.kind),
    ["dictation"]
  );
});

test("chat context can restrict the kinds", async () => {
  const { searchMentionEntities } = await load();
  const groups = await searchMentionEntities("", sources(), ["note", "meeting", "folder"]);
  assert.deepEqual(
    groups.map((g) => g.kind),
    ["note", "folder"]
  );
});

test("dictation labels and quotes are short and clean", async () => {
  const { dictationLabel, quoteExcerpt } = await load();
  assert.equal(
    dictationLabel("Draft a reply to Maya: the pricing change goes out Thursday."),
    "Draft a reply to Maya: the pricing chan…"
  );
  assert.equal(
    quoteExcerpt(
      "## Decisions\n- **Thursday**, not Monday\n[@Maya](mention:maya%40acme.co) owns it"
    ),
    "Decisions Thursday, not Monday @Maya owns it"
  );
  assert.ok(quoteExcerpt("x".repeat(500)).length <= 280);
});

test("all five groups are ordered/capped; local email wins contact duplicates; empty query uses only Recent", async () => {
  const { searchMentionEntities, flattenMentionGroups } = await load();
  const calls = [];
  const many = sources({
    people: [{ name: "Local Maya", email: "MAYA@acme.co" }],
    recentNotes: Array.from({ length: 5 }, (_, i) => note(i + 1, "Recent " + i)).concat(
      Array.from({ length: 5 }, (_, i) => note(i + 10, "Meeting " + i, "meeting"))
    ),
    searchContacts: async () => {
      calls.push("contacts");
      return [{ email: "maya@acme.co", display_name: "Contact Maya" }];
    },
    searchNotes: async () => {
      calls.push("notes");
      return [];
    },
  });
  const groups = await searchMentionEntities("", many);
  assert.deepEqual(
    groups.map((g) => g.kind),
    ["person", "note", "meeting", "dictation", "folder"]
  );
  assert.equal(groups[1].results.length, 3);
  assert.equal(groups[2].results.length, 3);
  assert.deepEqual(calls, []);
  assert.equal(
    flattenMentionGroups(groups).length,
    groups.reduce((sum, g) => sum + g.results.length, 0)
  );
  const queried = await searchMentionEntities("maya", many);
  assert.deepEqual(
    queried.find((g) => g.kind === "person").results.map((p) => p.label),
    ["Local Maya"]
  );
});

test("contact rejection and synchronous preload failure retain other sources and restrictions skip IPC", async () => {
  const { searchMentionEntities } = await load();
  const src = sources({
    searchContacts: () => {
      throw Error("preload");
    },
  });
  assert.deepEqual(
    (await searchMentionEntities("pricing", src)).map((g) => g.kind),
    ["note", "meeting", "dictation"]
  );
  src.searchNotes = () => {
    throw Error("must not call");
  };
  assert.deepEqual(
    (await searchMentionEntities("", src, ["folder"])).map((g) => g.kind),
    ["folder"]
  );
});
test("label and quote cuts preserve surrogate pairs within their published UTF-16 budgets", async () => {
  const { dictationLabel, quoteExcerpt } = await import("../../src/lib/mentionSearch.ts");
  const label = dictationLabel("a".repeat(38) + "😀tail");
  const quote = quoteExcerpt("a".repeat(238) + "😀tail", 240);
  assert.equal(label, "a".repeat(38) + "…");
  assert.equal(quote, "a".repeat(238) + "…");
  assert.ok(label.isWellFormed());
  assert.ok(quote.isWellFormed());
  assert.ok(label.length <= 40);
  assert.ok(quote.length <= 240);
});
