// Settings deep links (I12). Main holds one pending request until the
// control panel's subscriber acknowledges it. A panel that is still loading,
// or reloading, asks for it when its subscriber mounts, so a request is never
// sent into a page with no listener and forgotten. A request nobody
// acknowledges expires, so a stale link never opens Settings much later.
const SETTINGS_LINK_TTL_MS = 15_000;
// Plan 03's grammar, mirrored from src/utils/settingsDeepLink.ts.
const SETTINGS_PATH = /^[A-Za-z]+(?:\/[A-Za-z]+)?$/;

function createSettingsLinkQueue({
  ttlMs = SETTINGS_LINK_TTL_MS,
  timers = { setTimeout, clearTimeout },
} = {}) {
  let seq = 0;
  let pending = null;
  const settle = (result) => {
    if (!pending) return;
    const current = pending;
    pending = null;
    timers.clearTimeout(current.timer);
    current.resolve(result);
  };
  return {
    enqueue(settingsPath) {
      settle({ delivered: false, reason: "replaced" });
      const link = {
        id: `settings-link-${++seq}`,
        path:
          typeof settingsPath === "string" && SETTINGS_PATH.test(settingsPath)
            ? settingsPath
            : null,
      };
      let resolve;
      const done = new Promise((r) => (resolve = r));
      const timer = timers.setTimeout(() => {
        if (pending?.link.id === link.id) settle({ delivered: false, reason: "timeout" });
      }, ttlMs);
      timer?.unref?.(); // never keeps the app from quitting
      pending = { link, resolve, timer };
      return { link, done };
    },
    peek() {
      return pending ? { ...pending.link } : null;
    },
    ack(id) {
      if (!pending || pending.link.id !== id) return false;
      settle({ delivered: true });
      return true;
    },
  };
}

function registerSettingsLinkIpc(ipcMain, windowManager) {
  // Only the control panel may read or acknowledge the pending request.
  const fromControlPanel = (event) => {
    const panel = windowManager.controlPanelWindow;
    return Boolean(panel && !panel.isDestroyed() && event?.sender === panel.webContents);
  };
  ipcMain.handle("open-settings-at", (_event, settingsPath) =>
    windowManager.openSettings(settingsPath)
  );
  ipcMain.handle("settings-link-pending", (event) =>
    fromControlPanel(event) ? windowManager.settingsLinks.peek() : null
  );
  ipcMain.handle("settings-link-ack", (event, id) =>
    fromControlPanel(event) && typeof id === "string" ? windowManager.settingsLinks.ack(id) : false
  );
}

module.exports = { SETTINGS_LINK_TTL_MS, createSettingsLinkQueue, registerSettingsLinkIpc };
