const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { installElectronStub, setUserDataDir } = require("./harness/electronStub.js");

installElectronStub();
const AudioStorageManager = require("../../src/helpers/audioStorage.js");
const { clearFlagsForDeletedAudio } = require("../../src/helpers/audioFlagReconcile.js");

function makeManager(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-audio-clear-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setUserDataDir(path.join(root, "profile"));
  return { manager: new AudioStorageManager(), root };
}

// The slice of DatabaseManager the reconciliation uses.
function fakeDatabase(ids) {
  const cleared = [];
  return {
    cleared,
    db: { prepare: () => ({ all: () => ids.map((id) => ({ id })) }) },
    clearAudioFlags(list) {
      cleared.push(...list);
      return { success: true };
    },
  };
}

test("a clean delete reports every file and leaves a readable, empty store", (t) => {
  const { manager } = makeManager(t);
  fs.writeFileSync(path.join(manager.audioDir, "OpenWhispr-2026-10-15-09-00-00-1.webm"), "a");
  fs.writeFileSync(path.join(manager.audioDir, "2.webm"), "bb");
  assert.deepEqual(manager.getStorageUsage(), { fileCount: 2, totalBytes: 3, readable: true });
  assert.deepEqual(manager.deleteAllAudio(), { deleted: 2, failed: 0, readable: true });
  assert.deepEqual(manager.getStorageUsage(), { fileCount: 0, totalBytes: 0, readable: true });
});

test("a file that cannot be deleted is counted as a failure, not as deleted", (t) => {
  const { manager } = makeManager(t);
  fs.writeFileSync(path.join(manager.audioDir, "1.webm"), "a");
  // A directory with the .webm suffix: unlinkSync refuses it on every platform.
  fs.mkdirSync(path.join(manager.audioDir, "OpenWhispr-2026-10-15-09-00-00-2.webm"));
  assert.deepEqual(manager.deleteAllAudio(), { deleted: 1, failed: 1, readable: true });
  assert.deepEqual([...manager.remainingAudioIds()], ["2"]);
});

test("an unreadable store is reported, never counted as empty", (t) => {
  const { manager, root } = makeManager(t);
  manager.audioDir = path.join(root, "missing");
  assert.deepEqual(manager.getStorageUsage(), { fileCount: 0, totalBytes: 0, readable: false });
  assert.deepEqual(manager.deleteAllAudio(), { deleted: 0, failed: 0, readable: false });
  assert.equal(manager.remainingAudioIds(), null);
});

test("after a partial delete, only recordings whose file is gone lose their audio flag", (t) => {
  const { manager } = makeManager(t);
  fs.writeFileSync(path.join(manager.audioDir, "1.webm"), "a");
  fs.mkdirSync(path.join(manager.audioDir, "2.webm")); // survives the delete
  manager.deleteAllAudio();
  const database = fakeDatabase([1, 2, 3]);
  assert.deepEqual(clearFlagsForDeletedAudio({ audioStorage: manager, database }), [1, 3]);
  assert.deepEqual(database.cleared, [1, 3], "recording 2 keeps history playback");
});

test("an unreadable store clears no audio flags", (t) => {
  const { manager, root } = makeManager(t);
  manager.audioDir = path.join(root, "missing");
  const database = fakeDatabase([1, 2]);
  assert.deepEqual(clearFlagsForDeletedAudio({ audioStorage: manager, database }), []);
  assert.deepEqual(database.cleared, []);
});

test("the delete-all IPC handler reconciles flags through the helper", () => {
  const ipc = fs.readFileSync(path.join(__dirname, "../../src/helpers/ipcHandlers.js"), "utf8");
  const handler = ipc.match(/ipcMain\.handle\("delete-all-audio"[\s\S]*?\n {4}\}\);/)[0];
  assert.match(handler, /clearFlagsForDeletedAudio\(\{/);
  assert.doesNotMatch(handler, /rows\.map\(\(r\) => r\.id\)\)/, "no blanket unflagging");
});
