const assert = require("node:assert/strict");
const test = require("node:test");
const { createDb } = require("./harness/db");
const { FlightRecorder, toCsv, MEMORY_LIMIT } = require("../../src/helpers/privacy/flightRecorder");

const DAY = 24 * 60 * 60 * 1000;
const base = { task: "chat", host: "api.groq.com", outcome: "ok", bytesOut: 3100, bytesIn: 9800 };
const rowCount = (db) => db.prepare("SELECT COUNT(*) AS n FROM egress_events").get().n;
function seedNearCap(db, rows = 100499) {
  const insert = db.prepare(
    `INSERT INTO egress_events (ts, ended_at, task, host, hosts, outcome, attributed, opaque, kind)
     VALUES (?, ?, 'chat', 'api.groq.com', 'api.groq.com', 'ok', 1, 0, 'request')`
  );
  db.transaction(() => {
    for (let i = 1; i <= rows; i++) insert.run(i, i);
  })();
}

function persistent(t, now) {
  const manager = createDb(t);
  if (!manager) return null;
  const recorder = new FlightRecorder({ now });
  recorder.attachDatabase(manager.db);
  recorder.setPersistence(true);
  return { recorder, db: manager.db };
}

test("the schema has metadata columns only", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  const columns = manager.db
    .prepare("PRAGMA table_info(egress_events)")
    .all()
    .map((c) => c.name);
  assert.deepEqual(columns, [
    "id",
    "ts",
    "ended_at",
    "task",
    "host",
    "hosts",
    "bytes_out",
    "bytes_in",
    "outcome",
    "status",
    "error_class",
    "model",
    "attributed",
    "opaque",
    "kind",
    "operation_id",
  ]);
});

test("record and list: newest first, normalised public shape with a host trail", (t) => {
  let clock = 1000;
  const ctx = persistent(t, () => clock);
  if (!ctx) return;
  ctx.recorder.record(base);
  clock = 2000;
  ctx.recorder.record({
    ...base,
    task: "modelDownload",
    host: "huggingface.co",
    hosts: ["huggingface.co", "cdn-lfs.hf.co", "huggingface.co"],
    ts: 1500,
    endedAt: 2000,
    bytesOut: undefined,
    status: 200,
  });
  const rows = ctx.recorder.list();
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { ...rows[0], id: 0 },
    {
      id: 0,
      ts: 1500,
      endedAt: 2000,
      task: "modelDownload",
      host: "huggingface.co",
      hosts: ["huggingface.co", "cdn-lfs.hf.co"],
      bytesOut: null,
      bytesIn: 9800,
      outcome: "ok",
      status: 200,
      errorClass: null,
      model: null,
      attributed: true,
      opaque: false,
      kind: "request",
      operationId: null,
    }
  );
  assert.equal(rows[1].task, "chat");
  assert.deepEqual(rows[1].hosts, ["api.groq.com"]);
});

test("record rejects non-host values, in host and in the trail, and unknown enums", () => {
  const recorder = new FlightRecorder();
  for (const host of [
    "https://api.openai.com/v1",
    "api.openai.com/v1",
    "user@host",
    "a host",
    "host?q=1",
    "",
  ]) {
    assert.throws(() => recorder.record({ ...base, host }), TypeError, host);
    assert.throws(
      () => recorder.record({ ...base, hosts: ["api.groq.com", host] }),
      TypeError,
      `trail: ${host}`
    );
  }
  for (const host of ["999.999.999.999", "2001:::1", "2001:db8::gggg"]) {
    assert.throws(() => recorder.record({ ...base, host }), TypeError, host);
  }
  assert.throws(() => recorder.record({ ...base, task: "telemetry" }), TypeError);
  assert.throws(() => recorder.record({ ...base, outcome: "maybe" }), TypeError);
});

test("bytes: unknown stays null, never 0; negatives are unknown; opaque sessions never carry bytes", () => {
  const recorder = new FlightRecorder();
  const row = recorder.record({ ...base, bytesOut: undefined, bytesIn: -5 });
  assert.deepEqual([row.bytesOut, row.bytesIn], [null, null]);
  assert.equal(
    recorder.record({ ...base, outcome: "blocked", bytesOut: 0, bytesIn: 0 }).bytesOut,
    0
  );
  const session = recorder.record({
    task: "codex",
    host: "chatgpt.com",
    outcome: "ok",
    opaque: true,
    bytesOut: 10,
    bytesIn: 20,
  });
  assert.deepEqual([session.opaque, session.bytesOut, session.bytesIn], [true, null, null]);
});

