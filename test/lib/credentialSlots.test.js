const assert = require("node:assert/strict");
const test = require("node:test");
const { BYOK_API_KEYS } = require("../../src/config/secretKeys");
const {
  CREDENTIAL_IDS,
  slotForCredentialRef,
} = require("../../src/helpers/credentialAuthority.js");

// change-driving: the module does not exist yet.
test("renderer slot tables agree with main's credential authority", async () => {
  const slots = await import("../../src/lib/credentialSlots.ts");
  assert.deepEqual([...slots.MULTI_FIELD_CREDENTIALS].sort(), ["bedrock", "corti:speech"]);
  for (const ref of [
    ...BYOK_API_KEYS.map((k) => k.base).filter((base) => !base.endsWith("-custom")),
    "azure",
    "vertex",
    ...slots.CUSTOM_CREDENTIAL_SLOTS,
  ]) {
    assert.equal(slots.credentialSlotForRef(ref), slotForCredentialRef(ref)?.id, ref);
  }
  assert.equal(slots.credentialSlotForRef("custom:transcription"), "custom:transcription");
  assert.equal(slots.credentialSlotForRef("custom:nope"), undefined);
  assert.equal(slots.credentialSlotForRef(undefined), undefined);
  for (const [storeKey, [slot]] of Object.entries(slots.SECRET_STORE_SLOTS)) {
    assert.ok(
      CREDENTIAL_IDS.includes(slot) || slots.CUSTOM_CREDENTIAL_SLOTS.includes(slot),
      `${storeKey} → ${slot}`
    );
    assert.equal(slots.credentialSlotForStoreKey(storeKey), slot);
  }
  assert.equal(Object.keys(slots.SECRET_STORE_SLOTS).length, 25);
  assert.equal(slots.credentialSlotForStoreKey("cortiEnvironment"), undefined);
  assert.equal(slots.isSecretStoreKey("chatAgentCustomApiKey"), true);
  assert.equal(slots.isSecretStoreKey("cortiTenant"), false);
  assert.deepEqual(await slots.unavailableSecretSave("x"), { ok: false, error: "unavailable" });
});
