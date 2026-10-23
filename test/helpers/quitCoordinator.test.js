const assert = require("node:assert/strict");
const test = require("node:test");
const { createQuitCoordinator } = require("../../src/helpers/quitCoordinator.js");
const { deferred } = require("./harness/deferred");

function harness({ flush, updateExit = false } = {}) {
  const log = [];
  const onBeforeQuit = createQuitCoordinator({
    isUpdateExit: () => updateExit,
    flush: flush ? () => flush(log) : () => (log.push("flush"), Promise.resolve(true)),
    teardown: () => log.push("teardown"),
    shutdown: () => (log.push("shutdown"), Promise.resolve()),
    exit: (code) => log.push(`exit:${code}`),
  });
  const quit = () => {
    const event = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    onBeforeQuit(event);
    return event;
  };
  return { log, quit };
}
const settle = () => new Promise((r) => setImmediate(r));

test("quit flushes the dictation window, then tears down, then exits", async () => {
  const { log, quit } = harness();
  assert.equal(quit().prevented, true);
  await settle();
  assert.deepEqual(log, ["flush", "teardown", "shutdown", "exit:0"]);
});

test("a repeated quit during a slow flush is held, never let through (R1-I9)", async () => {
  const save = deferred();
  const { log, quit } = harness({ flush: (log) => (log.push("flush"), save.promise) });
  quit();
  const second = quit();
  assert.equal(second.prevented, true, "Electron's default quit would bypass the flush");
  await settle();
  assert.deepEqual(log, ["flush"], "nothing tears down while the save runs");
  save.resolve(true);
  await settle();
  assert.deepEqual(log, ["flush", "teardown", "shutdown", "exit:0"], "one shutdown, not two");
});

test("a flush that throws or a missing window manager still quits", async () => {
  const { log, quit } = harness({
    flush: () => {
      throw new Error("no window");
    },
  });
  quit();
  await settle();
  assert.deepEqual(log, ["teardown", "shutdown", "exit:0"]);
  const missing = harness({ flush: () => undefined });
  missing.quit();
  await settle();
  assert.deepEqual(missing.log, ["teardown", "shutdown", "exit:0"]);
});

test("the updater's own exit passes straight through", () => {
  const { log, quit } = harness({ updateExit: true });
  assert.equal(quit().prevented, false);
  assert.deepEqual(log, []);
});

test("teardown and shutdown failures still reach the single exit", async () => {
  const log = [];
  const quit = createQuitCoordinator({
    flush: () => {
      log.push("flush");
      return false;
    },
    teardown: () => {
      log.push("teardown");
      throw Error("fixture teardown");
    },
    shutdown: async () => {
      log.push("shutdown");
      throw Error("fixture shutdown");
    },
    exit: (code) => log.push(`exit:${code}`),
  });
  const event = { preventDefault() {} };
  quit(event);
  quit(event);
  await settle();
  assert.deepEqual(log, ["flush", "teardown", "shutdown", "exit:0"]);
});

test("a later updater flag cannot bypass a coordinated quit already flushing", async () => {
  let updateExit = false;
  const pending = deferred();
  const log = [];
  const quit = createQuitCoordinator({
    isUpdateExit: () => updateExit,
    flush: () => pending.promise,
    teardown: () => log.push("teardown"),
    shutdown: async () => log.push("shutdown"),
    exit: (code) => log.push(`exit:${code}`),
  });
  const event = () => ({
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  });
  quit(event());
  updateExit = true;
  const repeated = event();
  quit(repeated);
  assert.equal(repeated.prevented, true);
  pending.resolve(true);
  await settle();
  assert.deepEqual(log, ["teardown", "shutdown", "exit:0"]);
});
