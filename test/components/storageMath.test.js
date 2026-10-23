const assert = require("node:assert/strict");
const test = require("node:test");

const AUDIO_IDENTITY = "a".repeat(64);
const HISTORY_IDENTITY = "b".repeat(64);
const load = () => import("../../src/components/settings/storageMath.ts");
const ok = (value) => ({ status: "fulfilled", value });
const no = (message) => ({ status: "rejected", reason: new Error(message) });

// change-driving (all tests): the module does not exist.
test("[change-driving] model totals prefer exact bytes and count only downloaded files", async () => {
  const { summarizeModels } = await load();
  assert.deepEqual(
    summarizeModels({
      whisper: {
        models: [
          { downloaded: true, size_bytes: 147951465, size_mb: 141 },
          { downloaded: false, size_mb: 466 },
        ],
      },
      parakeet: { models: [{ downloaded: true, size_mb: 100 }] },
      llm: [
        { isDownloaded: true, downloadedSize: 1329766560, sizeBytes: 5 },
        { isDownloaded: true, downloadedSize: 0, sizeBytes: 10 },
        { isDownloaded: false, sizeBytes: 99 },
      ],
    }),
    { count: 4, bytes: 147951465 + 100 * 1024 * 1024 + 1329766560 + 10 }
  );
});

test("[change-driving] an unreadable model family is an error, never zero", async () => {
  const { countModels } = await load();
  const good = {
    whisper: ok({ success: true, models: [] }),
    parakeet: ok({ success: true, models: [] }),
    llm: ok([]),
  };
  assert.deepEqual(countModels(good), { ok: true, count: 0, bytes: 0 });
  assert.deepEqual(countModels({ ...good, whisper: no("EACCES") }), {
    ok: false,
    error: "whisper: EACCES",
  });
  assert.deepEqual(countModels({ ...good, parakeet: ok({ success: false, error: "no cache" }) }), {
    ok: false,
    error: "parakeet: no cache",
  });
  assert.deepEqual(countModels({ ...good, llm: ok(undefined) }), {
    ok: false,
    error: "llm: unreadable model list",
  });
});

test("[change-driving] only a clean typed result from main is success", async () => {
  const { outcomeFromResult, historyOutcomeFromResult, outcomeFromRejection } = await load();
  const clean = { failed: 0, readable: true }; // Plan 02's fields (spec §5.6)
  assert.deepEqual(
    outcomeFromResult({ ok: true, deleted: 214, ...clean, remaining: 0, errors: [] }),
    {
      ok: true,
      deleted: 214,
      remaining: 0,
      errors: [],
    }
  );
  assert.equal(
    outcomeFromResult({ ok: true, deleted: 214, ...clean, remaining: null, errors: [] }).ok,
    false
  );
  assert.equal(
    outcomeFromResult({
      ok: true,
      deleted: 214,
      ...clean,
      remaining: 0,
      errors: ["flags-failed: x"],
    }).ok,
    false
  );
  // resolveClearAudioOutcome decides: an unreadable zero and a failed unlink are never "cleared".
  assert.equal(
    outcomeFromResult({
      ok: true,
      deleted: 0,
      failed: 0,
      readable: false,
      remaining: 0,
      errors: [],
    }).ok,
    false
  );
  assert.equal(
    outcomeFromResult({
      ok: true,
      deleted: 213,
      failed: 1,
      readable: true,
      remaining: 0,
      errors: [],
    }).ok,
    false
  );
  assert.deepEqual(
    outcomeFromResult({ ok: true, deleted: 214, remaining: 0, errors: [] }).errors,
    ["invalid-result"],
    "failed and readable are required"
  );
  assert.deepEqual(outcomeFromResult({ deleted: 0 }), {
    ok: false,
    deleted: null,
    remaining: null,
    errors: ["invalid-result"],
  });
  assert.deepEqual(
    outcomeFromResult({ success: true }).deleted,
    null,
    "a legacy shape is not a count"
  );
  assert.deepEqual(
    historyOutcomeFromResult({
      ok: true,
      deleted: 5,
      remaining: 0,
      errors: [],
      audio: { deleted: 1, ...clean, remaining: 3 },
    }),
    { ok: false, deleted: 5, remaining: 0, errors: [], audio: { deleted: 1, remaining: 3 } }
  );
  assert.equal(
    historyOutcomeFromResult({
      ok: true,
      deleted: 5,
      remaining: 0,
      errors: [],
      audio: { deleted: 0, failed: 0, readable: false, remaining: 0 },
    }).ok,
    false,
    "history with an unreadable audio folder is never cleared"
  );
  assert.deepEqual(outcomeFromRejection(new Error("closed"), "history"), {
    ok: false,
    deleted: null,
    remaining: null,
    errors: ["ipc-failed: closed"],
    audio: { deleted: null, remaining: null },
  });
});

