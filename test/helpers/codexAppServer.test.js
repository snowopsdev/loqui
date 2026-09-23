const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  CodexAppServer,
  supportedVersion,
  RESTRICTED_CONFIG,
} = require("../../src/helpers/codexAppServer");
const fixture = require("../fixtures/codex-app-server-0.154.json");

async function setup(t, opts = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "whispr-codex-test-"));
  const sent = [];
  let spawnOptions;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const emit = (message) => child.stdout.write(JSON.stringify(message) + "\n");
  child.kill = () => child.emit("exit", 0);
  child.stdin = new Writable({
    write(bytes, _encoding, callback) {
      const message = JSON.parse(bytes.toString());
      sent.push(message);
      callback();
      if (!message.method || !message.id) return;
      let result = {};
      switch (message.method) {
        case "initialize":
          result = fixture.initialize;
          break;
        case "account/read":
          result = opts.account || fixture.account;
          break;
        case "model/list":
          result = fixture.models;
          break;
        case "account/rateLimits/read":
          result = fixture.limits;
          break;
        case "account/login/start":
          result = {
            loginId: "login-1",
            type: "chatgpt",
            authUrl: "https://auth.openai.com/authorize",
          };
          break;
        case "thread/start":
          result = {
            thread: { id: "thread-1" },
            model: message.params.model,
            modelProvider: "openai",
          };
          break;
        case "turn/start":
          result = { turn: { id: "turn-1", status: "inProgress" } };
          break;
      }
      queueMicrotask(() => {
        emit({ id: message.id, result });
        if (message.method === "turn/start") {
          if (opts.tool) emit(fixture.dynamicTool);
          if (!opts.hang) {
            emit({
              method: "item/agentMessage/delta",
              params: { threadId: "thread-1", turnId: "turn-1", delta: "Hello " },
            });
            emit({
              method: "item/agentMessage/delta",
              params: { threadId: "thread-1", turnId: "turn-1", delta: "world." },
            });
            emit({
              method: "turn/completed",
              params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } },
            });
          }
        }
      });
    },
  });
  const server = new CodexAppServer({
    userDataPath: dir,
    env: {
      PATH: process.env.PATH,
      OPENAI_API_KEY: "fixture-key-not-to-forward",
      CODEX_HOME: "/do-not-inherit",
      ...opts.env,
    },
    homeDir: opts.homeDir,
    runFile: async () => ({ stdout: opts.version || fixture.version }),
    spawnProcess: (_executable, args, options) => {
      spawnOptions = { args, ...options };
      return child;
    },
    timeoutMs: 1000,
  });
  t.after(async () => {
    server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { server, sent, emit, child, spawnOptions: () => spawnOptions };
}

test("Codex version support is deliberately bounded to the tested experimental protocol", () => {
  assert.ok(supportedVersion("codex-cli 0.154.1"));
  assert.ok(supportedVersion("codex-cli 0.155.1"));
  assert.ok(supportedVersion("codex-cli 0.156.0"));
  assert.ok(!supportedVersion("codex-cli 0.153.0"));
  assert.ok(!supportedVersion("codex-cli 0.157.0"));
  assert.ok(!supportedVersion("unexpected"));
});
test("isolates auth/config, never forwards provider keys, and disables native tools", async (t) => {
  const { server, spawnOptions, sent } = await setup(t);
  assert.equal((await server.status()).account.type, "chatgpt");
  assert.equal(spawnOptions().env.OPENAI_API_KEY, undefined);
  assert.ok(spawnOptions().env.CODEX_HOME.endsWith("/codex"));
  assert.equal(RESTRICTED_CONFIG["features.shell_tool"], false);
  assert.equal(RESTRICTED_CONFIG["features.shell_snapshot"], false);
  assert.equal(RESTRICTED_CONFIG["features.view_image"], false);
  assert.equal(RESTRICTED_CONFIG["features.skip_host_skill_discovery"], true);
  assert.equal(RESTRICTED_CONFIG["features.hooks"], false);
  assert.equal(RESTRICTED_CONFIG["features.apps"], false);
  assert.ok(sent.find((m) => m.method === "initialize").params.capabilities.experimentalApi);
  assert.equal((await server.models()).data[0].model, "fixture-model");
  assert.equal((await server.rateLimits()).rateLimits.primary.usedPercent, 15);
});
test("streams and joins delta output with text-only cleanup isolation", async (t) => {
  const { server, sent } = await setup(t);
  const deltas = [];
  const result = await server.generate({
    model: "fixture-model",
    messages: [{ role: "user", content: "hello world" }],
    onText: (text) => deltas.push(text),
  });
  assert.equal(result, "Hello world.");
  assert.deepEqual(deltas, ["Hello ", "world."]);
  const thread = sent.find((m) => m.method === "thread/start").params;
  assert.deepEqual(thread.environments, []);
  assert.deepEqual(thread.dynamicTools, []);
  assert.equal(thread.ephemeral, true);
  assert.equal(thread.allowProviderModelFallback, false);
});
test("refuses API-key accounts and unavailable CLI versions without starting a turn", async (t) => {
  const { server, sent } = await setup(t, { account: { account: { type: "apiKey" } } });
  await assert.rejects(server.generate({ model: "fixture-model", messages: [] }), {
    code: "CODEX_LOGIN_REQUIRED",
  });
  assert.equal(
    sent.some((m) => m.method === "turn/start"),
    false
  );
  const incompatible = await setup(t, { version: "codex-cli 0.157.0" });
  assert.equal((await incompatible.server.status()).code, "CODEX_VERSION");
});
test("bridges only registered dynamic tools using the 0.154 protocol", async (t) => {
  const { server, sent, emit } = await setup(t, { tool: true, hang: true });
  let called;
  const result = server.generate({
    model: "fixture-model",
    messages: [],
    tools: [
      { name: "search_notes", description: "Search local notes", parameters: { type: "object" } },
    ],
    executeTool: async (name, args) => {
      called = { name, args };
      return { notes: [] };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(called, { name: "search_notes", args: { query: "demo" } });
  assert.deepEqual(sent.find((m) => m.id === 900).result, {
    success: true,
    contentItems: [{ type: "inputText", text: '{"notes":[]}' }],
  });
  emit({
    id: 901,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread-1" },
  });
  assert.deepEqual(sent.find((m) => m.id === 901).result, { decision: "decline" });
  emit({
    method: "turn/completed",
    params: { threadId: "thread-1", turn: { status: "completed" } },
  });
  await result;
});
test("interrupts cancellation and rejects pending requests after a process crash", async (t) => {
  const { server, sent, child } = await setup(t, { hang: true });
  const controller = new AbortController();
  const result = server.generate({
    model: "fixture-model",
    messages: [],
    signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.abort();
  await assert.rejects(result, { code: "ABORT_ERR" });
  assert.ok(sent.some((m) => m.method === "turn/interrupt"));
  const crashed = server.generate({ model: "fixture-model", messages: [] });
  await new Promise((resolve) => setTimeout(resolve, 30));
  child.emit("exit", 1);
  await assert.rejects(crashed, { code: "CODEX_DISCONNECTED" });
});
test("managed sign-in and cancellation never return auth tokens", async (t) => {
  const { server, sent } = await setup(t);
  assert.equal((await server.login()).loginId, "login-1");
  await server.cancelLogin("login-1");
  await server.logout();
  assert.deepEqual(sent.find((m) => m.method === "account/login/start").params, {
    type: "chatgpt",
  });
  assert.deepEqual(sent.find((m) => m.method === "account/login/cancel").params, {
    loginId: "login-1",
  });
});

test("missing CLI and expired subscription sessions produce actionable errors", async (t) => {
  const missing = await setup(t);
  missing.server.runFile = async () => {
    throw Object.assign(new Error("not found"), { code: "ENOENT" });
  };
  assert.equal((await missing.server.status()).code, "CODEX_MISSING");
  assert.equal(missing.sent.length, 0);
  const expired = await setup(t, { account: { account: null } });
  await assert.rejects(expired.server.generate({ model: "fixture-model", messages: [] }), {
    code: "CODEX_LOGIN_REQUIRED",
  });
  assert.equal(
    expired.sent.some((message) => message.method === "turn/start"),
    false
  );
});

test("exhausted subscription limits reject the turn without successful completion", async (t) => {
  const { server, emit, sent } = await setup(t, { hang: true });
  const pending = server.generate({
    model: "fixture-model",
    messages: [{ role: "user", content: "retain this input" }],
  });
  const rejected = assert.rejects(pending, /usage limit/i);
  await new Promise((resolve) => setTimeout(resolve, 15));
  emit({
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "failed",
        error: { message: "You have hit your usage limit.", codexErrorInfo: "usageLimitExceeded" },
      },
    },
  });
  await rejected;
  assert.equal(sent.filter((message) => message.method === "turn/start").length, 1);
  assert.equal(server.turns.size, 0);
});

test("discovers user-local npm launcher and Hermes Node runtime from a GUI PATH", async (t) => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-discovery-"));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  const bin = path.join(homeDir, ".local", "bin");
  const nodeBin = path.join(homeDir, ".hermes", "node", "bin");
  await fs.mkdir(bin, { recursive: true });
  await fs.mkdir(nodeBin, { recursive: true });
  await fs.symlink(process.execPath, path.join(nodeBin, "node"));
  await fs.writeFile(
    path.join(bin, "codex"),
    '#!/usr/bin/env node\nprocess.stdout.write("codex-cli 0.155.1");\n',
    { mode: 0o755 }
  );
  const { server, spawnOptions } = await setup(t, { homeDir, env: { PATH: "/usr/bin:/bin" } });
  server.runFile = require("node:util").promisify(require("node:child_process").execFile);
  assert.equal((await server.status()).version, "codex-cli 0.155.1");
  assert.ok(spawnOptions().env.PATH.split(path.delimiter).includes(bin));
  assert.ok(spawnOptions().env.PATH.split(path.delimiter).includes(nodeBin));
});

test("an installed CLI that fails to execute is not reported as missing", async (t) => {
  const { server } = await setup(t);
  server.runFile = async () => {
    throw Object.assign(new Error("not executable"), { code: "EACCES" });
  };
  const status = await server.status();
  assert.equal(status.code, "CODEX_PROCESS");
  assert.match(status.error, /permissions/);
});

for (const version of ["0.155.1", "0.156.0"])
  test(`${version} requests and dynamic tools conform to the installed CLI schemas`, async (t) => {
    const Ajv = require("ajv");
    const ajv = new Ajv({ strict: false, allErrors: true });
    const validate = (name, value) => {
      const schema = require(`../fixtures/codex-app-server-${version}/${name}.json`);
      assert.ok(ajv.validate(schema, value), JSON.stringify(ajv.errors));
    };
    const { server, sent } = await setup(t, { version: `codex-cli ${version}`, tool: true });
    await server.login();
    assert.equal(
      await server.generate({
        model: "fixture-model",
        messages: [{ role: "user", content: "hello" }],
        tools: [
          { name: "search_notes", description: "Search notes", parameters: { type: "object" } },
        ],
        executeTool: async () => ({ notes: [] }),
      }),
      "Hello world."
    );
    for (const [method, name] of [
      ["account/login/start", "LoginAccountParams"],
      ["thread/start", "ThreadStartParams"],
      ["turn/start", "TurnStartParams"],
    ])
      validate(
        name,
        JSON.parse(JSON.stringify(sent.find((message) => message.method === method).params))
      );
    validate("DynamicToolCallParams", fixture.dynamicTool.params);
    validate("DynamicToolCallResponse", sent.find((message) => message.id === 900).result);
    validate("AgentMessageDeltaNotification", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      delta: "Hello ",
    });
  });
