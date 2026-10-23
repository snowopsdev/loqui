const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const load = () => import("../../src/lib/homeFeed.ts");

// These grouping fixtures describe local wall-clock times; serialize them as
// UTC database instants without changing the timezone of other tests.
const localTimestamp = (value) => new Date(value.replace(" ", "T")).toISOString();

// SQLite stores UTC without a zone; these mimic real rows.
const dictation = (id, timestamp, text, over = {}) => ({
  id,
  text,
  raw_text: null,
  timestamp: localTimestamp(timestamp),
  created_at: localTimestamp(timestamp),
  has_audio: 1,
  audio_duration_ms: 7000,
  provider: "local-parakeet",
  model: "parakeet-v3",
  status: "completed",
  error_message: null,
  error_code: null,
  client_transcription_id: `c${id}`,
  cloud_id: null,
  sync_status: "synced",
  deleted_at: null,
  ...over,
});
const note = (id, updated_at, title, note_type = "personal", content = "") => ({
  id,
  title,
  content,
  note_type,
  folder_id: 1,
  space_id: 1,
  created_at: localTimestamp(updated_at),
  updated_at: localTimestamp(updated_at),
});

for (const zone of ["America/New_York", "Asia/Kathmandu"]) {
  test(`isolated ${zone}: local midnight is a session boundary, fractional offsets and DST stay local`, () => {
    const probe = `
      import assert from 'node:assert/strict';
      import {buildHomeFeed, parseDbTimestamp} from './src/lib/homeFeed.ts';
      const row = (id, at) => ({id, timestamp:new Date(at).toISOString(), text:'two words', status:'completed', audio_duration_ms:1000});
      const feed = (rows) => buildHomeFeed({transcriptions:rows,notes:[],filter:'all',query:''});
      const before = new Date(2026,9,14,23,59).getTime();
      const after = new Date(2026,9,15,0,1).getTime();
      const midnight = feed([row(1,before),row(2,after)]);
      assert.equal(midnight.groups.length,2);
      assert.deepEqual(midnight.groups.map(g=>g.entries[0].kind),['dictation','dictation']);
      assert.equal(feed([row(1,after),row(2,after+120000)]).groups[0].entries[0].kind,'session');
      assert.equal(parseDbTimestamp('2026-10-14 19:51:00'),Date.UTC(2026,9,14,19,51));
      if (process.env.TZ === 'Asia/Kathmandu') {
        assert.equal(new Date(after).getTimezoneOffset(),-345);
        assert.equal(new Date(after).toISOString(),'2026-10-14T18:16:00.000Z');
      } else {
        const spring=feed([row(1,'2026-03-08T06:59:00Z'),row(2,'2026-03-08T07:01:00Z')]);
        assert.equal(spring.groups.length,1);
        assert.equal(spring.groups[0].entries[0].kind,'session');
        const fall=feed([row(1,'2026-11-01T05:59:00Z'),row(2,'2026-11-01T06:01:00Z')]);
        assert.equal(fall.groups.length,1);
        assert.equal(fall.groups[0].entries[0].kind,'session');
      }
      console.log(JSON.stringify({zone:process.env.TZ,midnightGroups:midnight.groups.length,node:process.version}));
    `;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", probe],
      {
        cwd: path.resolve(__dirname, "../.."),
        encoding: "utf8",
        env: {
          ...process.env,
          TZ: zone,
          PATH: `/home/snowdesk/.local/share/mise/installs/node/24.21.0/bin:${process.env.PATH}`,
        },
      }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { zone, midnightGroups: 2, node: process.version });
  });
}

test("dictations within five minutes fold into one session; a longer gap starts a new row", async () => {
  const { buildHomeFeed } = await load();
  const feed = buildHomeFeed({
    transcriptions: [
      dictation(4, "2026-10-14 14:09:00", "Ok so the pricing tiers need names before Thursday."),
      dictation(3, "2026-10-14 14:07:00", "Starter, Studio, and what's the third one."),
      dictation(2, "2026-10-14 14:02:00", "Also the FAQ needs a line on local transcription."),
      dictation(1, "2026-10-14 13:40:00", "Earlier thought."),
    ],
    notes: [],
    filter: "all",
    query: "",
  });
  const entries = feed.groups.flatMap((g) => g.entries);
  assert.deepEqual(
    entries.map((e) => e.kind),
    ["session", "dictation"]
  );
  assert.deepEqual(
    entries[0].items.map((i) => i.id),
    [4, 3, 2]
  );
  assert.equal(entries[0].durationMs, 21000);
  assert.equal(feed.rows, 2);
  assert.equal(feed.captures, 4);
});