test("[change-driving] model deletion is typed per family and needs a zero recount", async () => {
  const { familyOutcome, modelsOutcome } = await load();
  assert.deepEqual(familyOutcome("whisper", ok({ success: true })), {
    family: "whisper",
    ok: true,
  });
  assert.deepEqual(familyOutcome("llm", ok({ success: false, error: "MODEL_BUSY" })), {
    family: "llm",
    ok: false,
    error: "MODEL_BUSY",
  });
  assert.deepEqual(familyOutcome("parakeet", ok(undefined)), {
    family: "parakeet",
    ok: false,
    error: "no success result",
  });
  assert.deepEqual(familyOutcome("parakeet", no("EBUSY")), {
    family: "parakeet",
    ok: false,
    error: "EBUSY",
  });
  const families = [{ family: "whisper", ok: true }];
  assert.equal(modelsOutcome(3, families, 0, null).ok, true);
  assert.deepEqual(modelsOutcome(3, families, null, "EACCES"), {
    ok: false,
    deleted: null,
    remaining: null,
    errors: ["recount-failed: EACCES"],
    families,
  });
  assert.equal(modelsOutcome(3, [{ family: "llm", ok: false, error: "x" }], 0, null).ok, false);
});

// change-driving (Codex P2): models had no main-owned inventory identity.
test("[change-driving] a models preview needs every family list and main's identity", async () => {
  const { modelsFromPreview } = await load();
  const MODELS_IDENTITY = "c".repeat(64);
  const lists = {
    whisper: { success: true, models: [{ downloaded: true, size_bytes: 100 }] },
    parakeet: { success: true, models: [] },
    llm: [{ isDownloaded: true, downloadedSize: 50 }],
  };
  assert.deepEqual(modelsFromPreview({ ...lists, modelsIdentity: MODELS_IDENTITY }), {
    ok: true,
    count: 2,
    bytes: 150,
    modelsIdentity: MODELS_IDENTITY,
  });
  assert.deepEqual(modelsFromPreview({ ...lists, identityError: "llm: model without an id" }), {
    ok: false,
    error: "llm: model without an id",
  });
  assert.deepEqual(modelsFromPreview({ ...lists, modelsIdentity: "short" }), {
    ok: false,
    error: "unknown model identity",
  });
  assert.deepEqual(
    modelsFromPreview({ ...lists, parakeet: { error: "EACCES" }, modelsIdentity: MODELS_IDENTITY }),
    { ok: false, error: "parakeet: EACCES" }
  );
  assert.deepEqual(modelsFromPreview(null), { ok: false, error: "invalid-preview" });
});

test("[change-driving] a models delete result is a refusal, typed families, or unknown", async () => {
  const { modelDeleteFromResult } = await load();
  assert.deepEqual(
    modelDeleteFromResult({ ok: false, remaining: 3, errors: ["stale"], families: null }),
    { families: [], errors: ["stale"], remaining: 3, refused: true }
  );
  assert.deepEqual(
    modelDeleteFromResult({
      ok: false,
      errors: [],
      families: {
        whisper: { success: true },
        parakeet: { success: true },
        llm: { success: false, error: "MODEL_BUSY" },
      },
    }),
    {
      families: [
        { family: "whisper", ok: true },
        { family: "parakeet", ok: true },
        { family: "llm", ok: false, error: "MODEL_BUSY" },
      ],
      errors: [],
      remaining: null,
      refused: false,
    }
  );
  for (const raw of [undefined, { ok: true }, { ok: false, errors: [], families: null }]) {
    assert.deepEqual(modelDeleteFromResult(raw), {
      families: [],
      errors: ["invalid-result"],
      remaining: null,
      refused: false,
    });
  }
});

test("[change-driving] reset succeeds only on success: true with no errors", async () => {
  const { resetOutcome, resetConfirmed } = await load();
  assert.deepEqual(resetOutcome({ success: true, message: "Cleanup completed", errors: [] }), {
    ok: true,
    errors: [],
  });
  assert.deepEqual(
    resetOutcome({ success: false, message: "Cleanup completed", errors: ["DB file: EBUSY"] }),
    {
      ok: false,
      errors: ["DB file: EBUSY"],
    }
  );
  assert.deepEqual(resetOutcome(undefined), { ok: false, errors: ["reset-failed: no result"] });
  assert.equal(resetConfirmed(" Reset ", "reset"), true);
  assert.equal(resetConfirmed("res", "reset"), false);
  assert.equal(resetConfirmed("", ""), false);
});

