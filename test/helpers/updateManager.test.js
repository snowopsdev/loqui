const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { UpdateManager, DAY } = require("../../src/helpers/updateManager");
function setup(t, options = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-updates-"));
  const updater = new EventEmitter();
  let checks = 0,
    downloads = 0,
    installs = 0;
  updater.checkForUpdates = async () => {
    checks++;
    return { updateInfo: { version: options.next || "0.1.0-beta.2" } };
  };
  updater.downloadUpdate = async () => {
    downloads++;
    updater.emit("update-downloaded", { version: options.next || "0.1.0-beta.2" });
  };
  updater.quitAndInstall = () => installs++;
  const manager = new UpdateManager({
    profile,
    updater,
    version: "0.1.0-beta.1",
    supported: true,
    packaged: true,
    now: () => DAY * 2,
    ...options,
  });
  manager.prefs.onboarded = true;
  t.after(() => {
    manager.dispose();
    fs.rmSync(profile, { recursive: true, force: true });
  });
  return { manager, updater, counts: () => ({ checks, downloads, installs }) };
}
test("downloads a newer beta but installs only on explicit restart", async (t) => {
  const { manager, updater, counts } = setup(t);
  await manager.check();
  assert.equal(manager.status().phase, "ready");
  assert.equal(counts().installs, 0);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  await manager.restart();
  assert.equal(counts().installs, 1);
});
test("stable selection excludes beta and downgrades", async (t) => {
  const { manager, counts } = setup(t);
  manager.preferences({ channel: "stable" });
  await manager.check();
  assert.equal(counts().downloads, 0);
  const old = setup(t, { next: "0.1.0-beta.0" });
  await old.manager.check();
  assert.equal(old.counts().downloads, 0);
});
test("beta can advance to stable", async (t) => {
  const { manager } = setup(t, { next: "0.1.0" });
  await manager.check();
  assert.equal(manager.status().phase, "ready");
});
test("disabled, incomplete onboarding and unsupported installations never check", async (t) => {
  for (const options of [{ supported: false }, { packaged: false }]) {
    const s = setup(t, options);
    await s.manager.check();
    assert.equal(s.counts().checks, 0);
  }
  const s = setup(t);
  s.manager.prefs.onboarded = false;
  await s.manager.check();
  s.manager.prefs.onboarded = true;
  s.manager.preferences({ enabled: false });
  await s.manager.check();
  assert.equal(s.counts().checks, 0);
});
test("active work prevents restart and pending saves must succeed", async (t) => {
  let busy = true,
    saves = 0;
  const s = setup(t, {
    busy: () => busy,
    prepare: async () => {
      saves++;
      throw Error("save failed");
    },
  });
  await s.manager.check();
  await assert.rejects(s.manager.restart(), /Finish recording/);
  assert.equal(saves, 0);
  busy = false;
  await assert.rejects(s.manager.restart(), /save failed/);
  assert.equal(s.counts().installs, 0);
  assert.equal(s.manager.restarting, false);
});
test("work beginning during flush prevents installation", async (t) => {
  let busy = false;
  const s = setup(t, {
    busy: () => busy,
    prepare: async () => {
      busy = true;
    },
  });
  await s.manager.check();
  await assert.rejects(s.manager.restart(), /Work started/);
  assert.equal(s.counts().installs, 0);
});
test("channel change invalidates downloaded updates and late events", async (t) => {
  const s = setup(t);
  await s.manager.check();
  s.manager.preferences({ channel: "stable" });
  s.updater.emit("update-downloaded", { version: "0.1.0-beta.2" });
  assert.equal(s.manager.status().phase, "idle");
  await assert.rejects(s.manager.restart(), /No verified/);
});
test("offline errors are nonblocking and scheduled retries are bounded", async (t) => {
  let calls = 0;
  const s = setup(t);
  s.updater.checkForUpdates = async () => {
    calls++;
    throw Error("offline");
  };
  await s.manager.check(false);
  assert.equal(s.manager.status().phase, "error");
  await s.manager.check(false);
  assert.equal(calls, 1);
});
test("integrity failures never offer restart", async (t) => {
  const s = setup(t);
  s.updater.downloadUpdate = async () => {
    throw Error("checksum mismatch");
  };
  await s.manager.check();
  assert.equal(s.manager.status().phase, "error");
  await assert.rejects(s.manager.restart());
  assert.equal(s.counts().installs, 0);
});
test("disabling during download cancels and ignores completion", async (t) => {
  const s = setup(t);
  s.updater.downloadUpdate = async (token) => {
    s.manager.preferences({ enabled: false });
    assert.equal(token.cancelled, true);
    s.updater.emit("update-downloaded", { version: "0.1.0-beta.2" });
  };
  await s.manager.check();
  assert.equal(s.manager.status().phase, "idle");
});
test("a profile that cannot be written does not wedge the updater", async (t) => {
  const s = setup(t);
  const blocker = path.join(path.dirname(s.manager.file), "not-a-directory");
  fs.writeFileSync(blocker, "");
  s.manager.file = path.join(blocker, "updates.json");
  await s.manager.check(false);
  assert.equal(s.manager.running, false, "a failed preference write left the check marked running");
  assert.equal(s.manager.status().phase, "ready", "the update check still ran");
  assert.equal(s.counts().checks, 1);
});
test("scheduled retries back off hourly, double per failure, cap at a day, and reset after success", async (t) => {
  const HOUR = DAY / 24;
  let clock = DAY * 10;
  let fail = true;
  const s = setup(t);
  s.manager.now = () => clock;
  s.updater.checkForUpdates = async () => {
    if (fail) throw Error("offline");
    return { updateInfo: { version: "0.1.0-beta.1" } };
  };
  const attempted = async () => {
    const before = s.manager.prefs.lastCheck;
    await s.manager.check(false);
    return s.manager.prefs.lastCheck !== before;
  };
  assert.equal(await attempted(), true);
  // Waits after failures 1..6: 1h, 2h, 4h, 8h, 16h, then the 24h cap.
  for (const wait of [1, 2, 4, 8, 16, 24, 24]) {
    clock += wait * HOUR - 1;
    assert.equal(await attempted(), false, `retry ${wait}h early`);
    clock += 1;
    assert.equal(await attempted(), true, `retry after ${wait}h`);
  }
  fail = false;
  clock += DAY;
  assert.equal(await attempted(), true);
  assert.equal(s.manager.failures, 0);
  clock += DAY - 1;
  assert.equal(await attempted(), false, "a healthy schedule checks daily");
});
test("a downloaded update is not re-checked and the off switch also blocks manual checks", async (t) => {
  const s = setup(t);
  s.manager.now = () => DAY * 10;
  await s.manager.check(false);
  await s.manager.check(true);
  assert.equal(s.counts().checks, 1, "ready update blocks re-check");
  const off = setup(t);
  off.manager.preferences({ enabled: false });
  await off.manager.check(true);
  assert.equal(off.counts().checks, 0);
});
test("an unwritable profile does not stop setup completion from starting the checks or block preferences", async (t) => {
  const s = setup(t);
  s.manager.prefs.onboarded = false;
  const blocker = path.join(path.dirname(s.manager.file), "not-a-directory");
  fs.writeFileSync(blocker, "");
  s.manager.file = path.join(blocker, "updates.json");
  s.manager.completeSetup();
  assert.equal(s.manager.prefs.onboarded, true);
  assert.ok(s.manager.timer, "the hourly check was not started");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.counts().checks, 1);
  const status = s.manager.preferences({ enabled: false, channel: "stable" });
  assert.equal(status.enabled, false);
  assert.equal(status.channel, "stable");
});