test("failed and discarded rows stay visible on their own and are counted", async () => {
  const { buildHomeFeed } = await load();
  const feed = buildHomeFeed({
    transcriptions: [
      dictation(3, "2026-10-14 09:32:00", "ok"),
      dictation(2, "2026-10-14 09:31:00", "", { status: "failed", error_code: "TIMEOUT" }),
      dictation(1, "2026-10-14 09:30:00", "kept", { status: "discarded" }),
    ],
    notes: [],
    filter: "all",
    query: "",
  });
  assert.deepEqual(
    feed.groups[0].entries.map((e) => e.kind),
    ["dictation", "dictation", "dictation"]
  );
  assert.equal(feed.counts.failed, 1);
});

test("a note between two dictations breaks the session", async () => {
  const { buildHomeFeed } = await load();
  const feed = buildHomeFeed({
    transcriptions: [
      dictation(2, "2026-10-14 10:04:00", "b"),
      dictation(1, "2026-10-14 10:00:00", "a"),
    ],
    notes: [note(9, "2026-10-14 10:02:00", "Pricing FAQ draft")],
    filter: "all",
    query: "",
  });
  assert.deepEqual(
    feed.groups[0].entries.map((e) => e.kind),
    ["dictation", "note", "dictation"]
  );
});

test("a hidden note remains a session boundary under the Dictations chip", async () => {
  const { buildHomeFeed } = await load();
  const feed = buildHomeFeed({
    transcriptions: [
      dictation(2, "2026-10-14 10:04:00", "outer words"),
      dictation(1, "2026-10-14 10:00:00", "outer words"),
    ],
    notes: [note(9, "2026-10-14 10:02:00", "invisible note")],
    filter: "dictations",
    query: "",
  });
  assert.deepEqual(
    feed.groups.flatMap((group) => group.entries).map((entry) => entry.kind),
    ["dictation", "dictation"]
  );
  assert.deepEqual(feed.counts, { all: 3, dictations: 2, meetings: 0, notes: 1, failed: 0 });
  assert.equal(feed.rows, 2);
  assert.equal(feed.captures, 2);
  assert.deepEqual([feed.groups[0].captures, feed.groups[0].words], [2, 4]);
});

test("search-hidden records remain boundaries while counts and totals use matches", async () => {
  const { buildHomeFeed } = await load();
  const cases = [
    {
      label: "note",
      transcriptions: [
        dictation(2, "2026-10-14 10:04:00", "outer match"),
        dictation(1, "2026-10-14 10:00:00", "outer match"),
      ],
      notes: [note(9, "2026-10-14 10:02:00", "hidden middle")],
      expectedCounts: { all: 2, dictations: 2, meetings: 0, notes: 0, failed: 0 },
    },
    ...["pending", "failed", "discarded", "completed"].map((status) => ({
      label: `${status} capture`,
      transcriptions: [
        dictation(2, "2026-10-14 10:04:00", "outer match"),
        dictation(3, "2026-10-14 10:02:00", "hidden middle", { status }),
        dictation(1, "2026-10-14 10:00:00", "outer match"),
      ],
      notes: [],
      expectedCounts: {
        all: 2,
        dictations: 2,
        meetings: 0,
        notes: 0,
        failed: 0,
      },
    })),
  ];

  for (const scenario of cases) {
    const feed = buildHomeFeed({
      transcriptions: scenario.transcriptions,
      notes: scenario.notes,
      filter: "all",
      query: "outer match",
    });
    assert.deepEqual(
      feed.groups.flatMap((group) => group.entries).map((entry) => entry.kind),
      ["dictation", "dictation"],
      scenario.label
    );
    assert.deepEqual(feed.counts, scenario.expectedCounts, scenario.label);
    assert.equal(feed.rows, 2, scenario.label);
    assert.equal(feed.captures, 2, scenario.label);
    assert.deepEqual([feed.groups[0].captures, feed.groups[0].words], [2, 4], scenario.label);
  }
});

test("matching uninterrupted dictations still fold under the Dictations chip", async () => {
  const { buildHomeFeed } = await load();
  const feed = buildHomeFeed({
    transcriptions: [
      dictation(2, "2026-10-14 10:04:00", "matching words"),
      dictation(1, "2026-10-14 10:00:00", "matching words"),
    ],
    notes: [],
    filter: "dictations",
    query: "matching",
  });
  const entries = feed.groups.flatMap((group) => group.entries);
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["session"]
  );
  assert.deepEqual(
    entries[0].items.map((item) => item.id),
    [2, 1]
  );
  assert.equal(feed.counts.dictations, 2);
  assert.equal(feed.rows, 1);
  assert.equal(feed.captures, 2);
});

