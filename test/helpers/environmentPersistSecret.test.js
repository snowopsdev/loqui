const assert = require("node:assert/strict");
const test = require("node:test");

// persistSecret is exercised on a fake `this`, so no real profile, secure-keys
// directory or OS credential service is touched.
const NAME = "VERTEX_API_KEY";

// change-driving: direct acknowledged persistence restores durable prior state on a failed rename.
test("persistSecret rejects when the encrypted write fails and restores the previous value", async (t) => {
  const { realCredentialEnv } = require("./harness/realCredentialEnv");
  const { env, fs } = realCredentialEnv(t, { VERTEX_API_KEY: "fixture-previous" });
  fs.holdNext((op, name) => op === "rename" && name === "VERTEX_API_KEY.enc");
  const saving = env.persistSecret(NAME, "fixture-next");
  const rejected = assert.rejects(saving, /disk full/);
  const held = await fs.nextHold();
  held.fail(new Error("disk full"));
  await rejected;
  assert.equal(env.getVertexApiKey(), "fixture-previous");
  assert.equal(await env.readPersistedSecret(NAME), "fixture-previous");
});

// change-driving: both real persistence modes acknowledge only after rename.
for (const encryptionAvailable of [true, false]) {
  test(`persistSecret awaits durable persistence (encrypted: ${encryptionAvailable})`, async (t) => {
    const { realCredentialEnv } = require("./harness/realCredentialEnv");
    const { env, fs } = realCredentialEnv(t, {}, { encryptionAvailable });
    fs.holdNext(
      (op, name) =>
        op === "rename" && name === (encryptionAvailable ? "VERTEX_API_KEY.enc" : ".env")
    );
    let settled = false;
    const saving = env.persistSecret(NAME, "fixture-value").then(() => {
      settled = true;
    });
    const hold = await fs.nextHold();
    assert.equal(settled, false);
    assert.equal(env.getVertexApiKey(), "");
    hold.release();
    await saving;
    assert.equal(env.getVertexApiKey(), "fixture-value");
    await env.persistSecret(NAME, "");
    assert.equal(env.getVertexApiKey(), "");
    await assert.rejects(env.persistSecret("DICTATION_KEY", "F8"), /not a secret/i);
  });
}
