const assert = require("node:assert/strict");
const test = require("node:test");
const { realCredentialEnv } = require("./harness/realCredentialEnv");

const initial = {
  BEDROCK_REGION: "us-east-1",
  AZURE_OPENAI_ENDPOINT: "https://east.openai.azure.com/openai",
  VERTEX_PROJECT: "acme-prod",
  VERTEX_LOCATION: "us-central1",
  VERTEX_AUTH_SOURCE: "adc",
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const holdEnvRename = (fs) => fs.holdNext((op, name) => op === "rename" && name === ".env");

test("baseline guard: enterprise route patches are expected-tuple, atomic and reset-fenced", async (t) => {
  await t.test(
    "baseline guard: the public transaction requires a complete expected tuple before any file write",
    async (t) => {
      const { env, fs } = realCredentialEnv(t, initial);
      const valid = env.getEnterpriseRouteSettings();
      for (const options of [
        undefined,
        {},
        { expected: undefined },
        { expected: null },
        { expected: { ...valid, vertexProject: undefined } },
      ]) {
        assert.throws(
          () =>
            env.saveEnterpriseRoutePatch(
              { azureEndpoint: "https://west.openai.azure.com/openai" },
              options
            ),
          /expected/i
        );
      }
      assert.deepEqual(
        fs.log.filter((line) => line.includes(".env")),
        [],
        "invalid expectations produce no disk IO"
      );
    }
  );

  await t.test(
    "baseline guard: one held multi-field rename keeps RAM and disk old until ACK, then commits the complete tuple",
    async (t) => {
      const { env, fs } = realCredentialEnv(t, initial);
      const { path: envPath } = await env.saveAllKeysToEnvFile();
      const beforeBytes = fs.files.get(envPath).toString("utf8");
      const before = env.getEnterpriseRouteSettings();
      holdEnvRename(fs);
      const pending = env.saveEnterpriseRoutePatch(
        {
          azureEndpoint: "https://west.openai.azure.com/openai",
          vertexAuthSource: "apiKey",
        },
        { expected: before }
      );
      const rename = await fs.nextHold();
      assert.deepEqual(env.getEnterpriseRouteSettings(), before);
      assert.equal(fs.files.get(envPath).toString("utf8"), beforeBytes);
      rename.release();
      const ack = await pending;
      assert.deepEqual(ack, {
        success: true,
        version: 1,
        current: {
          ...before,
          azureEndpoint: "https://west.openai.azure.com/openai",
          vertexAuthSource: "apiKey",
        },
      });
      assert.deepEqual(env.getEnterpriseRouteSettings(), ack.current);
      assert.match(
        fs.files.get(envPath).toString("utf8"),
        /AZURE_OPENAI_ENDPOINT=https:\/\/west\.openai\.azure\.com\/openai/
      );
      assert.match(fs.files.get(envPath).toString("utf8"), /VERTEX_AUTH_SOURCE=apiKey/);
      assert.equal(
        fs.log.filter((line) => line === "rename .env").length,
        2,
        "one seed write plus one patch rename"
      );
    }
  );

  await t.test(
    "baseline guard: a stale expected tuple conflicts without writing and a failed rename restores the prior tuple",
    async (t) => {
      const { env, fs } = realCredentialEnv(t, initial);
      const { path: envPath } = await env.saveAllKeysToEnvFile();
      const before = env.getEnterpriseRouteSettings();
      const beforeBytes = fs.files.get(envPath).toString("utf8");
      const writesBefore = fs.log.filter((line) => line.startsWith("writeFile .env")).length;
      const conflict = await env.saveEnterpriseRoutePatch(
        { azureEndpoint: "https://west.openai.azure.com/openai" },
        {
          expected: { ...before, azureEndpoint: "https://other.openai.azure.com/openai" },
        }
      );
      assert.deepEqual(conflict, { success: false, conflict: true, current: before, version: 0 });
      assert.equal(fs.log.filter((line) => line.startsWith("writeFile .env")).length, writesBefore);

      holdEnvRename(fs);
      const failed = env.saveEnterpriseRoutePatch(
        { azureEndpoint: "https://west.openai.azure.com/openai" },
        { expected: before }
      );
      const rename = await fs.nextHold();
      rename.fail(new Error("disk unavailable"));
      await assert.rejects(failed, /disk unavailable/);
      assert.deepEqual(env.getEnterpriseRouteSettings(), before);
      assert.equal(
        fs.files.get(envPath).toString("utf8"),
        beforeBytes,
        "atomic rename failure leaves the old file intact"
      );
    }
  );

  await t.test(
    "baseline guard: reset during a held rename rejects the patch and erases its late file",
    async (t) => {
      const { env, fs } = realCredentialEnv(t, initial);
      const { path: envPath } = await env.saveAllKeysToEnvFile();
      holdEnvRename(fs);
      const pending = env.saveEnterpriseRoutePatch(
        { azureEndpoint: "https://west.openai.azure.com/openai" },
        {
          expected: env.getEnterpriseRouteSettings(),
        }
      );
      const rename = await fs.nextHold();
      const reset = env.clearAllPersistedData();
      await tick();
      rename.release();
      await assert.rejects(pending, { code: "ENV_RESET" });
      await reset;
      assert.equal(fs.files.has(envPath), false);
      assert.equal(process.env.AZURE_OPENAI_ENDPOINT, undefined);
    }
  );
});

test("change-driving: public atomic route IPC validates its envelope and preserves migration admission", async (t) => {
  const { enterpriseRouteIpc } = require("./harness/enterpriseRouteIpc");
  const ipc = enterpriseRouteIpc(t, initial);
  const before = ipc.env.getEnterpriseRouteSettings();
  for (const input of [
    null,
    [],
    {},
    { patch: {} },
    { expected: before },
    { patch: { azureEndpoint: "https://new.example/openai" }, expected: before, epoch: 0 },
  ]) {
    await assert.rejects(
      ipc.invoke("save-enterprise-route-patch", input),
      /exactly patch and expected/
    );
  }
  assert.equal(ipc.fs.log.length, 0, "invalid IPC input never reaches persistence");
  let release;
  ipc.target.vertexAuthSourceReady = new Promise((resolve) => {
    release = resolve;
  });
  let read = false;
  const pending = ipc.invoke("get-enterprise-route-state").then((state) => {
    read = true;
    return state;
  });
  await tick();
  assert.equal(read, false);
  const patch = ipc.invoke("save-enterprise-route-patch", {
    patch: { vertexProject: "next-account" },
    expected: before,
  });
  await tick();
  assert.equal(ipc.fs.log.length, 0, "atomic writes also wait for migration");
  release();
  const snapshot = await pending;
  assert.deepEqual(snapshot.current, before);
  assert.equal(snapshot.version, 0);
  const ack = await patch;
  assert.equal(ack.version, 1);
  assert.deepEqual(ack.current, { ...before, vertexProject: "next-account" });
  assert.equal(ipc.broadcasts.length, 1, "one complete committed event");
  assert.deepEqual(ipc.broadcasts[0][1].current, ack.current);
  assert.equal(ipc.broadcasts[0][1].version, ack.version);
});

test("source guard: preload exposes one atomic route write and versioned read/event bridges", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve("../../preload.js"), "utf8");
  assert.match(
    source,
    /saveEnterpriseRoutePatch:\s*\(input\)\s*=>\s*ipcRenderer\.invoke\("save-enterprise-route-patch", input\)/
  );
  assert.match(
    source,
    /getEnterpriseRouteState:.*ipcRenderer\.invoke\("get-enterprise-route-state"\)/
  );
  assert.match(
    source,
    /onEnterpriseRouteChanged:\s*registerListener\(\s*"enterprise-route-changed"/
  );
});
