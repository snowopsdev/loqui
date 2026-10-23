const assert = require("node:assert/strict");
const test = require("node:test");
const { probeSelfHosted } = require("../../src/helpers/selfHostedProbe.js");

test("change-driving: the probe lists models without sending any header", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ data: [{ id: "a" }, { id: "b" }] }) };
  };
  assert.deepEqual(await probeSelfHosted("http://192.168.1.20:11434/v1/", fetchImpl), {
    ok: true,
    count: 2,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://192.168.1.20:11434/v1/models");
  assert.equal("headers" in calls[0].init, false, "no Authorization, ever");
  assert.equal(calls[0].init.redirect, "error");
  await probeSelfHosted("http://localhost:8178", fetchImpl);
  assert.equal(calls[1].url, "http://localhost:8178/models");
});

test("change-driving: the probe classifies failures and refuses plain http to public hosts", async () => {
  const never = async () => {
    throw new Error("must not be called");
  };
  assert.deepEqual(await probeSelfHosted("not a url", never), { ok: false, code: "invalidUrl" });
  assert.deepEqual(await probeSelfHosted("ftp://192.168.1.2/", never), {
    ok: false,
    code: "invalidUrl",
  });
  assert.deepEqual(await probeSelfHosted("http://user:pass@192.168.1.2/", never), {
    ok: false,
    code: "invalidUrl",
  });
  assert.deepEqual(await probeSelfHosted("http://example.com/v1", never), {
    ok: false,
    code: "httpsRequired",
  });
  assert.deepEqual(
    await probeSelfHosted("http://localhost:8178", async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    })),
    { ok: false, code: "http", status: 404 }
  );
  assert.deepEqual(
    await probeSelfHosted("http://localhost:8178", async () => {
      throw new Error("ECONNREFUSED");
    }),
    { ok: false, code: "network" }
  );
});

test("change-driving: the probe and the connection test share one private-host rule", () => {
  const { isPrivateHost } = require("../../src/helpers/providerConnectionTest.js");
  assert.equal(isPrivateHost("192.168.1.20"), true);
  assert.equal(isPrivateHost("example.com"), false);
});
