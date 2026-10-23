const { test } = require("node:test");
const assert = require("node:assert/strict");
const { trackUpdateActivity } = require("../../src/helpers/updateIPC");
test("restart lock blocks new recording/generation/download work but permits saves", async () => {
  const handlers = new Map();
  const ipc = { handle: (name, fn) => handlers.set(name, fn) };
  const activity = trackUpdateActivity(ipc);
  for (const name of [
    "acquire-recording-lock",
    "personal-inference:text-generate",
    "download-model",
    "update-note",
  ])
    ipc.handle(name, async () => true);
  activity.lock(true);
  for (const name of [
    "acquire-recording-lock",
    "personal-inference:text-generate",
    "download-model",
  ])
    await assert.rejects(handlers.get(name)({}), /preparing to restart/);
  assert.equal(await handlers.get("update-note")({}), true);
});
test("in-flight processing remains busy through completion", async () => {
  const handlers = new Map();
  let finish;
  const ipc = { handle: (name, fn) => handlers.set(name, fn) };
  const tracked = trackUpdateActivity(ipc);
  ipc.handle(
    "transcribe-audio",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const pending = handlers.get("transcribe-audio")({});
  assert.equal(tracked.busy(), true);
  finish();
  await pending;
  assert.equal(tracked.busy(), false);
});

test("actual update restart refuses sealed before scheduling native preparation and rechecks after teardown", async (t) => {
  const { EventEmitter } = require("node:events");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const gate = require("../../src/helpers/privacy/egressGate");
  const { attachUpdateIPC } = require("../../src/helpers/updateIPC");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-update-sealed-"));
  gate._resetForTests();
  let sealed = true;
  gate.configureEgress({ isSealed: () => sealed });
  t.after(() => {
    gate._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const handlers = new Map();
  const ipcMain = Object.assign(new EventEmitter(), {
    handle: (name, fn) => handlers.set(name, fn),
  });
  const calls = [];
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL() {},
    quitAndInstall() {
      calls.push("install");
    },
  });
  const window = {
    isDestroyed: () => false,
    webContents: {
      id: 1,
      getURL: () => "file:///app/index.html",
      send: (name, nonce) => {
        if (name === "loqui-update:prepare") {
          calls.push("prepare");
          ipcMain.emit("loqui-update:prepared", { sender: window.webContents }, nonce);
        }
      },
    },
  };
  const manager = attachUpdateIPC({
    app: { getPath: () => dir, getVersion: () => "1.0.0", isPackaged: false },
    ipcMain,
    BrowserWindow: { getAllWindows: () => [window] },
    updater,
    busy: () => false,
    activity: { lock: (value) => calls.push(`lock:${value}`) },
    teardown: async () => {
      calls.push("teardown");
      sealed = true;
    },
  });
  t.after(() => manager.dispose());
  manager.state.phase = "ready";
  await assert.rejects(
    handlers.get("loqui-update:restart")({ sender: window.webContents }),
    /NATIVE_BOUNDARY_UNAVAILABLE/
  );
  assert.deepEqual(calls, []);
  await assert.rejects(manager.restart(), /NATIVE_BOUNDARY_UNAVAILABLE/);
  assert.deepEqual(calls, []);
  sealed = false;
  await assert.rejects(
    handlers.get("loqui-update:restart")({ sender: window.webContents }),
    /NATIVE_BOUNDARY_UNAVAILABLE/
  );
  assert.deepEqual(calls, ["lock:true", "prepare", "teardown", "lock:false"]);
  assert.equal(calls.includes("install"), false);
});
