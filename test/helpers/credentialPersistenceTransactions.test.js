const assert = require("node:assert/strict");
const test = require("node:test");
const { realCredentialEnv } = require("./harness/realCredentialEnv");
const { fakeCodexFs } = require("./harness/fakeCredentialEnv");
const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority");
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup(t, initial = {}, options = {}) {
  const real = realCredentialEnv(t, initial, options);
  const events = [];
  const authority = createCredentialAuthority({
    env: real.env,
    fs: fakeCodexFs(),
    codexHome: "/fixture/codex",
    broadcast: (_, change) => events.push(change),
    setTimer() {},
  });
  return { ...real, authority, events };
}
const disk = (fs) => [...fs.files].find(([file]) => file.endsWith("/.env"))?.[1]?.toString() || "";
// change-driving B3: two real shared-file saves must never acknowledge another slot's pending value.
test("plaintext transactions isolate two slots when A succeeds and B fails", async (t) => {
  const { authority, env, fs } = setup(
    t,
    { GROQ_API_KEY: "fixture-old-b" },
    { encryptionAvailable: false }
  );
  fs.holdNext((op, name) => op === "rename" && name === ".env");
  const a = authority.save("openai", "key", "fixture-new-a");
  const heldA = await fs.nextHold();
  const b = authority.save("groq", "key", "fixture-new-b");
  await tick();
  fs.holdNext((op, name) => op === "rename" && name === ".env");
  heldA.release();
  assert.equal((await a).ok, true);
  const heldB = await fs.nextHold();
  assert.match(disk(fs), /^OPENAI_API_KEY=fixture-new-a$/m);
  assert.match(disk(fs), /^GROQ_API_KEY=fixture-old-b$/m);
  heldB.fail(new Error("fixture failed rename"));
  assert.deepEqual(await b, { ok: false, error: "persistFailed" });
  assert.equal(env.getGroqKey(), "fixture-old-b");
  assert.match(disk(fs), /^GROQ_API_KEY=fixture-old-b$/m);
});
// change-driving B3: enterprise snapshots cannot serialize an unrelated pending secret.
test("enterprise and plaintext secret commits share the same complete transaction", async (t) => {
  const { authority, env, fs } = setup(
    t,
    { VERTEX_AUTH_SOURCE: "adc", GROQ_API_KEY: "fixture-old" },
    { encryptionAvailable: false }
  );
  fs.holdNext((op, name) => op === "rename" && name === ".env");
  const enterprise = env.saveVertexProject("fixture-project");
  const held = await fs.nextHold();
  const secret = authority.save("groq", "key", "fixture-new");
  await tick();
  fs.holdNext((op, name) => op === "rename" && name === ".env");
  held.release();
  assert.equal((await enterprise).success, true);
  const heldSecret = await fs.nextHold();
  assert.match(disk(fs), /^GROQ_API_KEY=fixture-old$/m);
  heldSecret.fail(new Error("fixture secret rename failed"));
  assert.equal((await secret).ok, false);
  assert.equal(env.getVertexProject(), "fixture-project");
  assert.match(disk(fs), /^VERTEX_PROJECT=fixture-project$/m);
  assert.match(disk(fs), /^GROQ_API_KEY=fixture-old$/m);
});
// change-driving B6: removal and Undo both restore the previous whole-slot state on second-field failure.
for (const operation of ["remove", "undo"]) {
  for (const rollbackFails of [false, true]) {
    test(`${operation}: second-field failure${rollbackFails ? " plus rollback failure publishes actual new generation" : " rolls back every field"}`, async (t) => {
      const { authority, env, fs, events } = setup(t, {
        CORTI_CLIENT_ID: "fixture-id",
        CORTI_CLIENT_SECRET: "fixture-secret",
      });
      const removed = operation === "undo" ? await authority.remove("corti:speech") : null;
      const beforeGeneration = authority.generation("corti:speech");
      const unlink = fs.promises.unlink;
      const rename = fs.promises.rename;
      fs.promises.unlink = async (file) => {
        if (operation === "remove" && file.endsWith("CORTI_CLIENT_SECRET.enc"))
          throw new Error("fixture second field");
        if (operation === "undo" && rollbackFails && file.endsWith("CORTI_CLIENT_ID.enc"))
          throw new Error("fixture rollback");
        return unlink(file);
      };
      fs.promises.rename = async (from, to) => {
        if (operation === "undo" && to.endsWith("CORTI_CLIENT_SECRET.enc"))
          throw new Error("fixture second field");
        if (operation === "remove" && rollbackFails && to.endsWith("CORTI_CLIENT_ID.enc"))
          throw new Error("fixture rollback");
        return rename(from, to);
      };
      const result =
        operation === "remove"
          ? await authority.remove("corti:speech")
          : await authority.undoRemove(removed.undoToken);
      assert.equal(result.ok, false);
      assert.equal(authority.generation("corti:speech"), beforeGeneration + Number(rollbackFails));
      const captured = await authority.captureCommitted("corti:speech");
      if (!rollbackFails) {
        assert.equal(captured.values.clientId, operation === "remove" ? "fixture-id" : "");
        assert.equal(captured.values.clientSecret, operation === "remove" ? "fixture-secret" : "");
      } else {
        assert.equal(captured.values.clientId, operation === "remove" ? "" : "fixture-id");
        assert.equal(captured.values.clientSecret, operation === "remove" ? "fixture-secret" : "");
        assert.equal(events.at(-1).generation, beforeGeneration + 1);
        assert.equal(events.at(-1).fields.clientId, operation === "undo");
        if (removed) assert.equal((await authority.undoRemove(removed.undoToken)).ok, false);
      }
      assert.equal(env.getCortiClientId(), captured.values.clientId);
    });
  }
}
// change-driving N1: profile is non-secret but its Ready fact is acknowledged.
test("Bedrock profile stays committed through held and failed writes, including removal", async (t) => {
  const { authority, env, fs } = setup(
    t,
    { BEDROCK_PROFILE: "fixture-old" },
    { encryptionAvailable: false }
  );
  fs.holdNext((op, name) => op === "rename" && name === ".env");
  const saving = env.saveBedrockProfile("fixture-new");
  const held = await fs.nextHold();
  assert.equal(env.getBedrockProfile(), "fixture-old");
  assert.equal(authority.present("bedrock"), true);
  held.fail(new Error("fixture profile failed"));
  await assert.rejects(saving);
  assert.equal(env.getBedrockProfile(), "fixture-old");
  await env.saveBedrockProfile("");
  authority.refresh("bedrock");
  assert.equal(authority.present("bedrock"), false);
  assert.doesNotMatch(disk(fs), /^BEDROCK_PROFILE=/m);
});

