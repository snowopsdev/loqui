const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDb } = require("./harness/db");
const { setUserDataDir } = require("./harness/electronStub.js");
const AudioStorageManager = require("../../src/helpers/audioStorage.js");
const { createStorageOps } = require("../../src/helpers/storageOps.js");

// A real DatabaseManager and AudioStorageManager in one throwaway profile.
function setup(t, wrap = {}) {
  const db = createDb(t);
  if (!db) return null;
  const audio = new AudioStorageManager(); // createDb pointed userData at its tmpdir
  const broadcasts = [];
  const ops = createStorageOps({
    audio: wrap.audio ? wrap.audio(audio) : audio,
    database: wrap.database ? wrap.database(db) : db,
    broadcast: (channel, payload) => broadcasts.push([channel, payload]),
  });
  return { db, audio, ops, broadcasts };
}

// Five rows: one visible with audio, one visible without, one discarded with
// audio, one soft-deleted with audio, one discarded and soft-deleted. Four
// recordings: three linked, one orphan no row points to. Plus a non-audio file.
function seed({ db, audio }) {
  const insert = db.db.prepare(
    "INSERT INTO transcriptions (text, status, deleted_at, has_audio) VALUES (?, ?, ?, ?)"
  );
  const kept = insert.run("visible", "completed", null, 1).lastInsertRowid;
  insert.run("visible, no audio", "completed", null, 0);
  const discarded = insert.run("discarded", "discarded", null, 1).lastInsertRowid;
  const softDeleted = insert.run(
    "soft-deleted",
    "completed",
    "2026-01-01T00:00:00.000Z",
    1
  ).lastInsertRowid;
  insert.run("discarded, then deleted", "discarded", "2026-01-02T00:00:00.000Z", 0);
  for (const id of [kept, discarded, softDeleted]) {
    assert.equal(audio.saveAudio(Number(id), Buffer.alloc(10, 1), null).success, true);
  }
  fs.writeFileSync(path.join(audio.audioDir, "OpenWhispr-9999.webm"), "orphan!");
  fs.writeFileSync(path.join(audio.audioDir, "notes.txt"), "not a recording");
}

const reviewedAudio = (preview) => ({
  files: preview.audio.files,
  audioIdentity: preview.audio.audioIdentity,
});
const reviewedHistory = (preview) => ({
  total: preview.history.total,
  ...reviewedAudio(preview),
  historyIdentity: preview.history.historyIdentity,
});

const rowCount = (db) => db.db.prepare("SELECT COUNT(*) AS n FROM transcriptions").get().n;
const flagged = (db) =>
  db.db.prepare("SELECT COUNT(*) AS n FROM transcriptions WHERE has_audio = 1").get().n;

// change-driving: storageOps.js does not exist.
test("[change-driving] history preview counts every row and recording; deleting removes exactly that (C2)", (t) => {
  const s = setup(t);
  if (!s) return;
  seed(s);
  const preview = s.ops.preview();
  assert.deepEqual(preview, {
    audio: {
      files: 4,
      bytes: 37,
      directory: s.audio.audioDir,
      audioIdentity: preview.audio.audioIdentity,
    },
    history: {
      total: 5,
      discarded: 1,
      softDeleted: 2,
      withAudio: 3,
      historyIdentity: preview.history.historyIdentity,
    },
  });

  const result = s.ops.deleteHistory({
    expected: reviewedHistory(preview),
  });
  assert.deepEqual(result, {
    ok: true,
    deleted: preview.history.total,
    remaining: 0,
    errors: [],
    audio: { deleted: preview.audio.files, failed: 0, readable: true, remaining: 0 },
  });
  const empty = s.ops.preview();
  assert.deepEqual(empty, {
    audio: {
      files: 0,
      bytes: 0,
      directory: s.audio.audioDir,
      audioIdentity: empty.audio.audioIdentity,
    },
    history: {
      total: 0,
      discarded: 0,
      softDeleted: 0,
      withAudio: 0,
      historyIdentity: empty.history.historyIdentity,
    },
  });
  for (const identity of [
    preview.audio.audioIdentity,
    preview.history.historyIdentity,
    empty.audio.audioIdentity,
    empty.history.historyIdentity,
  ]) {
    assert.match(identity, /^[a-f0-9]{64}$/);
  }
  assert.notEqual(empty.audio.audioIdentity, preview.audio.audioIdentity);
  assert.notEqual(empty.history.historyIdentity, preview.history.historyIdentity);
  assert.ok(fs.existsSync(path.join(s.audio.audioDir, "notes.txt")), "only recordings match");
  assert.deepEqual(s.broadcasts, [
    ["transcriptions-cleared", { cleared: 5 }],
    ["analytics-changed", undefined],
  ]);
});

