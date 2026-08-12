// Single entry point for launch at login. Electron's setLoginItemSettings covers
// macOS and Windows; Linux is handled by an XDG autostart entry (linuxAutostart).
// Decisions live in autoStartPolicy so they can be tested without Electron.

const { app } = require("electron");
const linuxAutostart = require("./linuxAutostart");
const {
  getLoginItemArgs,
  resolveAutoStartState,
  needsHiddenFlagMigration,
  wasLaunchedHidden,
} = require("./autoStartPolicy");

const isLinux = () => process.platform === "linux";

function readLoginItemSettings() {
  return app.getLoginItemSettings({ args: getLoginItemArgs(process.platform) });
}

function writeLoginItem(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: getLoginItemArgs(process.platform),
  });
}

// { enabled, requiresApproval } — requiresApproval is macOS-only and means the
// item is registered but still waiting on the user in System Settings.
function getAutoStartState() {
  if (isLinux()) {
    return { enabled: linuxAutostart.isAutostartEnabled(), requiresApproval: false };
  }
  return resolveAutoStartState({
    platform: process.platform,
    loginItemSettings: readLoginItemSettings(),
  });
}

function setAutoStartEnabled(enabled) {
  if (isLinux()) {
    linuxAutostart.setAutostartEnabled(enabled);
    return;
  }
  writeLoginItem(enabled);
}

function wasLaunchedAtLoginHidden() {
  return wasLaunchedHidden({
    platform: process.platform,
    argv: process.argv,
    loginItemSettings: process.platform === "darwin" ? app.getLoginItemSettings() : null,
  });
}

// Repairs an entry that still exists but no longer starts this executable, or
// starts it without the flag that sends it to the tray. Returns true when
// something was rewritten, so the caller can log it.
function syncAutoStartEntry() {
  if (isLinux()) return linuxAutostart.syncAutostartEntry();

  if (
    !needsHiddenFlagMigration({
      platform: process.platform,
      loginItemSettings: readLoginItemSettings(),
    })
  ) {
    return false;
  }
  writeLoginItem(true);
  return true;
}

module.exports = {
  getAutoStartState,
  setAutoStartEnabled,
  wasLaunchedAtLoginHidden,
  syncAutoStartEntry,
};