// change-driving B6: unreadable durable recovery is explicitly unknown, never a stale generation.
test("failed rollback plus unreadable durable storage revokes capture and publishes unknown", async (t) => {
  const { authority, env, fs, events } = setup(t, {
    CORTI_CLIENT_ID: "fixture-id",
    CORTI_CLIENT_SECRET: "fixture-secret",
  });
  const unlink = fs.promises.unlink;
  fs.promises.unlink = async (file) => {
    if (file.endsWith("CORTI_CLIENT_SECRET.enc")) throw new Error("fixture second field");
    return unlink(file);
  };
  fs.promises.rename = async () => {
    throw new Error("fixture rollback");
  };
  fs.promises.readFile = async () => {
    throw new Error("fixture unreadable");
  };
  assert.deepEqual(await authority.remove("corti:speech"), { ok: false, error: "persistFailed" });
  assert.equal(events.at(-1).unknown, true);
  assert.equal(events.at(-1).generation, 1);
  assert.equal(events.at(-1).present, false);
  assert.equal(await authority.captureCommitted("corti:speech"), null);
  await assert.rejects(
    env.saveAllKeysToEnvFile(),
    { code: "CREDENTIAL_UNKNOWN" },
    "unrelated shared rewrites cannot erase an unreadable fallback"
  );
  assert.equal((await authority.save("corti:speech", "clientId", "fixture-new")).ok, false);
});
// change-driving B3/B6: whole-slot plaintext mutation is one snapshot even while another slot writes.
test("a failed plaintext whole-slot removal cannot leak a partial pair through another save", async (t) => {
  const { authority, env, fs } = setup(
    t,
    { CORTI_CLIENT_ID: "fixture-id", CORTI_CLIENT_SECRET: "fixture-secret" },
    { encryptionAvailable: false }
  );
  await env.saveAllKeysToEnvFile();
  fs.holdNext((op, name) => op === "rename" && name === ".env");
  const removing = authority.remove("corti:speech");
  const held = await fs.nextHold();
  const other = authority.save("groq", "key", "fixture-other");
  assert.equal(env.getCortiClientId(), "fixture-id");
  assert.equal(env.getCortiClientSecret(), "fixture-secret");
  held.fail(new Error("fixture removal failed"));
  assert.equal((await removing).ok, false);
  assert.equal((await other).ok, true);
  assert.match(disk(fs), /^CORTI_CLIENT_ID=fixture-id$/m);
  assert.match(disk(fs), /^CORTI_CLIENT_SECRET=fixture-secret$/m);
  assert.match(disk(fs), /^GROQ_API_KEY=fixture-other$/m);
});
// change-driving B7: native save cannot expose an attempted key through main-only capture.
test("main-only committed discovery capture waits for failed native replacement", async (t) => {
  const { authority, fs } = setup(t, { GROQ_API_KEY: "fixture-old" });
  fs.holdNext((op, name) => op === "rename" && name === "GROQ_API_KEY.enc");
  const saving = authority.save("groq", "key", "fixture-new");
  const held = await fs.nextHold();
  let captured = false;
  const capture = authority.captureCommitted("groq").then((value) => {
    captured = true;
    return value;
  });
  await tick();
  assert.equal(captured, false);
  held.fail(new Error("fixture failure"));
  assert.equal((await saving).ok, false);
  assert.deepEqual(await capture, { generation: 0, present: true, values: { key: "fixture-old" } });
});

