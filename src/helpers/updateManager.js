const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const product = require("../config/product.json");
const DAY = 24 * 60 * 60 * 1000;
class UpdateManager extends EventEmitter {
  constructor({
    updater,
    profile,
    version,
    supported,
    packaged,
    busy = () => false,
    prepare = async () => {},
    install = () => updater.quitAndInstall(),
    now = Date.now,
  }) {
    super();
    Object.assign(this, { updater, version, supported, packaged, busy, prepare, install, now });
    this.file = path.join(profile, "updates.json");
    this.prefs = {
      enabled: true,
      channel: version.includes("-") ? "beta" : "stable",
      lastCheck: 0,
      onboarded: false,
    };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      for (const k of ["enabled", "onboarded"])
        if (typeof saved[k] === "boolean") this.prefs[k] = saved[k];
      if (["beta", "stable"].includes(saved.channel)) this.prefs.channel = saved.channel;
      if (Number.isFinite(saved.lastCheck)) this.prefs.lastCheck = saved.lastCheck;
    } catch {}
    this.state = {
      phase: supported ? "idle" : "manual",
      version,
      releasesUrl: product.releasesUrl,
    };
    this.running = false;
    this.restarting = false;
    this.failures = 0;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    this.configureChannel();
    updater.on("error", () =>
      this.publish({
        phase: "error",
        error:
          "Update check or download failed. Your current installation is unchanged. Retry when online.",
      })
    );
    updater.on("download-progress", (p) => {
      if (this.prefs.enabled && this.downloadChannel === this.prefs.channel && this.running)
        this.publish({ phase: "downloading", progress: p.percent });
    });
    updater.on("update-downloaded", (info) => {
      if (
        this.prefs.enabled &&
        this.downloadChannel === this.prefs.channel &&
        info.version === this.state.availableVersion &&
        this.state.phase === "downloading"
      )
        this.publish({ phase: "ready", availableVersion: info.version, progress: 100 });
    });
  }
  configureChannel() {
    this.updater.channel = this.prefs.channel === "beta" ? "beta" : "latest";
    this.updater.allowPrerelease = this.prefs.channel === "beta";
    this.updater.allowDowngrade = false;
  }
  status() {
    return { ...this.state, ...this.prefs, busy: !!this.busy(), supported: this.supported };
  }
  publish(patch) {
    this.state = { ...this.state, error: undefined, ...patch };
    this.emit("status", this.status());
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.prefs), { mode: 0o600 });
    fs.renameSync(this.file + ".tmp", this.file);
  }
  preferences(patch) {
    if (this.restarting) throw Error("An update restart is already being prepared.");
    if (typeof patch?.enabled === "boolean") this.prefs.enabled = patch.enabled;
    if (patch?.channel !== undefined && !["stable", "beta"].includes(patch.channel))
      throw Error("Unknown update channel");
    const changed = patch?.channel && patch.channel !== this.prefs.channel;
    if (patch?.channel) this.prefs.channel = patch.channel;
    if (!this.prefs.enabled || changed) {
      this.downloadChannel = null;
      this.cancel?.cancel();
      this.publish({
        phase: this.supported ? "idle" : "manual",
        availableVersion: undefined,
        progress: undefined,
      });
    }
    this.configureChannel();
    this.save();
    return this.status();
  }
  completeSetup() {
    this.prefs.onboarded = true;
    this.save();
    this.start();
    return this.status();
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(false), 60 * 60 * 1000);
    this.timer.unref?.();
    void this.check(false);
  }
  async check(manual = true) {
    if (
      !this.packaged ||
      !this.supported ||
      !this.prefs.enabled ||
      !this.prefs.onboarded ||
      this.running ||
      this.restarting ||
      this.state.phase === "ready"
    )
      return this.status();
    const delay = this.failures ? Math.min(DAY, 60 * 60 * 1000 * 2 ** (this.failures - 1)) : DAY;
    if (!manual && this.now() - this.prefs.lastCheck < delay) return this.status();
    this.running = true;
    const channel = this.prefs.channel;
    this.prefs.lastCheck = this.now();
    this.save();
    this.publish({ phase: "checking" });
    try {
      const result = await this.updater.checkForUpdates();
      if (!this.prefs.enabled || channel !== this.prefs.channel) return this.status();
      const semver = require("semver");
      const next = result?.updateInfo?.version;
      if (
        next &&
        semver.gt(next, this.version) &&
        (channel === "beta" || !semver.prerelease(next))
      ) {
        this.downloadChannel = channel;
        this.publish({ phase: "downloading", availableVersion: next });
        const { CancellationToken } = require("builder-util-runtime");
        this.cancel = new CancellationToken();
        await this.updater.downloadUpdate(this.cancel);
      } else this.publish({ phase: "idle" });
      this.failures = 0;
    } catch {
      this.failures++;
      if (this.prefs.enabled && channel === this.prefs.channel)
        this.publish({
          phase: "error",
          error: "Unable to update. Retry when online; your current version is unchanged.",
        });
    } finally {
      this.cancel = null;
      this.running = false;
    }
    return this.status();
  }
  async restart() {
    if (this.restarting || this.state.phase !== "ready" || !this.prefs.enabled)
      throw Error("No verified update is ready.");
    if (this.busy()) throw Error("Finish recording, processing, or downloading before restarting.");
    this.restarting = true;
    try {
      await this.prepare();
      if (this.busy())
        throw Error("Work started while preparing the update. Please try again after it finishes.");
      await this.install();
    } catch (error) {
      this.restarting = false;
      throw error;
    }
  }
  dispose() {
    clearInterval(this.timer);
    this.cancel?.cancel();
  }
}
module.exports = { UpdateManager, DAY };