// change-driving
test("[change-driving] audio deletion removes every recording, linked or not, and keeps transcripts (C2)", (t) => {
  const s = setup(t);
  if (!s) return;
  seed(s);
  const preview = s.ops.preview();
  const previewed = preview.audio.files;
  assert.equal(previewed, 4, "three linked recordings plus the orphan");
  assert.deepEqual(s.ops.deleteAudio({ expected: reviewedAudio(preview) }), {
    ok: true,
    deleted: previewed,
    failed: 0,
    readable: true,
    remaining: 0,
    errors: [],
  });
  assert.equal(rowCount(s.db), 5);
  // Plan 02's clearFlagsForDeletedAudio (spec §5.6) did this, not a second reconciler.
  assert.equal(flagged(s.db), 0, "has_audio cleared for every row whose recording is gone");
  assert.equal(s.ops.preview().audio.files, 0);
});

// change-driving
test("[change-driving] a count that changed after review refuses the delete and touches nothing", (t) => {
  const s = setup(t);
  if (!s) return;
  seed(s);
  assert.deepEqual(
    s.ops.deleteHistory({ expected: { ...reviewedHistory(s.ops.preview()), total: 4 } }),
    {
      ok: false,
      deleted: 0,
      remaining: 5,
      errors: ["stale"],
      audio: { deleted: 0, failed: 0, readable: true, remaining: 4 },
    }
  );
  assert.deepEqual(
    s.ops.deleteAudio({ expected: { ...reviewedAudio(s.ops.preview()), files: 3 } }),
    {
      ok: false,
      deleted: 0,
      failed: 0,
      readable: true,
      remaining: 4,
      errors: ["stale"],
    }
  );
  assert.equal(rowCount(s.db), 5);
  assert.equal(s.ops.preview().audio.files, 4);
});

// change-driving
test("[change-driving] renderer requests without valid reviewed counts and identity digests are refused", (t) => {
  const s = setup(t);
  if (!s) return;
  seed(s);
  assert.deepEqual(s.ops.deleteAudio({ expected: null }), {
    ok: false,
    deleted: 0,
    failed: 0,
    readable: false, // nothing was read
    remaining: null,
    errors: ["invalid-request"],
  });
  for (const expected of [undefined, null, { files: 4 }, { files: 4, audioIdentity: "bad" }]) {
    assert.deepEqual(s.ops.deleteAudio({ expected }).errors, ["invalid-request"]);
  }
  assert.deepEqual(s.ops.deleteAudio().errors, ["invalid-request"]);
  const approved = reviewedHistory(s.ops.preview());
  for (const expected of [
    undefined,
    null,
    { total: 5, files: 4 },
    { ...approved, total: "5" },
    { ...approved, historyIdentity: "bad" },
    { ...approved, audioIdentity: undefined },
  ]) {
    assert.deepEqual(s.ops.deleteHistory({ expected }).errors, ["invalid-request"]);
  }
  assert.deepEqual(s.ops.deleteHistory().errors, ["invalid-request"]);
  assert.equal(rowCount(s.db), 5);
});

// change-driving
test("[change-driving] an unreadable audio folder is an error, never zero, and blocks history deletion (I12)", (t) => {
  const s = setup(t);
  if (!s) return;
  seed(s);
  const reviewed = s.ops.preview();
  fs.rmSync(s.audio.audioDir, { recursive: true, force: true });
  fs.writeFileSync(s.audio.audioDir, "not a folder");
  const preview = s.ops.preview();
  assert.match(preview.audio.error, /ENOTDIR/);
  assert.equal(preview.history.total, 5);
  const result = s.ops.deleteHistory({ expected: reviewedHistory(reviewed) });
  assert.equal(result.ok, false);
  assert.equal(result.deleted, 0);
  assert.equal(result.remaining, null);
  assert.match(result.errors[0], /^count-failed: .*ENOTDIR/);
  assert.equal(result.audio.readable, false, "Plan 02's readable flag, mapped to a typed error");
  assert.equal(rowCount(s.db), 5);
  const audioOnly = s.ops.deleteAudio({ expected: reviewedAudio(reviewed) });
  assert.deepEqual(
    { ok: audioOnly.ok, readable: audioOnly.readable, remaining: audioOnly.remaining },
    { ok: false, readable: false, remaining: null },
    "an unreadable zero is never a clean delete"
  );
});