// change-driving B3/B6: even pre-migration plaintext serialization must not observe a native half-slot.
test("a serializer queued during failed native pair removal retains the committed whole pair", async (t) => {
  const { authority, env, fs } = setup(
    t,
    { CORTI_CLIENT_ID: "fixture-id", CORTI_CLIENT_SECRET: "fixture-secret" },
    { migrationComplete: false }
  );
  await env.saveAllKeysToEnvFile();
  fs.holdNext((op, name) => op === "unlink" && name === "CORTI_CLIENT_SECRET.enc");
  const removing = authority.remove("corti:speech");
  const held = await fs.nextHold();
  const observedId = env.getCortiClientId();
  const writing = env.saveAllKeysToEnvFile().then(() => disk(fs));
  held.fail(new Error("fixture second field failure"));
  assert.equal((await removing).ok, false);
  const serialized = await writing;
  assert.equal(observedId, "fixture-id", "whole-slot RAM remains committed throughout");
  assert.match(serialized, /^CORTI_CLIENT_ID=fixture-id$/m);
  assert.match(serialized, /^CORTI_CLIENT_SECRET=fixture-secret$/m);
});

// change-driving: native saves clear legacy fallback entries without adding new plaintext copies.
test("pre-migration native save and removal clear fallback and survive acknowledged reload", async (t) => {
  const { authority, env, fs, stored } = setup(
    t,
    { GROQ_API_KEY: "fixture-legacy" },
    { migrationComplete: false }
  );
  await env.saveAllKeysToEnvFile();
  assert.match(disk(fs), /^GROQ_API_KEY=fixture-legacy$/m);
  assert.equal((await authority.save("groq", "key", "fixture-native-new")).ok, true);
  assert.doesNotMatch(disk(fs), /GROQ_API_KEY=/);
  assert.equal(await env.readPersistedSecret("GROQ_API_KEY"), "fixture-native-new");
  await env.saveAllKeysToEnvFile();
  assert.doesNotMatch(
    disk(fs),
    /GROQ_API_KEY=/,
    "later serialization never copies a durable native key back to plaintext"
  );
  assert.equal((await authority.remove("groq")).ok, true);
  assert.equal(stored("GROQ_API_KEY"), false);
  assert.equal(await env.readPersistedSecret("GROQ_API_KEY"), "");
  assert.doesNotMatch(disk(fs), /GROQ_API_KEY=/);
});

