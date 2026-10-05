const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { CodexAppServer } = require("../../src/helpers/codexAppServer");
const fixture = require("../fixtures/codex-app-server-0.154.json");

// A scripted app-server child: `script` receives each request after its
// response has been written and may emit further notifications.
async function setup(t, script) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "loqui-codex-stream-"));
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit("exit", 0);
  const write = (text) => child.stdout.write(text);
  const emit = (message) => write(JSON.stringify(message) + "\n");
  child.stdin = new Writable({
    write(bytes, _encoding, callback) {
      callback();
      const message = JSON.parse(bytes.toString());
      if (!message.method || !message.id) return;
      const results = {
        initialize: fixture.initialize,
        "account/read": fixture.account,
        "thread/start": {
          thread: { id: "thread-1" },
          model: message.params.model,
          modelProvider: "openai",
        },
        "turn/start": { turn: { id: "turn-1", status: "inProgress" } },
      };
      queueMicrotask(() => {
        emit({ id: message.id, result: results[message.method] ?? {} });
        if (message.method === "turn/start") script({ emit, write, child });
      });
    },
  });
  const server = new CodexAppServer({
    userDataPath: dir,
    env: { PATH: process.env.PATH },
    resolveExecutable: async () => "/verified/codex",
    verifyRelease: async () => {},
    runFile: async () => ({ stdout: fixture.version }),
    spawnProcess: () => child,
    timeoutMs: 1000,
  });
  t.after(async () => {
    server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return server;
}

const delta = (text) => ({
  method: "item/agentMessage/delta",
  params: { threadId: "thread-1", turnId: "turn-1", delta: text },
});
const request = { model: fixture.models.data[0].id, messages: [{ role: "user", content: "raw" }] };

test("deltas split across stdout chunks, including inside a multibyte character, are reassembled", async (t) => {
  const server = await setup(t, ({ write, emit }) => {
    const line = Buffer.from(JSON.stringify(delta("Grüße 😀")) + "\n");
    // Split inside the two-byte "ü" and inside the four-byte emoji.
    const cuts = [line.indexOf("ü") + 1, line.indexOf("😀") + 2];
    write(line.subarray(0, cuts[0]));
    write(line.subarray(cuts[0], cuts[1]));
    write(line.subarray(cuts[1]));
    emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } },
    });
  });
  const seen = [];
  const text = await server.generate({ ...request, onText: (chunk) => seen.push(chunk) });
  assert.equal(text, "Grüße 😀");
  assert.deepEqual(seen, ["Grüße 😀"]);
});

test("a process that exits mid-turn rejects with a preserved-input error after streaming partial text", async (t) => {
  const server = await setup(t, ({ emit, child }) => {
    emit(delta("Partial "));
    setImmediate(() => child.emit("exit", 1));
  });
  const seen = [];
  await assert.rejects(server.generate({ ...request, onText: (chunk) => seen.push(chunk) }), {
    code: "CODEX_DISCONNECTED",
    message: /input has been preserved/,
  });
  assert.deepEqual(seen, ["Partial "]);
  assert.equal(server.turns.size, 0);
  assert.equal(server.pending.size, 0);
});

test("a malformed protocol line fails the turn as incompatible and stops the child", async (t) => {
  let killed = false;
  const server = await setup(t, ({ write, child }) => {
    child.kill = () => {
      killed = true;
    };
    write("{not json\n");
  });
  await assert.rejects(server.generate(request), { code: "CODEX_PROTOCOL" });
  assert.equal(killed, true);
  assert.equal(server.child, null);
});

test("a failed turn reports the provider error and leaves no turn state behind", async (t) => {
  const server = await setup(t, ({ emit }) => {
    emit(delta("Partial "));
    emit({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "failed", error: { message: "model overloaded" } },
      },
    });
  });
  await assert.rejects(server.generate(request), {
    code: "CODEX_INFERENCE",
    message: /overloaded/,
  });
  assert.equal(server.turns.size, 0);
});

test("an aborted signal removes its listener and interrupts the started turn", async (t) => {
  const server = await setup(t, () => {});
  const controller = new AbortController();
  const pending = server.generate({ ...request, signal: controller.signal });
  while (!server.turns.get("thread-1")?.turnId) await new Promise((r) => setImmediate(r));
  controller.abort();
  await assert.rejects(pending, { code: "ABORT_ERR" });
  assert.equal(server.turns.size, 0);
});
