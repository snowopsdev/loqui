const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SealedState } = require("../../src/helpers/privacy/sealedState");

function profile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-sealed-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("a fresh profile is unsealed", (t) => {
  const state = new SealedState({ profile: profile(t) });
  assert.deepEqual(state.snapshot(), {
    sealed: false,
    sealedSince: null,
    loadError: null,
    saveError: null,
  });
});

test("sealing persists with 0600 and survives a restart", (t) => {
  const dir = profile(t);
  const state = new SealedState({ profile: dir, now: () => 1000 });
  const changes = [];
  state.on("change", (snapshot) => changes.push(snapshot.sealed));
  state.set(true);
  assert.deepEqual(changes, [true]);
  const file = path.join(dir, "privacy.json");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const again = new SealedState({ profile: dir, now: () => 2000 });
  assert.equal(again.isSealed(), true);
  assert.equal(again.snapshot().sealedSince, 1000);
});

test("setting the same value is a no-op and does not reset sealedSince", (t) => {
  let clock = 1000;
  const state = new SealedState({ profile: profile(t), now: () => clock });
  state.set(true);
  clock = 5000;
  let fired = 0;
  state.on("change", () => fired++);
  state.set(true);
  assert.equal(fired, 0);
  assert.equal(state.snapshot().sealedSince, 1000);
});

test("a corrupt file fails closed", (t) => {
  const dir = profile(t);
  fs.writeFileSync(path.join(dir, "privacy.json"), '{"sealed": tru');
  const state = new SealedState({ profile: dir, now: () => 7 });
  assert.equal(state.isSealed(), true);
  assert.equal(state.snapshot().loadError, "corrupt");
  assert.equal(state.snapshot().sealedSince, 7);
});

test("a non-boolean sealed value fails closed", (t) => {
  const dir = profile(t);
  fs.writeFileSync(path.join(dir, "privacy.json"), JSON.stringify({ sealed: "no" }));
  assert.equal(new SealedState({ profile: dir }).snapshot().loadError, "corrupt");
});

test(
  "an unreadable file fails closed",
  { skip: process.platform === "win32" || process.getuid?.() === 0 },
  (t) => {
    const dir = profile(t);
    const file = path.join(dir, "privacy.json");
    fs.writeFileSync(file, JSON.stringify({ sealed: false }));
    fs.chmodSync(file, 0o000);
    try {
      const state = new SealedState({ profile: dir });
      assert.equal(state.isSealed(), true);
      assert.equal(state.snapshot().loadError, "unreadable");
    } finally {
      fs.chmodSync(file, 0o600);
    }
  }
);

test("confirming the seal after a load error rewrites the file and clears the error", (t) => {
  const dir = profile(t);
  fs.writeFileSync(path.join(dir, "privacy.json"), "garbage");
  const state = new SealedState({ profile: dir, now: () => 9 });
  state.set(true);
  assert.equal(state.snapshot().loadError, null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "privacy.json"), "utf8")).sealed, true);
});

test(
  "a failed save keeps the in-memory value and reports saveError",
  { skip: process.platform === "win32" || process.getuid?.() === 0 },
  (t) => {
    const dir = profile(t);
    fs.chmodSync(dir, 0o500);
    try {
      const state = new SealedState({ profile: dir });
      state.set(true);
      assert.equal(state.isSealed(), true);
      assert.match(state.snapshot().saveError, /EACCES|EPERM/);
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  }
);

test("a preexisting broadly-permissioned temporary file is replaced by a 0600 file", (t) => {
  const dir = profile(t);
  const temp = path.join(dir, "privacy.json.tmp");
  fs.writeFileSync(temp, "old");
  fs.chmodSync(temp, 0o666);
  const state = new SealedState({ profile: dir, now: () => 42 });
  state.set(true);
  if (process.platform !== "win32")
    assert.equal(fs.statSync(path.join(dir, "privacy.json")).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(temp), false);
});

test("an existing temporary symlink is not followed", (t) => {
  const dir = profile(t);
  const target = path.join(dir, "outside.json");
  fs.writeFileSync(target, "leave this alone");
  fs.symlinkSync(target, path.join(dir, "privacy.json.tmp"));
  const state = new SealedState({ profile: dir });
  state.set(true);
  assert.equal(fs.readFileSync(target, "utf8"), "leave this alone");
  assert.equal(state.isSealed(), true);
  assert.equal(state.snapshot().saveError, null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "privacy.json"), "utf8")).sealed, true);
});

test("set rejects non-booleans", (t) => {
  const state = new SealedState({ profile: profile(t) });
  assert.throws(() => state.set("true"), TypeError);
  assert.throws(() => state.set(1), TypeError);
});
