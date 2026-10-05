const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { installElectronStub, setUserDataDir } = require("./harness/electronStub.js");

installElectronStub();
const AudioStorageManager = require("../../src/helpers/audioStorage.js");

function makeManager(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-audio-traversal-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, "profile", "nested");
  fs.mkdirSync(userData, { recursive: true });
  setUserDataDir(userData);
  return { manager: new AudioStorageManager(), root };
}

function listFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

// The id comes from the renderer over IPC. A separator-bearing id used to be
// resolved by path.join, writing "<anything>.webm" outside the audio directory.
test("saveAudio refuses ids that would resolve outside the audio directory", (t) => {
  const { manager, root } = makeManager(t);

  for (const id of ["x/../../../escape", "../../escape", "a\\..\\..\\escape", "1/../../../2", ""]) {
    assert.deepEqual(manager.saveAudio(id, Buffer.from("PAYLOAD"), null), { success: false }, id);
  }

  assert.deepEqual(listFiles(root), []);
});

test("ids that are not plain digits cannot be looked up or deleted", (t) => {
  const { manager } = makeManager(t);
  assert.equal(manager.saveAudio(7, Buffer.from("a"), null).success, true);

  assert.equal(
    manager.getAudioPath("../" + path.basename(manager.audioDir) + "/OpenWhispr-7"),
    null
  );
  assert.equal(manager.getAudioPath("7.webm"), null);
  assert.ok(manager.getAudioPath(7));
  assert.ok(manager.getAudioPath("7"));
});

test("numeric and numeric-string ids keep their existing file names", (t) => {
  const { manager } = makeManager(t);
  const saved = manager.saveAudio("42", Buffer.from("a"), null);
  assert.equal(path.basename(saved.path), "OpenWhispr-42.webm");
  assert.equal(path.dirname(saved.path), manager.audioDir);
});