test("model ids and error classes are identifiers or nothing: no URL, credential or free text reaches SQLite or the CSV", (t) => {
  const ctx = persistent(t, () => 5);
  if (!ctx) return;
  const hostile = [
    "https://user:password@example/v1?key=secret",
    "user:password@host",
    "//cdn.example/x",
    "gpt-4o?key=secret",
    "please summarise my secret notes",
    "sk-proj-" + "A".repeat(48),
    "a=b&c=d",
    "gpt\n-4o\u0000",
    "x".repeat(200),
  ];
  for (const value of hostile) ctx.recorder.record({ ...base, model: value, errorClass: value });
  for (const row of ctx.db.prepare("SELECT model, error_class FROM egress_events").all()) {
    assert.equal(row.model, null);
    assert.equal(row.error_class, "OTHER");
  }
  const csv = toCsv(ctx.recorder.list({ limit: 100 }));
  for (const fragment of ["password", "secret", "cdn.example", "summarise", "AAAAAAAA", "key="])
    assert.equal(csv.includes(fragment), false, fragment);
  for (const ok of [
    "gpt-4o-mini",
    "claude-3-5-sonnet@20240620",
    "accounts/fireworks/models/llama-v3p1-8b",
    "anthropic.claude-3-haiku-20240307-v1:0",
    "qwen3.5-2b-q4_k_m",
  ]) {
    assert.equal(ctx.recorder.record({ ...base, model: ok }).model, ok);
  }
  assert.equal(ctx.recorder.record({ ...base, errorClass: "HTTP_5XX" }).errorClass, "HTTP_5XX");
});

// Task 18 T18-07: a credential pasted into a model field must not reach the
// ledger. Known key prefixes, long random runs that include "-"/"_", and long
// mixed-case segments are dropped; real model ids, including long dated and
// mixed-case ones, are kept.
const KEY_SHAPED_MODELS = [
  "AIzaSyD-ABCdefGHIjklMNOpqrSTUvwxYZ01234",
  "sk-proj-abcDEF123ghiJKL456mnoPQR789stu",
  "sk-ant-api03-AbCdEfGhIjKl-MnOp",
  "AKIAIOSFODNN7EXAMPLE",
  "ghp_16C7e42F292c6912E7710c838347Ae178B4a",
  "xoxb-123456789012-1234567890123-AbCdEf",
  "gsk_AbCdEfGh1234",
  "hf_AbCdEfGhIjKlMnOp",
  "glpat-" + "AbCdEfGh1234567890Ij",
  "ya29.a0AfH6SMBx-AbCdEf_GhIjKl",
  "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "Zx8-Qp_3LmN7vR2tY9wK4bH6jF1dS5aE0cU",
  "Ab3-Cd4_Ef5-Gh6_Ij7-Kl8_Mn9-Op0_Qr1-St2",
];
const REAL_MODELS = [
  "gpt-4o-mini-realtime-preview-2024-12-17",
  "gemini-2.5-flash-native-audio-preview-12-2025",
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "nvidia/Llama-3_1-Nemotron-Ultra-253B-v1",
  "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
  "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
  "DeepSeek-R1-0528-Qwen3-8B-Q4_K_M",
  "moonshotai/kimi-k2-instruct-0905",
  "whisper-large-v3-turbo",
  "nova-3-general",
  "whisk-1-mini",
];
test("key-shaped model ids are dropped; real model ids are kept", () => {
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.setPersistence(false);
  for (const value of KEY_SHAPED_MODELS)
    assert.equal(recorder.record({ ...base, model: value }).model, null, value);
  for (const value of REAL_MODELS)
    assert.equal(recorder.record({ ...base, model: value }).model, value, value);
});

test("pending rows flush on the first sync; memory-only rows never become durable", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.attachDatabase(manager.db);
  recorder.record({ ...base, model: "pending" });
  recorder.setPersistence(true);
  assert.equal(rowCount(manager.db), 1);
  recorder.setPersistence(false);
  recorder.record({ ...base, model: "while-off" });
  assert.equal(rowCount(manager.db), 1);
  recorder.setPersistence(true);
  assert.equal(rowCount(manager.db), 1);
  assert.deepEqual(
    recorder
      .list()
      .map((r) => r.model)
      .sort(),
    ["pending", "while-off"]
  );
  recorder.record({ ...base, model: "after" });
  assert.equal(rowCount(manager.db), 2);
});

