const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const gate = require("../../src/helpers/privacy/egressGate");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const privacyBoot = require("../../src/helpers/privacy/privacyBoot");
const registry = require("../../src/helpers/privacy/childRegistry");
const { SealedState, createSpellcheckMarker } = require("../../src/helpers/privacy/sealedState");

// Task 18 re-review T18R-05 (session hardening failures stay until resolved)
// and fix-wave re-review m1 (spellcheck after a sealed quit). The real
// watchSession, syncSessionHardening, createSealTransition and SealedState
// drive fake sessions: each setter takes effect at once and settles later, as
// an Electron preference write does. Nothing reaches Electron or Chromium.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function fakeSession({ spell = true, throwOn = null, rejectOn = null } = {}) {
  const s = {
    proxy: "system",
    spell,
    dict: "default",
    throwOn,
    rejectOn,
    webRequest: {
      onBeforeRequest() {},
      onBeforeSendHeaders() {},
      onBeforeRedirect() {},
      onCompleted() {},
      onErrorOccurred() {},
    },
    isSpellCheckerEnabled: () => s.spell,
  };
  const setter = (method, apply) =>
    function (value) {
      if (s.throwOn === method) throw new Error(`${method} threw`);
      apply(value);
      const rejects = s.rejectOn === method;
      return sleep(2).then(() => (rejects ? Promise.reject(new Error("rejected")) : undefined));
    };
  s.setProxy = setter("setProxy", (config) => (s.proxy = config.mode));
  s.setSpellCheckerEnabled = setter("setSpellCheckerEnabled", (value) => (s.spell = value));
  s.setSpellCheckerDictionaryDownloadURL = setter(
    "setSpellCheckerDictionaryDownloadURL",
    (url) => (s.dict = url)
  );
  return s;
}
function profileDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-harden-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function setup(t) {
  const state = new SealedState({ profile: profileDir(t) });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => state.isSealed(), recorder: { record() {} } });
  const off = () => state.removeAllListeners("change");
  state.on("change", ({ sealed }) => gate.onSealChanged(sealed));
  t.after(off);
  const children = {
    alive: () => [],
    diagnostics: () => ({ unresolved: [] }),
    stopAll: async () => {},
  };
  const transition = privacyBoot.createSealTransition({ state, children, waitMs: 20 });
  return { state, transition };
}

test("a failed hardening stays named after a redundant seal, and clears only when a retry succeeds", async (t) => {
  const { transition } = setup(t);
  const bad = fakeSession({ throwOn: "setProxy" });
  backstop.watchSession(bad);
  await transition.apply(true);
  assert.ok(transition.snapshot().failures.includes("sessionHardening"));
  // A redundant seal request retries it; the failure is still there.
  await transition.apply(true);
  assert.equal(bad.proxy, "system");
  assert.ok(transition.snapshot().failures.includes("sessionHardening"), "not cleared unresolved");
  // The session's API recovers: the next seal request hardens it and clears the name.
  bad.throwOn = null;
  await transition.apply(true);
  assert.equal(bad.proxy, "direct");
  assert.equal(transition.snapshot().failures.includes("sessionHardening"), false);
  await transition.apply(false);
  assert.equal(bad.proxy, "system");
  assert.equal(bad.spell, true);
});

test("a session created while sealed whose hardening rejects is named until it is hardened", async (t) => {
  const { transition } = setup(t);
  await transition.apply(true);
  const lateBad = fakeSession({ rejectOn: "setProxy" });
  backstop.watchSession(lateBad);
  await sleep(10);
  transition.recheck();
  assert.ok(transition.snapshot().failures.includes("sessionHardening"));
  assert.ok(backstop.sessionHardeningFailures().includes("sessionHardening"));
  lateBad.rejectOn = null;
  assert.equal(await backstop.syncSessionHardening(), true, "the unconfirmed session is retried");
  transition.recheck();
  assert.equal(transition.snapshot().failures.includes("sessionHardening"), false);
  await transition.apply(false);
});

