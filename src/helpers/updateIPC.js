const crypto = require("node:crypto");
const { UpdateManager } = require("./updateManager");
function trackUpdateActivity(ipcMain) {
  const pending = new Set();
  const handle = ipcMain.handle.bind(ipcMain);
  let locked = false;
  ipcMain.handle = (channel, listener) =>
    handle(channel, async (event, ...args) => {
      const work =
        /(transcrib|download|import|text-generate|text-stream|model-test-load|recording-pipeline|acquire-recording|meeting.*start)/.test(
          channel
        ) && !/(get-|status|cancel|update:)/.test(channel);
      if (work && locked) throw Error("Loqui is preparing to restart. Please wait.");
      const token = {};
      if (work) pending.add(token);
      try {
        return await listener(event, ...args);
      } finally {
        pending.delete(token);
      }
    });
  return {
    busy: () => pending.size > 0,
    lock: (value) => {
      locked = value;
    },
  };
}
function attachUpdateIPC({ app, ipcMain, BrowserWindow, updater, busy, activity, teardown }) {
  const product = require("../config/product.json");
  const [owner, repo] = product.repository.split("/");
  const fs = require("node:fs");
  const path = require("node:path");
  const feed = path.join(app.getPath("userData"), "updates-feed.yml");
  fs.mkdirSync(path.dirname(feed), { recursive: true });
  fs.writeFileSync(
    feed,
    JSON.stringify({
      provider: "github",
      owner,
      repo,
      updaterCacheDirName: `${product.cacheName}-updater`,
    }),
    { mode: 0o600 }
  );
  updater.updateConfigPath = feed;
  updater.setFeedURL({ provider: "github", owner, repo });
  const waiters = new Map();
  const valid = (event) =>
    BrowserWindow.getAllWindows().some((w) => w.webContents === event.sender) &&
    /^(file:|http:\/\/localhost:)/.test(event.sender.getURL());
  const prepare = async () => {
    activity.lock(true);
    try {
      const windows = BrowserWindow.getAllWindows().filter(
        (w) => !w.isDestroyed() && /^(file:|http:\/\/localhost:)/.test(w.webContents.getURL())
      );
      await Promise.all(
        windows.map(
          (w) =>
            new Promise((resolve, reject) => {
              const nonce = crypto.randomUUID();
              const timer = setTimeout(() => {
                waiters.delete(nonce);
                reject(Error("A window did not finish saving. Please retry."));
              }, 10000);
              waiters.set(nonce, {
                id: w.webContents.id,
                finish: (error) => {
                  clearTimeout(timer);
                  waiters.delete(nonce);
                  error ? reject(Error("Could not save pending edits. Please retry.")) : resolve();
                },
              });
              w.webContents.send("loqui-update:prepare", nonce);
            })
        )
      );
    } catch (error) {
      activity.lock(false);
      throw error;
    }
  };
  const manager = new UpdateManager({
    updater,
    profile: app.getPath("userData"),
    version: app.getVersion(),
    packaged: app.isPackaged,
    supported:
      app.isPackaged &&
      (process.platform === "darwin" || (process.platform === "linux" && !!process.env.APPIMAGE)),
    busy,
    prepare,
    install: async () => {
      await teardown();
      updater.quitAndInstall();
    },
  });
  const handle = (name, fn) =>
    ipcMain.handle(`loqui-update:${name}`, (event, ...args) => {
      if (!valid(event)) throw Error("Unknown application window");
      return fn(...args);
    });
  handle("status", () => manager.status());
  handle("preferences", (p) => manager.preferences(p));
  handle("check", () => manager.check(true));
  handle("setup-complete", () => manager.completeSetup());
  handle("restart", async () => {
    try {
      return await manager.restart();
    } catch (error) {
      activity.lock(false);
      throw error;
    }
  });
  ipcMain.on("loqui-update:prepared", (event, nonce, error) => {
    const waiter = waiters.get(nonce);
    if (valid(event) && waiter?.id === event.sender.id) waiter.finish(error);
  });
  manager.on("status", (status) => {
    for (const w of BrowserWindow.getAllWindows())
      if (!w.isDestroyed()) w.webContents.send("loqui-update:status", status);
  });
  if (manager.prefs.onboarded) manager.start();
  return manager;
}
module.exports = { trackUpdateActivity, attachUpdateIPC };