test("restart: saved rows survive; rows kept in memory while history was off do not", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  const before = new FlightRecorder({ now: () => 5 });
  before.attachDatabase(manager.db);
  before.setPersistence(true);
  before.record({ ...base, model: "saved" });
  before.setPersistence(false);
  before.record({ ...base, model: "memory-only" });
  const after = new FlightRecorder({ now: () => 6 });
  after.attachDatabase(manager.db);
  after.setPersistence(false);
  assert.deepEqual(
    after.list().map((r) => r.model),
    ["saved"]
  );
  after.setPersistence(true);
  assert.equal(rowCount(manager.db), 1);
});

test("history off from the first sync: pending rows stay in memory and are never written", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.attachDatabase(manager.db);
  recorder.record(base);
  recorder.setPersistence(false);
  recorder.setPersistence(true);
  assert.equal(rowCount(manager.db), 0);
  assert.equal(recorder.list().length, 1);
});

test("a failed flush keeps pending rows in memory and reports a code without exposing error text", () => {
  const failingDb = {
    prepare: () => ({
      run: () => {
        throw Object.assign(new Error("secret provider response"), { code: "SQLITE_FULL" });
      },
      all: () => [],
      get: () => ({ n: 0 }),
    }),
    transaction: (fn) => () => fn(),
  };
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.attachDatabase(failingDb);
  recorder.record(base);
  recorder.setPersistence(true);
  assert.equal(recorder.persistError, "SQLITE_FULL");
  assert.equal(recorder.list().length, 1);
});

test("pending flushes share the insert cap cadence and roll back with a failed sweep", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  manager.db
    .prepare(
      `INSERT INTO egress_events (ts, ended_at, task, host, hosts, outcome, attributed, opaque, kind)
       VALUES (?, ?, 'chat', 'api.groq.com', 'api.groq.com', 'ok', 1, 0, 'request')`
    )
    .run(1, 1);
  const insertSeed = manager.db.prepare(
    `INSERT INTO egress_events (ts, ended_at, task, host, hosts, outcome, attributed, opaque, kind)
     VALUES (?, ?, 'chat', 'api.groq.com', 'api.groq.com', 'ok', 1, 0, 'request')`
  );
  const seed = manager.db.transaction(() => {
    for (let i = 1; i < 100499; i++) insertSeed.run(i + 1, i + 1);
  });
  seed();

  const recorder = new FlightRecorder({ now: () => 200000 });
  recorder.attachDatabase(manager.db);
  for (let i = 0; i < 500; i++) recorder.record({ ...base, ts: 200000 + i });
  manager.db.exec(
    "CREATE TRIGGER reject_egress_cap BEFORE DELETE ON egress_events BEGIN SELECT RAISE(ABORT, 'blocked'); END;"
  );
  recorder.setPersistence(true);

  assert.equal(rowCount(manager.db), 100499, "the failed sweep rolls back the pending inserts");
  assert.equal(
    recorder.list({ since: 200000, limit: 1000 }).length,
    500,
    "pending evidence stays in memory"
  );
  assert.equal(recorder.persistError, "SQLITE_CONSTRAINT_TRIGGER");

  manager.db.exec("DROP TRIGGER reject_egress_cap;");
  recorder.setPersistence(true);
  assert.equal(rowCount(manager.db), 100000, "the retry sweeps at the shared 500-write boundary");
  assert.equal(
    recorder.list({ since: 200000, limit: 1000 }).length,
    500,
    "a committed flush has no memory duplicates"
  );
  assert.equal(recorder.persistError, null);
});

test("small pending flushes start from the existing database cap baseline", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  seedNearCap(manager.db);

  const recorder = new FlightRecorder({ now: () => 200000 });
  recorder.attachDatabase(manager.db);
  recorder.record({ ...base, ts: 200000 });
  recorder.record({ ...base, ts: 200001 });
  recorder.setPersistence(true);
  assert.equal(
    rowCount(manager.db),
    100002,
    "100,499 existing rows are swept before a two-row flush"
  );
  assert.ok(rowCount(manager.db) <= 100000 + 500);

  for (const batchSize of [1, 499]) {
    const next = new FlightRecorder({ now: () => 300000 });
    next.attachDatabase(manager.db);
    for (let i = 0; i < batchSize; i++) next.record({ ...base, ts: 300000 + i });
    next.setPersistence(true);
    assert.ok(
      rowCount(manager.db) <= 100000 + 500,
      `${batchSize}-row pending flush remains within MAX_ROWS + CAP_CHECK_EVERY`
    );
    assert.ok(next.persisting);
    assert.equal(next.persistError, null);
    assert.equal(rowCount(manager.db), 100000 + batchSize);
  }
});