// change-driving: equal counts cannot authorize new transcript identities/state.
test("[change-driving] equal-count transcript replacement or same-id state change is stale; nothing is touched", (t) => {
  const s = setup(t);
  if (!s) return;
  seed(s);
  for (const replace of [
    () => {
      const id = s.db.db.prepare("SELECT MIN(id) AS id FROM transcriptions").get().id;
      s.db.db.prepare("DELETE FROM transcriptions WHERE id = ?").run(id);
      s.db.db
        .prepare("INSERT INTO transcriptions (text, has_audio) VALUES (?, 1)")
        .run("new transcript");
    },
    () =>
      s.db.db
        .prepare(
          "UPDATE transcriptions SET text = ? WHERE id = (SELECT MIN(id) FROM transcriptions)"
        )
        .run("edited transcript"),
  ]) {
    const before = s.ops.preview();
    replace();
    const result = s.ops.deleteHistory({ expected: reviewedHistory(before) });
    assert.deepEqual(result.errors, ["stale"]);
    assert.equal(result.deleted, 0);
    assert.equal(rowCount(s.db), before.history.total);
    assert.equal(
      s.ops.preview().audio.audioIdentity,
      before.audio.audioIdentity,
      "all audio stays untouched"
    );
    assert.notEqual(s.ops.preview().history.historyIdentity, before.history.historyIdentity);
    assert.deepEqual(s.broadcasts, []);
  }
});

// change-driving: names and stat metadata bind audio even with unchanged count/size.
test("[change-driving] equal-count audio rename, same-name replacement and overwrite block audio AND history deletion", (t) => {
  const s = setup(t);
  if (!s) return;
  seed(s);
  const orphan = path.join(s.audio.audioDir, "OpenWhispr-9999.webm");
  const renamed = path.join(s.audio.audioDir, "OpenWhispr-10000.webm");
  for (const change of [
    () => fs.renameSync(orphan, renamed),
    () => {
      // atomic same-name replacement, same bytes; inode/version differs
      const replacement = path.join(s.audio.audioDir, "replacement.tmp");
      fs.writeFileSync(replacement, "replace");
      fs.renameSync(replacement, renamed);
    },
    () => {
      // overwrite same inode and size; force a deterministic version change
      fs.writeFileSync(renamed, "updated");
      fs.utimesSync(renamed, new Date(0), new Date("2030-01-01T00:00:00Z"));
    },
  ]) {
    const before = s.ops.preview();
    change();
    const after = s.ops.preview();
    assert.equal(after.audio.files, before.audio.files);
    assert.equal(after.audio.bytes, before.audio.bytes);
    assert.notEqual(after.audio.audioIdentity, before.audio.audioIdentity);
    assert.deepEqual(s.ops.deleteAudio({ expected: reviewedAudio(before) }).errors, ["stale"]);
    assert.deepEqual(s.ops.deleteHistory({ expected: reviewedHistory(before) }).errors, ["stale"]);
    assert.equal(rowCount(s.db), 5, "history checks audio identity before clearing rows");
    assert.equal(
      s.ops.preview().audio.audioIdentity,
      after.audio.audioIdentity,
      "no recording touched"
    );
    assert.deepEqual(s.broadcasts, []);
  }
});

