const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { requestFromRenderer } = require("../../src/helpers/rendererRequest.js");

function fakes() {
  const ipcMain = new EventEmitter();
  const sent = [];
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (channel, payload) => sent.push([channel, payload]),
  });
  return { ipcMain, webContents, sent };
}

test("the reply from the requested window, with the matching token, resolves the request", async () => {
  const { ipcMain, webContents, sent } = fakes();
  const p = requestFromRenderer({
    ipcMain,
    webContents,
    channel: "req",
    replyChannel: "rep",
    payload: { a: 1 },
    timeoutMs: 1000,
    fallback: "late",
  });
  const [, { token }] = sent[0];
  ipcMain.emit("rep", { sender: { id: 99 } }, token, "spoofed"); // another window
  ipcMain.emit("rep", { sender: webContents }, token + 1, "stale"); // another request
  ipcMain.emit("rep", { sender: webContents }, token, "ok");
  assert.equal(await p, "ok");
  assert.equal(ipcMain.listenerCount("rep"), 0);
});

test("a dead or silent renderer resolves to the fallback after the timeout", async () => {
  const { ipcMain, webContents } = fakes();
  assert.equal(
    await requestFromRenderer({
      ipcMain,
      webContents,
      channel: "req",
      replyChannel: "rep",
      timeoutMs: 10,
      fallback: "timeout",
    }),
    "timeout"
  );
  const destroyed = Object.assign(new EventEmitter(), { isDestroyed: () => true, send() {} });
  assert.equal(
    await requestFromRenderer({
      ipcMain,
      webContents: destroyed,
      channel: "req",
      replyChannel: "rep",
      timeoutMs: 1000,
      fallback: "gone",
    }),
    "gone"
  );
});

for (const [event, args] of [
  ["destroyed", []],
  ["render-process-gone", []],
  ["did-start-navigation", [{}, "app", false, true]],
  ["did-start-navigation", [{ isMainFrame: true, isSameDocument: false }]],
]) {
  test(`${event} disposes request, ignores late replies and removes every listener`, async () => {
    const { ipcMain, webContents, sent } = fakes();
    const p = requestFromRenderer({
      ipcMain,
      webContents,
      channel: "req",
      replyChannel: "rep",
      timeoutMs: 1000,
      fallback: "gone",
    });
    webContents.emit(event, ...args);
    ipcMain.emit("rep", { sender: webContents }, sent[0][1].token, "late");
    assert.equal(await p, "gone");
    assert.equal(ipcMain.listenerCount("rep"), 0);
    for (const name of ["destroyed", "render-process-gone", "did-start-navigation"])
      assert.equal(webContents.listenerCount(name), 0);
  });
}

test("subframe and same-document navigation preserve a pending request", async () => {
  const { ipcMain, webContents, sent } = fakes();
  const p = requestFromRenderer({
    ipcMain,
    webContents,
    channel: "req",
    replyChannel: "rep",
    timeoutMs: 1000,
    fallback: "gone",
  });
  webContents.emit("did-start-navigation", {}, "app", false, false);
  webContents.emit("did-start-navigation", {}, "app#hash", true, true);
  ipcMain.emit("rep", { sender: webContents }, sent[0][1].token, "ok");
  assert.equal(await p, "ok");
});

test("a throwing send resolves fallback and disposes all request watches", async () => {
  const { ipcMain, webContents } = fakes();
  webContents.send = () => {
    throw Error("renderer closed");
  };
  assert.equal(
    await requestFromRenderer({
      ipcMain,
      webContents,
      channel: "req",
      replyChannel: "rep",
      timeoutMs: 1000,
      fallback: "gone",
    }),
    "gone"
  );
  assert.equal(ipcMain.listenerCount("rep"), 0);
  assert.deepEqual(webContents.eventNames(), []);
});