test("the first direct insert after attach and after recorder restart caps an existing table", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  seedNearCap(manager.db);

  for (let pass = 0; pass < 2; pass++) {
    const recorder = new FlightRecorder({ now: () => 400000 + pass });
    recorder.attachDatabase(manager.db);
    recorder.setPersistence(true);
    recorder.record({ ...base, ts: 400000 + pass });
    recorder.record({ ...base, ts: 400001 + pass });
    assert.equal(rowCount(manager.db), 100002, `pass ${pass + 1} starts from a swept baseline`);
    assert.ok(rowCount(manager.db) <= 100000 + 500);
  }
});

test("successful reads do not clear unresolved pending write failures", () => {
  let failInsert = true;
  let failRead = false;
  const failingDb = {
    prepare: (sql) => ({
      run: () => {
        if (sql.startsWith("INSERT") && failInsert)
          throw Object.assign(new Error("disk full"), { code: "SQLITE_FULL" });
        return { lastInsertRowid: 1, changes: 0 };
      },
      all: () => {
        if (sql.startsWith("SELECT") && failRead) throw new Error("read failed");
        return [];
      },
      get: () => ({ n: 0 }),
    }),
    transaction: (fn) => () => fn(),
  };
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.attachDatabase(failingDb);
  recorder.setPersistence(true);
  recorder.record(base);
  assert.equal(recorder.persistError, "SQLITE_FULL");

  failRead = true;
  assert.equal(recorder.list().length, 1);
  assert.equal(
    recorder.persistError,
    "SQLITE_FULL",
    "the pending write failure remains visible during a read failure"
  );
  failRead = false;
  assert.equal(recorder.list().length, 1);
  assert.equal(
    recorder.persistError,
    "SQLITE_FULL",
    "read recovery retains the unresolved write error"
  );

  failInsert = false;
  recorder.prune({ retentionDays: 0 });
  assert.equal(
    recorder.persistError,
    null,
    "a successful pending flush resolves the write failure"
  );
});

test("a transactional pending flush can retry without losing or duplicating its row", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.attachDatabase(manager.db);
  recorder.record({ ...base, model: "retry" });
  manager.db.exec(
    "CREATE TRIGGER reject_egress BEFORE INSERT ON egress_events BEGIN SELECT RAISE(ABORT, 'blocked'); END;"
  );
  recorder.setPersistence(true);
  assert.equal(rowCount(manager.db), 0);
  assert.equal(recorder.list().length, 1);
  assert.equal(recorder.persistError, "SQLITE_CONSTRAINT_TRIGGER");
  manager.db.exec("DROP TRIGGER reject_egress;");
  recorder.prune({ retentionDays: 0 });
  assert.equal(rowCount(manager.db), 1);
  assert.equal(recorder.list().length, 1);
  assert.equal(recorder.persistError, null);
});

test("a failed cap sweep leaves the inserted row durable without a memory duplicate", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.attachDatabase(manager.db);
  recorder.setPersistence(true);
  recorder.record(base);
  recorder.record({ ...base, ts: 6 });
  manager.db.exec(
    "CREATE TRIGGER reject_egress_cap BEFORE DELETE ON egress_events BEGIN SELECT RAISE(ABORT, 'blocked'); END;"
  );
  recorder.capRows(1);
  assert.equal(rowCount(manager.db), 2);
  assert.equal(recorder.list({ limit: 1000 }).length, 2);
  assert.equal(recorder.persistError, "SQLITE_CONSTRAINT_TRIGGER");
});

test("memory mode keeps only the newest MEMORY_LIMIT rows", () => {
  const recorder = new FlightRecorder();
  for (let i = 0; i < MEMORY_LIMIT + 10; i++) recorder.record({ ...base, ts: i });
  const rows = recorder.list({ limit: 100000 });
  assert.equal(rows.length, MEMORY_LIMIT);
  assert.equal(rows[0].ts, MEMORY_LIMIT + 9);
});

test("prune deletes rows older than retentionDays and caps the table", (t) => {
  const clock = 100 * DAY;
  const ctx = persistent(t, () => clock);
  if (!ctx) return;
  ctx.recorder.record({ ...base, ts: clock - 40 * DAY });
  ctx.recorder.record({ ...base, ts: clock - 10 * DAY });
  ctx.recorder.record({ ...base, ts: clock - DAY });
  assert.deepEqual(ctx.recorder.prune({ retentionDays: 30 }), { deleted: 1 });
  assert.equal(ctx.recorder.list({ since: 0 }).length, 2);
  assert.deepEqual(ctx.recorder.prune({ retentionDays: 0, maxRows: 1 }), { deleted: 1 });
  assert.equal(ctx.recorder.list({ since: 0 })[0].ts, clock - DAY);
});