test("a session counts as hardened only after every call fulfilled", async (t) => {
  const { state } = setup(t);
  state.set(true);
  const slow = fakeSession({ rejectOn: "setSpellCheckerDictionaryDownloadURL" });
  backstop.watchSession(slow);
  assert.equal(await backstop.syncSessionHardening(), false, "the rejection is reported");
  slow.rejectOn = null;
  // Not marked hardened by the failed attempt: the next sync issues the calls again.
  assert.equal(await backstop.syncSessionHardening(), true);
  assert.equal(slow.dict, "http://127.0.0.1:9/");
  assert.deepEqual(backstop.sessionHardeningFailures(), []);
  state.set(false);
  assert.equal(await backstop.syncSessionHardening(), true);
  // The spellchecker's state from before the seal survives the retried attempt.
  assert.equal(slow.spell, true);
});

// m1: Electron keeps the spellchecker setting in the persistent session's
// preferences. Loqui writes a marker beside the sealed state before it turns
// spellcheck off, and the first unsealed start turns it back on.
test("the spellcheck marker survives a sealed quit and is honoured on the next start", async (t) => {
  const dir = profileDir(t);
  const marker = createSpellcheckMarker(dir);
  assert.equal(marker.isSet(), false);
  const { state, transition } = setup(t);
  backstop.configureSpellcheckMemory(marker);
  t.after(() => backstop.configureSpellcheckMemory(null));
  const s = fakeSession({ spell: true });
  backstop.watchSession(s);
  await transition.apply(true);
  assert.equal(s.spell, false);
  assert.equal(marker.isSet(), true, "written before spellcheck was turned off");
  assert.ok(fs.existsSync(path.join(dir, "privacy-spellcheck.json")));
  if (process.platform !== "win32")
    assert.equal(fs.statSync(path.join(dir, "privacy-spellcheck.json")).mode & 0o777, 0o600);
  // A quit while sealed: the next run reads a session whose persisted
  // preference is off. Sealed again at start, the marker is the prior state.
  const again = fakeSession({ spell: false });
  backstop.watchSession(again);
  await sleep(10);
  await transition.apply(false);
  assert.equal(again.spell, true, "the marker, not the persisted off, is restored");
  assert.equal(createSpellcheckMarker(dir).isSet(), false, "cleared after the restore");
  void state;
});

test("an unsealed start with the marker turns spellcheck back on once", async (t) => {
  const dir = profileDir(t);
  const marker = createSpellcheckMarker(dir);
  assert.equal(marker.set(), true);
  setup(t);
  backstop.configureSpellcheckMemory(createSpellcheckMarker(dir));
  t.after(() => backstop.configureSpellcheckMemory(null));
  const s = fakeSession({ spell: false });
  backstop.watchSession(s);
  await sleep(10);
  assert.equal(s.spell, true);
  assert.equal(createSpellcheckMarker(dir).isSet(), false);
  // Without a marker, a spellchecker the user keeps off stays off.
  const other = fakeSession({ spell: false });
  backstop.watchSession(other);
  await sleep(10);
  assert.equal(other.spell, false);
});

test("boot wires the marker beside privacy.json", async (t) => {
  const dir = profileDir(t);
  fs.writeFileSync(path.join(dir, "privacy.json"), '{"sealed":false}');
  createSpellcheckMarker(dir).set();
  t.after(() => {
    gate._resetForTests();
    registry._resetForTests();
    backstop.configureSpellcheckMemory(null);
  });
  const session = fakeSession({ spell: false });
  const app = Object.assign(new EventEmitter(), { whenReady: () => Promise.resolve() });
  privacyBoot.bootEgressGuards({ app, profile: dir, getDefaultSession: () => session });
  await sleep(20);
  assert.equal(session.spell, true);
  assert.equal(createSpellcheckMarker(dir).isSet(), false);
});
