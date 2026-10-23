const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/sealedModeError.ts");

const refused = {
  code: "SEALED_MODE",
  message:
    "[SEALED_MODE] Sealed mode blocked chat to api.openai.com before any socket opened; nothing was sent.",
};
const interrupted = {
  code: "SEALED_MODE",
  message:
    "[SEALED_MODE:interrupted] Sealed mode interrupted chat to api.openai.com; the provider may have received part of the request.",
};

test("recognises the code, the IPC message markers, result envelopes and wrapped causes", async () => {
  const { isSealedModeError, sealedPhase } = await load();
  assert.equal(isSealedModeError({ code: "SEALED_MODE" }), true);
  assert.equal(
    isSealedModeError(new Error(`Error invoking remote method 'x': ${refused.message}`)),
    true
  );
  assert.equal(
    isSealedModeError(new TypeError("fetch failed", { cause: { code: "SEALED_MODE" } })),
    true
  );
  assert.equal(isSealedModeError({ success: false, error: interrupted.message }), true);
  assert.equal(isSealedModeError(new Error("timeout")), false);
  assert.equal(isSealedModeError(null), false);
  assert.equal(sealedPhase(refused), "refused");
  assert.equal(sealedPhase(new Error(`remote: ${interrupted.message}`)), "interrupted");
  assert.equal(
    sealedPhase({ code: "SEALED_MODE", phase: "interrupted" }),
    "interrupted",
    "envelope phase"
  );
  assert.equal(
    sealedPhase({ code: "SEALED_MODE", details: { phase: "interrupted" } }),
    "interrupted"
  );
  assert.equal(
    sealedPhase({ code: "SEALED_MODE", cause: new Error(interrupted.message) }),
    "interrupted",
    "explicit evidence in the cause beats a wrapper's code-only fallback"
  );
  assert.equal(sealedPhase(new Error("timeout")), null);
});

test("dictation copy: History only on audioKept; held is RAM copy; interruption never says nothing sent", async () => {
  const { sealedDictationMessageKey, sealedGenericMessageKey } = await load();
  assert.equal(
    sealedDictationMessageKey(refused, { audioKept: true }),
    "sealedMode.blocked.dictationKept"
  );
  assert.equal(
    sealedDictationMessageKey(refused, { audioKept: false }),
    "sealedMode.blocked.dictationNotKept"
  );
  assert.equal(
    sealedDictationMessageKey(refused),
    "sealedMode.blocked.dictationNotKept",
    "no acknowledgement, no History promise"
  );
  assert.equal(
    sealedDictationMessageKey(interrupted, { audioKept: true }),
    "sealedMode.interrupted.dictationKept"
  );
  assert.equal(sealedDictationMessageKey(interrupted), "sealedMode.interrupted.dictationNotKept");
  assert.equal(
    sealedDictationMessageKey(refused, { held: true, audioKept: true }),
    "sealedMode.blocked.dictationHeld"
  );
  assert.equal(
    sealedDictationMessageKey(interrupted, { held: true }),
    "sealedMode.interrupted.dictationHeld"
  );
  assert.equal(sealedGenericMessageKey(refused), "sealedMode.blocked.generic");
  assert.equal(sealedGenericMessageKey(interrupted), "sealedMode.interrupted.generic");
  assert.equal(
    sealedGenericMessageKey({ code: "SEALED_MODE", phase: "interrupted" }),
    "sealedMode.interrupted.generic"
  );
});