test("chips filter by kind; counts follow the search, not the chip", async () => {
  const { buildHomeFeed } = await load();
  const input = {
    transcriptions: [
      dictation(2, "2026-10-14 12:00:00", "pricing goes out Thursday"),
      dictation(1, "2026-10-14 08:00:00", "standup", { status: "failed" }),
    ],
    notes: [
      note(7, "2026-10-14 11:00:00", "Pricing review", "meeting"),
      note(8, "2026-10-14 10:00:00", "Groceries"),
    ],
    query: "PRICING",
  };
  const meetings = buildHomeFeed({ ...input, filter: "meetings" });
  assert.deepEqual(
    meetings.groups.flatMap((g) => g.entries).map((e) => e.key),
    ["meeting-7"]
  );
  assert.deepEqual(meetings.counts, { all: 2, dictations: 1, meetings: 1, notes: 0, failed: 0 });
  const failed = buildHomeFeed({ ...input, query: "  ", filter: "failed" });
  assert.deepEqual(
    failed.groups.flatMap((g) => g.entries).map((e) => e.key),
    ["dictation-1"]
  );
});

test("an empty result has no groups", async () => {
  const { buildHomeFeed } = await load();
  const feed = buildHomeFeed({
    transcriptions: [dictation(1, "2026-10-14 08:00:00", "hello")],
    notes: [],
    filter: "all",
    query: "zebra",
  });
  assert.deepEqual(feed.groups, []);
  assert.equal(feed.rows, 0);
});

test("day groups total captures and words", async () => {
  const { buildHomeFeed } = await load();
  const feed = buildHomeFeed({
    transcriptions: [
      dictation(2, "2026-10-14 12:00:00", "one two three"),
      dictation(1, "2026-10-12 12:00:00", "four five"),
    ],
    notes: [],
    filter: "all",
    query: "",
  });
  assert.equal(feed.groups.length, 2);
  assert.deepEqual([feed.groups[0].captures, feed.groups[0].words], [1, 3]);
});

test("a transcript folded inside a session can be located for a deep link", async () => {
  const { buildHomeFeed, locateTranscript } = await load();
  const feed = buildHomeFeed({
    transcriptions: [
      dictation(3, "2026-10-14 14:04:00", "c"),
      dictation(2, "2026-10-14 14:02:00", "b"),
      dictation(1, "2026-10-14 09:00:00", "a"),
    ],
    notes: [],
    filter: "all",
    query: "",
  });
  assert.equal(locateTranscript(feed, 2).inSession, true);
  assert.equal(locateTranscript(feed, 1).inSession, false);
  assert.equal(locateTranscript(feed, 99), null);
});

test("database timestamps without a zone are UTC", async () => {
  const { parseDbTimestamp } = await load();
  assert.equal(parseDbTimestamp("2026-10-14 19:51:00"), Date.UTC(2026, 9, 14, 19, 51));
  assert.equal(parseDbTimestamp("2026-10-14T19:51:00Z"), Date.UTC(2026, 9, 14, 19, 51));
  assert.ok(Number.isNaN(parseDbTimestamp("not a date")));
  assert.ok(Number.isNaN(parseDbTimestamp(null)));
});

test("word counts handle punctuation and scripts without spaces", async () => {
  const { countWords } = await load();
  assert.equal(countWords("Let's set aside some time, tomorrow."), 6);
  assert.equal(countWords(""), 0);
  assert.ok(countWords("今日は晴れです") >= 2);
});

test("history locality comes only from a recorded provider", async () => {
  const { transcriptionLocality } = await load();
  assert.equal(transcriptionLocality(null), null);
  assert.equal(transcriptionLocality("local").locality, "device");
  assert.equal(transcriptionLocality("local-parakeet").locality, "device");
  assert.equal(transcriptionLocality("self-hosted").locality, "network");
  // The raw id travels to the UI, which names it with providerDisplayLabel.
  assert.deepEqual(transcriptionLocality("openai"), { locality: "remote", providerId: "openai" });
  assert.deepEqual(transcriptionLocality("local-parakeet"), {
    locality: "device",
    providerId: null,
  });
});

// Full-app M5: a session's length is unknown when any capture's audio length is
// unknown (no saved audio, expired or deleted audio). It is never a false zero.
test("a session with any unknown audio length has no duration; real lengths still add up", async () => {
  const { buildHomeFeed } = await load();
  const session = (durations) =>
    buildHomeFeed({
      transcriptions: durations.map((ms, i) =>
        dictation(10 - i, `2026-10-14 14:0${i}:00`, `Thought ${i}.`, { audio_duration_ms: ms })
      ),
      notes: [],
      filter: "all",
      query: "",
    }).groups[0].entries[0];
  const unknown = session([null, 4000]);
  assert.equal(unknown.kind, "session");
  assert.equal(unknown.durationMs, null);
  assert.equal(session([undefined, undefined]).durationMs, null);
  assert.equal(session([3000, 4000]).durationMs, 7000);
  assert.equal(session([0, 0]).durationMs, 0, "a genuine zero stays possible");
});
