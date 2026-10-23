const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/helpers/retryDictationCleanup.js");

function deps(processText) {
  const calls = { clipboard: [], notices: [] };
  return {
    calls,
    deps: {
      processText,
      writeClipboard: async (text) => {
        calls.clipboard.push(text);
        return true;
      },
      notify: (n) => calls.notices.push(n),
      t: (k) => k,
    },
  };
}

test("a successful retry copies the cleaned text and leaves a receipt", async () => {
  const { retryDictationCleanup } = await load();
  const { calls, deps: d } = deps(async () => "Hey Maya, see you at 2.");
  assert.equal(await retryDictationCleanup("hey maya see you at two", d), "cleaned");
  assert.deepEqual(calls.clipboard, ["Hey Maya, see you at 2."]);
  assert.equal(calls.notices[0].kind, "receipt");
  assert.equal(calls.notices[0].title, "notices.cleanupFailed.cleaned");
});

test("an unchanged result copies nothing and says so", async () => {
  const { retryDictationCleanup } = await load();
  const { calls, deps: d } = deps(async (text) => text);
  assert.equal(await retryDictationCleanup("already clean", d), "unchanged");
  assert.deepEqual(calls.clipboard, []);
  assert.equal(calls.notices[0].title, "notices.cleanupFailed.noChanges");
});

test("a second failure keeps the raw words and raises an alert", async () => {
  const { retryDictationCleanup } = await load();
  const { calls, deps: d } = deps(async () => {
    throw Object.assign(new Error("timeout"), { messageKey: undefined });
  });
  assert.equal(await retryDictationCleanup("raw words", d), "failed");
  assert.deepEqual(calls.clipboard, []);
  assert.equal(calls.notices[0].kind, "alert");
  assert.equal(calls.notices[0].body, "timeout");
  assert.equal(calls.notices[0].words, "raw words");
});

// TR-1: a sealed refusal on Retry shows translated copy, never main's English text.
test("a sealed failure on Retry raises translated copy, not main's [SEALED_MODE] text (TR-1)", async () => {
  const { retryDictationCleanup } = await load();
  const cases = [
    [
      "Error invoking remote method 'personal-inference:text-generate': SealedModeError: [SEALED_MODE] Sealed mode blocked cleanup to api.example.test before any socket opened; nothing was sent.",
      "sealedMode.blocked.generic",
    ],
    [
      "[SEALED_MODE:interrupted] Sealed mode stopped cleanup mid-transfer",
      "sealedMode.interrupted.generic",
    ],
  ];
  for (const [message, expected] of cases) {
    const { calls, deps: d } = deps(async () => {
      throw new Error(message);
    });
    assert.equal(await retryDictationCleanup("raw words", d), "failed");
    assert.equal(calls.notices[0].body, expected);
    assert.equal(calls.notices[0].words, "raw words");
  }
  const { calls, deps: d } = deps(async () => {
    throw Object.assign(new Error("ignored"), { code: "SEALED_MODE" });
  });
  await retryDictationCleanup("raw words", d);
  assert.equal(calls.notices[0].body, "sealedMode.interrupted.generic");
});

for (const [label, writeClipboard] of [
  ["false", async () => false],
  ["absent acknowledgment", async () => undefined],
  [
    "rejected",
    async () => {
      throw new Error("clipboard unavailable");
    },
  ],
]) {
  test(`cleanup Retry preserves raw words when clipboard is ${label} (M1)`, async () => {
    const { retryDictationCleanup } = await load();
    const { calls, deps: d } = deps(async () => "Cleaned words");
    d.writeClipboard = writeClipboard;
    assert.equal(await retryDictationCleanup("raw words", d), "failed");
    assert.equal(calls.notices[0].kind, "alert");
    assert.equal(calls.notices[0].words, "raw words");
    assert.equal(
      calls.notices.some((n) => n.title === "notices.cleanupFailed.cleaned"),
      false
    );
  });
}

test("absent captured cleanup authority fails visibly without selecting a live route (R1)", async () => {
  const { retryDictationCleanup } = await load();
  const { calls, deps: d } = deps(undefined);
  assert.equal(await retryDictationCleanup("held raw words", d), "failed");
  assert.equal(calls.notices[0].body, "notices.cleanupFailed.unavailable");
  assert.equal(calls.notices[0].words, "held raw words");
  assert.deepEqual(calls.clipboard, []);
});

test("Retry captures its operation once before yielding, even if the caller replaces it (R1 seam)", async () => {
  const { retryDictationCleanup } = await load();
  let finish;
  const { calls, deps: d } = deps(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const pending = retryDictationCleanup("old raw words", d);
  d.processText = () => {
    throw new Error("new route must never receive old words");
  };
  finish("Old operation result");
  assert.equal(await pending, "cleaned");
  assert.deepEqual(calls.clipboard, ["Old operation result"]);
});