// change-driving: an uncleared legacy fallback is part of actual startup precedence after rollback failure.
test("pre-migration durable recovery reads the real plaintext fallback after native file loss", async (t) => {
  const { authority, env, fs, events } = setup(
    t,
    { CORTI_CLIENT_ID: "fixture-id", CORTI_CLIENT_SECRET: "fixture-secret" },
    { migrationComplete: false }
  );
  await env.saveAllKeysToEnvFile();
  const unlink = fs.promises.unlink;
  fs.promises.unlink = async (file) => {
    if (file.endsWith("CORTI_CLIENT_SECRET.enc")) throw new Error("fixture second field");
    return unlink(file);
  };
  fs.promises.rename = async () => {
    throw new Error("fixture rollback failure");
  };
  assert.equal((await authority.remove("corti:speech")).ok, false);
  const captured = await authority.captureCommitted("corti:speech");
  assert.equal(
    captured.values.clientId,
    "fixture-id",
    "dotenv loads the remaining actual legacy fallback at next boot"
  );
  assert.equal(captured.values.clientSecret, "fixture-secret");
  assert.equal(captured.generation, 1);
  assert.equal(events.at(-1).unknown, undefined);
});

// change-driving B3: direct legacy writers also capture rollback bases inside the shared queue.
test("direct same-key saves cannot restore an obsolete base after a later failed save", async (t) => {
  const { env, fs } = setup(
    t,
    { GROQ_API_KEY: "fixture-original" },
    { encryptionAvailable: false }
  );
  fs.holdNext((op, name) => op === "rename" && name === ".env");
  const first = env.persistSecret("GROQ_API_KEY", "fixture-first");
  const heldFirst = await fs.nextHold();
  const second = env.persistSecret("GROQ_API_KEY", "fixture-second");
  fs.holdNext((op, name) => op === "rename" && name === ".env");
  heldFirst.release();
  await first;
  const heldSecond = await fs.nextHold();
  const refused = assert.rejects(second, /fixture failure/);
  heldSecond.fail(new Error("fixture failure"));
  await refused;
  assert.equal(env.getGroqKey(), "fixture-first");
  assert.match(disk(fs), /^GROQ_API_KEY=fixture-first$/m);
});

// change-driving review R1: queue admission must observe uncertainty established by earlier work.
test("a save queued before unreadable pair recovery remains refused and cannot clear unknown", async (t) => {
  const { authority, env, fs, events } = setup(t, {
    CORTI_CLIENT_ID: "fixture-id",
    CORTI_CLIENT_SECRET: "fixture-secret",
  });
  fs.holdNext((op, name) => op === "unlink" && name === "CORTI_CLIENT_SECRET.enc");
  const removing = authority.remove("corti:speech");
  const held = await fs.nextHold();
  const queued = authority.save("corti:speech", "clientId", "fixture-queued-new-id");
  const rename = fs.promises.rename;
  fs.promises.rename = async () => {
    throw new Error("fixture rollback failed");
  };
  const readFile = fs.promises.readFile;
  fs.promises.readFile = async (file, encoding) => {
    if (file.endsWith("CORTI_CLIENT_SECRET.enc")) throw new Error("fixture unreadable");
    return readFile(file, encoding);
  };
  const writesBeforeRecovery = fs.log.filter(
    (entry) => entry === "writeFile CORTI_CLIENT_ID.enc.tmp"
  ).length;
  held.fail(new Error("fixture second field failed"));
  assert.deepEqual(await removing, { ok: false, error: "persistFailed" });
  const writesAfterRecovery = fs.log.filter(
    (entry) => entry === "writeFile CORTI_CLIENT_ID.enc.tmp"
  ).length;
  // Restore ordinary writes so refusal cannot be explained by a failing filesystem.
  fs.promises.rename = rename;
  assert.deepEqual(await queued, { ok: false, error: "persistFailed" });
  assert.equal(
    writesAfterRecovery,
    writesBeforeRecovery + 1,
    "only rollback attempted a field write"
  );
  assert.equal(
    fs.log.filter((entry) => entry === "writeFile CORTI_CLIENT_ID.enc.tmp").length,
    writesAfterRecovery,
    "queued save never writes"
  );
  const row = authority.list().find((row) => row.id === "corti:speech");
  assert.equal(row.unknown, true);
  assert.equal(row.generation, 1);
  assert.equal(events.at(-1).unknown, true);
  assert.equal(events.length, 1, "only recovery is published");
  assert.equal(await authority.captureCommitted("corti:speech"), null);
  await assert.rejects(env.saveAllKeysToEnvFile(), { code: "CREDENTIAL_UNKNOWN" });
});