// change-driving: readable count is insufficient when any file identity is unknown.
test("[change-driving] stat failure keeps Plan 02 usage shape but blocks Storage preview and deletion", (t) => {
  const s = setup(t);
  if (!s) return;
  seed(s);
  const before = s.ops.preview();
  fs.symlinkSync(
    path.join(s.audio.audioDir, "missing-target"),
    path.join(s.audio.audioDir, "broken.webm")
  );
  const usage = s.audio.getStorageUsage();
  assert.deepEqual(usage, { fileCount: 5, totalBytes: 37, readable: true });
  assert.equal(s.audio.listStoredAudio().identity, null);
  assert.match(s.ops.preview().audio.error, /^stat-failed: broken.webm:/);
  assert.match(
    s.ops.deleteAudio({ expected: reviewedAudio(before) }).errors[0],
    /^count-failed: stat-failed:/
  );
  assert.match(
    s.ops.deleteHistory({ expected: reviewedHistory(before) }).errors[0],
    /^count-failed: stat-failed:/
  );
  assert.equal(rowCount(s.db), 5);
  assert.equal(fs.readdirSync(s.audio.audioDir).filter((name) => name.endsWith(".webm")).length, 5);
});

// change-driving (M4): a main fake that fails one unlink.
test("[change-driving] a partial file failure reports exact deleted and remaining counts (M4)", (t) => {
  const busy = "OpenWhispr-9999.webm";
  const s = setup(t, {
    audio: (real) =>
      Object.create(real, {
        removeFiles: {
          value(names) {
            const done = real.removeFiles(names.filter((name) => name !== busy));
            return {
              deleted: done.deleted,
              failed: [...done.failed, { file: busy, error: "EBUSY" }],
            };
          },
        },
      }),
  });
  if (!s) return;
  seed(s);
  assert.deepEqual(s.ops.deleteAudio({ expected: reviewedAudio(s.ops.preview()) }), {
    ok: false,
    deleted: 3,
    failed: 1,
    readable: true,
    remaining: 1,
    errors: [`delete-failed: ${busy}: EBUSY`],
  });
  assert.deepEqual(s.ops.deleteHistory({ expected: reviewedHistory(s.ops.preview()) }), {
    ok: false,
    deleted: 5,
    remaining: 0,
    errors: [`delete-failed: ${busy}: EBUSY`],
    audio: { deleted: 0, failed: 1, readable: true, remaining: 1 },
  });
});

// change-driving
test("[change-driving] a failed recount leaves the result unknown, not successful, and keeps flags", (t) => {
  let reads = 0;
  const s = setup(t, {
    audio: (real) =>
      Object.create(real, {
        listStoredAudio: {
          value() {
            if (reads++ < 2) return real.listStoredAudio(); // preview and pre-delete identity read
            return {
              files: [],
              totalBytes: 0,
              readable: false,
              directory: real.audioDir,
              error: "EACCES: permission denied",
            };
          },
        },
      }),
  });
  if (!s) return;
  seed(s);
  assert.deepEqual(s.ops.deleteAudio({ expected: reviewedAudio(s.ops.preview()) }), {
    ok: false,
    deleted: 4,
    failed: 0,
    readable: true, // the count before the delete was readable; the recount was not
    remaining: null,
    errors: ["recount-failed: EACCES: permission denied"],
  });
  assert.equal(flagged(s.db), 3, "unknown disk state never clears has_audio");
});

// change-driving: the count and the delete must agree, or nothing happens.
test("[change-driving] if the delete ever removes a different set than the count, it rolls back", (t) => {
  const s = setup(t, {
    database: (real) =>
      Object.create(real, {
        clearTranscriptions: {
          value() {
            const cleared = real.db
              .prepare(
                "DELETE FROM transcriptions WHERE deleted_at IS NULL AND status != 'discarded'"
              )
              .run().changes;
            return { success: true, cleared };
          },
        },
      }),
  });
  if (!s) return;
  seed(s);
  const result = s.ops.deleteHistory({ expected: reviewedHistory(s.ops.preview()) });
  assert.equal(result.ok, false);
  assert.equal(result.deleted, 0);
  assert.equal(result.remaining, 5);
  assert.deepEqual(result.errors, [
    "history-failed: predicate mismatch: counted 5 rows, delete removed 2",
  ]);
  assert.deepEqual(result.audio, { deleted: 0, failed: 0, readable: true, remaining: 4 });
  assert.equal(rowCount(s.db), 5);
  assert.equal(s.ops.preview().audio.files, 4, "rows go first, so no recording was touched");
});