test("a since window includes rows still running at its start, on disk and in memory, list and summary alike", (t) => {
  const since = 50 * DAY;
  const ctx = persistent(t, () => since + DAY / 2);
  if (!ctx) return;
  const rows = [
    { model: "yesterday", ts: since - 600000, endedAt: since - 1 },
    { model: "across", ts: since - 300000, endedAt: since + 120000 },
    { model: "today", ts: since + 60000, endedAt: since + 61000 },
  ];
  for (const row of rows) ctx.recorder.record({ ...base, ...row });
  ctx.recorder.setPersistence(false);
  ctx.recorder.record({ ...base, model: "memory-across", ts: since - 1000, endedAt: since });
  ctx.recorder.record({ ...base, model: "memory-before", ts: since - 2000, endedAt: since - 1500 });
  const listed = ctx.recorder.list({ since }).map((r) => r.model);
  assert.deepEqual(listed, ["today", "memory-across", "across"]);
  const summary = ctx.recorder.summary({ since });
  assert.equal(summary.observed, listed.length, "the counts use the same window as the list");
  assert.equal(ctx.recorder.list({ since: 0 }).length, 5);
});

test("summary counts measured request rows separately and preserves unknown byte counts", () => {
  const recorder = new FlightRecorder();
  recorder.record({ ...base, operationId: 7 });
  recorder.record({ ...base, bytesOut: 3100, operationId: 7 });
  recorder.record({ ...base, outcome: "blocked", bytesOut: 0, bytesIn: 0 });
  recorder.record({
    task: "unattributed",
    host: "x.example.com",
    outcome: "ok",
    attributed: false,
  });
  recorder.record({
    task: "unattributed",
    host: "y.example.com",
    kind: "connection",
    outcome: "ok",
    attributed: false,
  });
  recorder.record({ task: "codex", host: "chatgpt.com", outcome: "ok", opaque: true });
  recorder.record({
    task: "chat",
    host: "api.groq.com",
    kind: "operation",
    outcome: "error",
    errorClass: "OTHER",
  });
  assert.deepEqual(recorder.summary({ since: 0 }), {
    left: 5,
    observed: 3,
    connections: 1,
    blocked: 1,
    unattributed: 2,
    unattributedHosts: ["x.example.com", "y.example.com"],
    bytesOut: 6200,
    bytesIn: 19600,
    unknownBytes: 1,
    opaqueSessions: 1,
  });
});

test("clear empties disk and memory and emits cleared", (t) => {
  const ctx = persistent(t, () => 1);
  if (!ctx) return;
  let cleared = 0;
  ctx.recorder.on("cleared", () => cleared++);
  ctx.recorder.record(base);
  ctx.recorder.clear();
  assert.equal(ctx.recorder.list({ since: 0 }).length, 0);
  assert.equal(cleared, 1);
});

test("record emits the public event", () => {
  const recorder = new FlightRecorder();
  const seen = [];
  recorder.on("event", (e) => seen.push(e));
  const row = recorder.record(base);
  assert.deepEqual(seen, [row]);
});

test("CSV export includes kind, neutralises formulas, quotes fields and encodes newlines", () => {
  const csv = toCsv([
    {
      id: 1,
      ts: Date.UTC(2026, 9, 15, 9, 12),
      endedAt: Date.UTC(2026, 9, 15, 9, 13),
      task: "chat",
      kind: "request",
      host: "api.groq.com",
      hosts: ["api.groq.com"],
      bytesOut: 3100,
      bytesIn: null,
      outcome: "ok",
      status: 200,
      errorClass: null,
      model: '=HYPERLINK("x"),"a"',
      attributed: true,
      opaque: false,
    },
  ]);
  const [header, line] = csv.trim().split("\n");
  assert.equal(
    header,
    "started_utc,ended_utc,task,kind,hosts,bytes_sent,bytes_received,outcome,status,error_class,model,attributed,opaque_session"
  );
  assert.equal(
    line,
    '2026-10-15T09:12:00.000Z,2026-10-15T09:13:00.000Z,chat,request,api.groq.com,3100,,ok,200,,"\'=HYPERLINK(""x""),""a""",yes,no'
  );
});