// baseline guard review R1: non-secret profile readiness and refresh cannot clear unknown native fields.
test("Bedrock profile and refresh paths preserve unreadable slot uncertainty", async (t) => {
  const { authority, env, fs, events } = setup(t, {
    BEDROCK_PROFILE: "fixture-profile",
    BEDROCK_ACCESS_KEY_ID: "fixture-id",
    BEDROCK_SECRET_ACCESS_KEY: "fixture-secret",
  });
  const unlink = fs.promises.unlink;
  fs.promises.unlink = async (file) => {
    if (file.endsWith("BEDROCK_SECRET_ACCESS_KEY.enc")) throw new Error("fixture second field");
    return unlink(file);
  };
  fs.promises.rename = async () => {
    throw new Error("fixture rollback");
  };
  const readFile = fs.promises.readFile;
  fs.promises.readFile = async (file, encoding) => {
    if (file.endsWith("BEDROCK_SECRET_ACCESS_KEY.enc")) throw new Error("fixture unreadable");
    return readFile(file, encoding);
  };
  assert.equal((await authority.remove("bedrock")).ok, false);
  await assert.rejects(env.saveBedrockProfile("fixture-new-profile"), {
    code: "CREDENTIAL_UNKNOWN",
  });
  assert.equal(env.getBedrockProfile(), "fixture-profile");
  authority.refresh("bedrock");
  assert.equal(events.at(-1).unknown, true);
  assert.equal(
    events.at(-1).present,
    false,
    "an existing profile cannot make an unknown slot ready"
  );
  assert.equal(events.at(-1).generation, 1);
  assert.equal(await authority.captureCommitted("bedrock"), null);
});

// change-driving review R1: a failed erase must not turn unknown storage into trustworthy absence.
test("failed reset retains unknown credential state until a successful erase", async (t) => {
  const { authority, env, fs, erase } = setup(t, {
    CORTI_CLIENT_ID: "fixture-id",
    CORTI_CLIENT_SECRET: "fixture-secret",
  });
  const unlink = fs.promises.unlink;
  fs.promises.unlink = async (file) => {
    if (file.endsWith("CORTI_CLIENT_SECRET.enc")) throw new Error("fixture second field");
    return unlink(file);
  };
  const rename = fs.promises.rename;
  fs.promises.rename = async () => {
    throw new Error("fixture rollback");
  };
  const readFile = fs.promises.readFile;
  fs.promises.readFile = async (file, encoding) => {
    if (file.endsWith("CORTI_CLIENT_SECRET.enc")) throw new Error("fixture unreadable");
    return readFile(file, encoding);
  };
  assert.equal((await authority.remove("corti:speech")).ok, false);
  fs.promises.rename = rename;
  await assert.rejects(
    authority.reset(async () => {
      throw new Error("fixture erase refused");
    }),
    /fixture erase refused/
  );
  assert.equal(authority.list().find((row) => row.id === "corti:speech").unknown, true);
  assert.equal(await authority.captureCommitted("corti:speech"), null);
  await assert.rejects(env.saveAllKeysToEnvFile(), { code: "CREDENTIAL_UNKNOWN" });
  await authority.reset(erase);
  assert.equal(authority.list().find((row) => row.id === "corti:speech").unknown, undefined);
  assert.equal((await authority.captureCommitted("corti:speech")).present, false);
  assert.equal((await env.saveAllKeysToEnvFile()).success, true);
});