// change-driving: listStoredAudio/removeFiles do not exist.
test("[change-driving] listStoredAudio names what getStorageUsage counts; an unreadable folder is readable: false, never empty", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-audio-list-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setUserDataDir(root);
  const audio = new AudioStorageManager();
  fs.writeFileSync(path.join(audio.audioDir, "OpenWhispr-1.webm"), "abc");
  fs.writeFileSync(path.join(audio.audioDir, "readme.txt"), "x");
  const listed = audio.listStoredAudio();
  assert.deepEqual(listed, {
    files: ["OpenWhispr-1.webm"],
    totalBytes: 3,
    readable: true,
    directory: audio.audioDir,
    identity: listed.identity,
  });
  assert.match(listed.identity, /^[a-f0-9]{64}$/);
  assert.equal(
    audio.listStoredAudio().identity,
    listed.identity,
    "stable for the same files and metadata"
  );
  // Plan 02's shape (spec §5.6), derived from the same list: one predicate for the row, the count and the delete.
  assert.deepEqual(audio.getStorageUsage(), { fileCount: 1, totalBytes: 3, readable: true });
  assert.deepEqual(audio.removeFiles(["../escape.webm", "readme.txt"]), {
    deleted: 0,
    failed: [
      { file: "../escape.webm", error: "not a stored recording" },
      { file: "readme.txt", error: "not a stored recording" },
    ],
  });
  fs.rmSync(audio.audioDir, { recursive: true, force: true });
  fs.writeFileSync(audio.audioDir, "not a folder");
  const unreadable = audio.listStoredAudio();
  assert.equal(unreadable.readable, false);
  assert.deepEqual(unreadable.files, []);
  assert.match(unreadable.error, /ENOTDIR/);
  assert.deepEqual(audio.getStorageUsage(), { fileCount: 0, totalBytes: 0, readable: false });
});

// change-driving
test("[change-driving source guard] the storage bridge has a main handler for every channel", () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");
  const preload = read("preload.js");
  const main = read("src/helpers/ipcHandlers.js");
  for (const channel of ["storage-preview", "storage-delete-audio", "storage-delete-history"]) {
    assert.ok(preload.includes(`ipcRenderer.invoke("${channel}"`), channel);
    assert.ok(main.includes(`ipcMain.handle("${channel}"`), channel);
  }
});

// change-driving: a readable recount with an unknown stat identity is not confirmed.
test("[change-driving] post-delete stat failure leaves the audio remainder unknown and keeps flags", (t) => {
  let reads = 0;
  const s = setup(t, {
    audio: (real) =>
      Object.create(real, {
        listStoredAudio: {
          value() {
            if (++reads === 3)
              fs.symlinkSync(
                path.join(real.audioDir, "missing-target"),
                path.join(real.audioDir, "broken.webm")
              );
            return real.listStoredAudio();
          },
        },
      }),
  });
  if (!s) return;
  seed(s);
  const result = s.ops.deleteAudio({ expected: reviewedAudio(s.ops.preview()) });
  assert.equal(result.ok, false);
  assert.equal(result.deleted, 4);
  assert.equal(result.remaining, null);
  assert.match(result.errors[0], /^recount-failed: stat-failed: broken.webm:/);
  assert.equal(flagged(s.db), 3, "unknown recount identity cannot authorize flag changes");
});

// change-driving: a new unreviewed recording survives and prevents a false zero.
test("[change-driving] post-delete remaining counts new recordings without deleting them", (t) => {
  const s = setup(t, {
    audio: (real) =>
      Object.create(real, {
        removeFiles: {
          value(names) {
            const result = real.removeFiles(names);
            fs.writeFileSync(path.join(real.audioDir, "arrived.webm"), "new");
            return result;
          },
        },
      }),
  });
  if (!s) return;
  seed(s);
  const result = s.ops.deleteAudio({ expected: reviewedAudio(s.ops.preview()) });
  assert.equal(result.ok, false);
  assert.equal(result.deleted, 4);
  assert.equal(result.remaining, 1);
  assert.equal(fs.readFileSync(path.join(s.audio.audioDir, "arrived.webm"), "utf8"), "new");
  const history = s.ops.deleteHistory({ expected: reviewedHistory(s.ops.preview()) });
  assert.equal(history.ok, false);
  assert.equal(history.audio.remaining, 1);
  assert.equal(rowCount(s.db), 0);
});
