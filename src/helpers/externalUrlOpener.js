const { shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const debugLogger = require("./debugLogger");

// On Windows, shell.openExternal runs ShellExecuteExW inside the Electron main
// process, so a cold-started default browser (and any meeting client it
// protocol-launches) becomes a descendant of our PID. The system-audio helper
// captures with PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE rooted at
// that PID (windowsLoopbackAudioManager.js --exclude-pid), which would silence
// the meeting's audio. Handing http/https URLs to explorer.exe forwards the
// open to the long-running desktop shell via COM, so the browser is created
// outside our process tree. The protocol gate is load-bearing: explorer.exe
// EXECUTES non-URL arguments such as file paths. The absolute path is too:
// a bare "explorer.exe" resolves from the CWD first (binary planting).
// explorer.exe cannot deliver every URL: its command-line parser treats "="
// and "," as field separators, so query strings (?callbackURL=… — which broke
// every desktop OAuth sign-in, microsoft/WSL#3832), fragments (neovim#23401),
// and a bare "=" or "," in a path (rauschma/openurl#2) open a File Explorer
// window or an error dialog instead of the browser — silently, because the
// spawn itself succeeds. Those URLs go through shell.openExternal: losing the
// loopback exclusion for one open beats a link that never opens. Gate on the
// serialized href (the argv token explorer receives) — URL.search reports ""
// for a bare trailing "?". Serialization percent-encodes spaces, quotes and
// non-ASCII, so explorer always gets one ASCII token; "%" itself stays
// eligible because this shell-less spawn never expands %VAR%-style sequences.
const EXPLORER_BREAKING_CHARS = /[?#=,]/;

// shell.openExternal hands the URL to the OS protocol handler, so file:, smb:,
// custom app schemes and the like can launch programs or reach network shares.
// Callers pass values that originate outside the app (calendar invites,
// renderer window.open), so the scheme gate lives here and covers every path.
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
// OS settings panes main itself chooses from a fixed table (ipcHandlers.js).
// A separate entry point, so the web/mail allowlist above never widens.
const SYSTEM_SETTINGS_PROTOCOLS = new Set(["x-apple.systempreferences:", "ms-settings:"]);

// Installed by main.js. While sealed it asks the user, in a main-owned dialog,
// before a URL leaves for another app (Task 11). The OS browser, mail client
// and settings app are outside Loqui's process boundary: Sealed mode cannot
// meter or stop their traffic, so it asks instead of pretending to cover them.
// null means "always open". A guard that throws opens nothing.
let externalOpenGuard = null;
function setExternalOpenGuard(guard) {
  externalOpenGuard = typeof guard === "function" ? guard : null;
}
const allowedByGuard = async (url, context) =>
  !externalOpenGuard || (await externalOpenGuard(url, context)) === true;

// Resolves true when the URL was handed to the OS, false when the guard
// declined it (silently: a decline is not an error). Throws on a blocked scheme.
// `event` (an IPC event) parents the dialog to the asking window.
async function openExternalUrl(url, { event } = {}) {
  const { protocol, href } = new URL(url);
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(protocol)) {
    throw new Error(`Blocked URL scheme: ${protocol}`);
  }
  if (!(await allowedByGuard(href, { kind: "link", event }))) return false;
  if (
    process.platform === "win32" &&
    (protocol === "http:" || protocol === "https:") &&
    !EXPLORER_BREAKING_CHARS.test(href)
  ) {
    const explorerPath = path.win32.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe");
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(explorerPath, [href], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        child.once("error", reject);
        child.once("spawn", resolve);
        child.unref();
      });
      return true;
    } catch (error) {
      // No spawnable shell (relocated SystemRoot, LTSC/Server images, execution
      // policy, or Sealed mode's native-launch refusal). Degraded system-audio
      // capture beats a link that never opens, so fall through to the direct
      // open rather than failing the click.
      debugLogger.warn(
        "explorer.exe launch failed, opening URL in-process",
        { error: error.message },
        "window"
      );
    }
  }
  // The serialized URL the guard and its dialog saw, never the raw caller
  // string (T11-M2).
  await shell.openExternal(href);
  return true;
}

// Opens one of main's fixed OS-settings URLs. Same sealed confirmation as a
// link; resolves false when declined.
async function openSystemSettingsUrl(url, { event } = {}) {
  const { protocol } = new URL(url);
  if (!SYSTEM_SETTINGS_PROTOCOLS.has(protocol)) {
    throw new Error(`Blocked URL scheme: ${protocol}`);
  }
  if (!(await allowedByGuard(url, { kind: "systemSettings", event }))) return false;
  await shell.openExternal(url);
  return true;
}

// The renderer's open-external channel. One owner for its behaviour, so a
// test registers exactly what main registers.
function attachOpenExternal({ ipcMain }) {
  ipcMain.handle("open-external", async (event, url) => {
    try {
      const opened = await openExternalUrl(url, { event });
      return opened ? { success: true } : { success: false, declined: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  openExternalUrl,
  openSystemSettingsUrl,
  setExternalOpenGuard,
  attachOpenExternal,
};
