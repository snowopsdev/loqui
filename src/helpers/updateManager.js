const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const product = require("../config/product.json");
const egress = require("./privacy/egressGate");
const { SealedModeError } = require("./privacy/egressPolicy");
const DAY = 24 * 60 * 60 * 1000;
// electron-updater's GitHub provider reads the feed from github.com and
// downloads through its redirects; the backstop records the actual hosts.
const UPDATE_TARGET = "https://github.com";
// An install or restart launches native programs; 07a has no boundary (A2).
const nativeRefusal = () => new Error("NATIVE_BOUNDARY_UNAVAILABLE");
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
    // Main passes its live seal state. The default is the gate's own
    // predicate, which fails closed until main configures it.
    sealed = () => egress.isSealed(),
    authorize = (meta) => egress.authorize(meta),
  }) {
    super();
    Object.assign(this, {
      updater,
      version,
      supported,
      packaged,
      busy,
      prepare,
      install,
      now,
      sealed,
      authorize,
    });
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
    updater.on("error", () => {
      // A request that sealing cancelled is a pause, not an update failure.
      if (this.isSealed()) return;
      this.publish({
        phase: "error",
        error:
          "Update check or download failed. Your current installation is unchanged. Retry when online.",
      });
    });
    updater.on("download-progress", (p) => {
      if (
        this.prefs.enabled &&
        this.downloadChannel === this.prefs.channel &&
        this.running &&
        !this.isSealed()
      )
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
  isSealed() {
    try {
      return this.sealed() === true;
    } catch {
      return true;
    }
  }
  status() {
    return {
      ...this.state,
      ...this.prefs,
      busy: !!this.busy(),
      supported: this.supported,
      sealed: this.isSealed(),
    };
  }
  publish(patch) {
    this.state = { ...this.state, error: undefined, ...patch };
    this.emit("status", this.status());
  }
  // Best effort: an unwritable profile (full disk, read-only folder) must not
  // wedge a check with running stuck true, reject the timer's promise, skip
  // start() after setup, or fail a preference change. The in-memory values stay
  // authoritative for this session (lastCheck still spaces out retries).
  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.prefs), { mode: 0o600 });
      fs.renameSync(this.file + ".tmp", this.file);
    } catch {
      // See above.
    }
  }
  preferences(patch) {
    if (this.restarting) throw Error("An update restart is already being prepared.");
    const enabling = patch?.enabled === true && !this.prefs.enabled;
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
    // A manual check found an update while automatic updates were off; now
    // that they are on, fetch it the same way a scheduled check would. While
    // sealed it stays "available" and resumeAfterSeal() fetches it (D13).
    if (enabling && this.state.phase === "available" && !this.isSealed()) this.fetchAvailable();
    return this.status();
  }
  fetchAvailable() {
    this.publish({ phase: "idle", availableVersion: undefined });
    // Best effort, like the scheduled check: failures are published as status.
    void this.check(true).catch(() => {});
  }
  completeSetup() {
    this.prefs.onboarded = true;
    this.save();
    this.start();
    return this.status();
  }
  start() {
    if (this.timer) return;
    // Scheduled checks never reject to the timer (a refusal is status too).
    this.timer = setInterval(() => void this.check(false).catch(() => {}), 60 * 60 * 1000);
    this.timer.unref?.();
    void this.check(false).catch(() => {});
  }
  async check(manual = true) {
    // A manual check is an explicit request, so it runs even with automatic
    // updates off. It then reports what is available and never downloads.
    if (
      !this.packaged ||
      !this.supported ||
      (!this.prefs.enabled && !manual) ||
      !this.prefs.onboarded ||
      this.running ||
      this.restarting ||
      this.state.phase === "ready"
    )
      return this.status();
    if (this.isSealed()) {
      // Sealed mode: a manual check is refused (and recorded); a scheduled
      // one is skipped without advancing lastCheck, so it runs once unsealed.
      if (manual) {
        const ticket = this.authorize({ task: "appUpdate", target: UPDATE_TARGET });
        // Main's seal state and the gate disagree: still refuse, record nothing new.
        ticket.discard();
        throw new SealedModeError({ task: "appUpdate", host: "github.com" });
      }
      return this.status();
    }
    const delay = this.failures ? Math.min(DAY, 60 * 60 * 1000 * 2 ** (this.failures - 1)) : DAY;
    if (!manual && this.now() - this.prefs.lastCheck < delay) return this.status();
    // One appUpdate operation spans the check and any download it starts.
    const ticket = this.authorize({ task: "appUpdate", target: UPDATE_TARGET, provider: "github" });
    // electron-updater sends these headers on every request of its own
    // session; the session backstop attributes them to this ticket and strips
    // the tag before they leave (Task 6).
    const previousHeaders = this.updater.requestHeaders;
    this.updater.requestHeaders = {
      ...(previousHeaders || {}),
      [egress.EGRESS_TAG_HEADER]: ticket.tag,
    };
    // The seal aborts this ticket (abortAllRemote). A download listens for
    // that itself, so it stops even if the pauseForSeal hook never runs (m6,
    // T10-M3). The feed request is already Chromium's and is waited out.
    const cancelOnAbort = () => this.cancel?.cancel();
    ticket.signal.addEventListener("abort", cancelOnAbort, { once: true });
    const sealedNow = () => this.isSealed() || ticket.signal.aborted;
    const pausedForSeal = () => {
      ticket.settle({ outcome: "cancelled", errorClass: "SEALED_MODE" });
      this.publish({ phase: "idle", availableVersion: undefined, progress: undefined });
      return this.status();
    };
    this.running = true;
    const channel = this.prefs.channel;
    this.prefs.lastCheck = this.now();
    this.save();
    this.publish({ phase: "checking" });
    try {
      const result = await this.updater.checkForUpdates();
      // Sealing while the feed was in flight: never start a download.
      if (sealedNow()) return pausedForSeal();
      if (channel !== this.prefs.channel) return this.status();
      const semver = require("semver");
      const next = result?.updateInfo?.version;
      if (
        next &&
        semver.gt(next, this.version) &&
        (channel === "beta" || !semver.prerelease(next))
      ) {
        if (!this.prefs.enabled) {
          this.publish({ phase: "available", availableVersion: next });
        } else {
          this.downloadChannel = channel;
          this.publish({ phase: "downloading", availableVersion: next });
          const { CancellationToken } = require("builder-util-runtime");
          this.cancel = new CancellationToken();
          if (ticket.signal.aborted) this.cancel.cancel();
          await this.updater.downloadUpdate(this.cancel);
        }
      } else this.publish({ phase: "idle" });
      this.failures = 0;
    } catch {
      // Sealing cancelled it: not a failure, and nothing to retry sooner.
      if (sealedNow()) return pausedForSeal();
      ticket.settle({ outcome: "error", errorClass: "UPDATE_FAILED" });
      this.failures++;
      if ((this.prefs.enabled || manual) && channel === this.prefs.channel)
        this.publish({
          phase: "error",
          error: "Unable to update. Retry when online; your current version is unchanged.",
        });
    } finally {
      // Idempotent: records only the paths above that did not settle it.
      ticket.signal.removeEventListener("abort", cancelOnAbort);
      ticket.settle({ outcome: "ok" });
      this.updater.requestHeaders = previousHeaders;
      this.cancel = null;
      this.running = false;
    }
    return this.status();
  }
  async restart() {
    if (this.restarting || this.state.phase !== "ready" || !this.prefs.enabled)
      throw Error("No verified update is ready.");
    if (this.busy()) throw Error("Finish recording, processing, or downloading before restarting.");
    // Installing relaunches native programs: refused while sealed (A2), also
    // when this manager is used without updateIPC's own restart checks.
    if (this.isSealed()) throw nativeRefusal();
    this.restarting = true;
    try {
      await this.prepare();
      if (this.busy())
        throw Error("Work started while preparing the update. Please try again after it finishes.");
      if (this.isSealed()) throw nativeRefusal();
      await this.install();
    } catch (error) {
      this.restarting = false;
      throw error;
    }
  }
  // Sealed mode transition hooks (Task 7 calls them through closure getters).
  // Both always publish, so the Updates panel can show the paused state (or
  // clear it) even when idle. "available" and "ready" are kept: they describe
  // what was found, not a running transfer.
  pauseForSeal() {
    this.cancel?.cancel();
    if (["checking", "downloading"].includes(this.state.phase))
      this.publish({ phase: "idle", availableVersion: undefined, progress: undefined });
    else this.emit("status", this.status());
  }
  resumeAfterSeal() {
    // Automatic updates were turned on while sealed with an update found (D13).
    if (this.prefs.enabled && this.state.phase === "available" && !this.isSealed())
      this.fetchAvailable();
    else this.emit("status", this.status());
  }
  dispose() {
    clearInterval(this.timer);
    this.cancel?.cancel();
  }
}
module.exports = { UpdateManager, DAY };