test("[change-driving] the audio row is Plan 02's useAudioStorageUsage state; unavailable is never zero", async () => {
  const { audioRowFromUsage } = await load();
  const preview = {
    status: "ready",
    snapshot: {
      kind: "audio",
      files: 9,
      bytes: 9,
      directory: "/tmp/a",
      audioIdentity: AUDIO_IDENTITY,
    },
  };
  assert.deepEqual(audioRowFromUsage({ status: "loading" }, preview), { status: "loading" });
  assert.deepEqual(audioRowFromUsage({ status: "unavailable" }, preview), {
    status: "error",
    error: "unavailable",
  });
  assert.deepEqual(audioRowFromUsage({ status: "known", fileCount: 4, totalBytes: 37 }, preview), {
    status: "ready",
    snapshot: {
      kind: "audio",
      files: 4,
      bytes: 37,
      directory: "/tmp/a",
      audioIdentity: AUDIO_IDENTITY,
    },
  });
  assert.deepEqual(
    audioRowFromUsage({ status: "known", fileCount: 4, totalBytes: 37 }, { status: "loading" }),
    { status: "loading" }
  );
  assert.deepEqual(
    audioRowFromUsage(
      { status: "known", fileCount: 4, totalBytes: 37 },
      { status: "error", error: "stat-failed" }
    ),
    { status: "error", error: "stat-failed" }
  );
});

test("[change-driving] an uncountable audio folder makes history uncountable too", async () => {
  const { rowsFromPreview } = await load();
  const history = {
    total: 5,
    discarded: 1,
    softDeleted: 2,
    withAudio: 3,
    historyIdentity: HISTORY_IDENTITY,
  };
  assert.deepEqual(rowsFromPreview({ audio: { error: "ENOTDIR" }, history }), {
    audio: { status: "error", error: "ENOTDIR" },
    history: { status: "error", error: "audio: ENOTDIR" },
  });
  assert.deepEqual(
    rowsFromPreview({
      audio: { files: 4, bytes: 37, directory: "/tmp/a", audioIdentity: AUDIO_IDENTITY },
      history,
    }).history,
    {
      status: "ready",
      snapshot: {
        kind: "history",
        total: 5,
        discarded: 1,
        softDeleted: 2,
        files: 4,
        bytes: 37,
        directory: "/tmp/a",
        audioIdentity: AUDIO_IDENTITY,
        historyIdentity: HISTORY_IDENTITY,
      },
    }
  );
  assert.equal(rowsFromPreview(null).audio.status, "error");
  const audio = { files: 4, bytes: 37, directory: "/tmp/a", audioIdentity: AUDIO_IDENTITY };
  for (const audioIdentity of [undefined, null, "", "bad", "A".repeat(64)]) {
    const invalid = rowsFromPreview({ audio: { ...audio, audioIdentity }, history });
    assert.equal(invalid.audio.status, "error");
    assert.equal(invalid.history.status, "error", "history also needs the audio digest");
  }
  for (const historyIdentity of [undefined, null, "bad"]) {
    assert.equal(
      rowsFromPreview({ audio, history: { ...history, historyIdentity } }).history.status,
      "error"
    );
  }
});

// change-driving: a malformed inventory row cannot establish an empty cache.
test("[change-driving] malformed model rows are uncountable rather than empty", async () => {
  const { countModels } = await load();
  const good = {
    whisper: ok({ success: true, models: [] }),
    parakeet: ok({ success: true, models: [] }),
    llm: ok([]),
  };
  assert.deepEqual(
    countModels({
      ...good,
      llm: ok([{ isDownloaded: true, downloadedSize: 0, sizeBytes: 1200000000, size: "1.2 GB" }]),
    }),
    { ok: true, count: 1, bytes: 1200000000 }
  );
  for (const list of [
    [{}],
    [null],
    [{ isDownloaded: "false" }],
    [{ isDownloaded: true, downloadedSize: NaN }],
  ]) {
    assert.equal(countModels({ ...good, llm: ok(list) }).ok, false);
  }
  assert.equal(countModels({ ...good, whisper: ok({ success: true, models: [{}] }) }).ok, false);
  assert.equal(
    countModels({
      ...good,
      parakeet: ok({ success: true, models: [{ downloaded: true, size_bytes: -1 }] }),
    }).ok,
    false
  );
});
