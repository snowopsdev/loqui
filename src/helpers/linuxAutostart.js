const fs = require("fs");
const path = require("path");
const os = require("os");

const DESKTOP_ENTRY_GROUP = "[Desktop Entry]";

function getAutostartDir() {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgConfigHome, "autostart");
}

function getDesktopFilePath() {
  return path.join(getAutostartDir(), "openwhispr.desktop");
}

function getIconInstallPath() {
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(xdgDataHome, "icons", "hicolor", "256x256", "apps", "openwhispr.png");
}

function isDevelopment() {
  return process.env.NODE_ENV === "development";
}

// electron.d.ts marks setLoginItemSettings' path override as win32-only; on Linux
// process.execPath is the ephemeral AppImage FUSE mount, so we resolve it ourselves.
function resolveExecutablePath() {
  return process.env.APPIMAGE || process.execPath;
}

function findBundledIconSource() {
  const candidates =
    isDevelopment() || !process.resourcesPath
      ? [path.join(__dirname, "..", "assets", "icon.png")]
      : [
          path.join(process.resourcesPath, "src", "assets", "icon.png"),
          path.join(process.resourcesPath, "assets", "icon.png"),
          path.join(process.resourcesPath, "app.asar.unpacked", "src", "assets", "icon.png"),
        ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function ensureIconInstalled() {
  const iconDest = getIconInstallPath();
  if (fs.existsSync(iconDest)) return iconDest;

  const iconSource = findBundledIconSource();
  if (!iconSource) return null;

  fs.mkdirSync(path.dirname(iconDest), { recursive: true });
  fs.copyFileSync(iconSource, iconDest);
  return iconDest;
}

// Reserved characters inside a quoted Exec argument have to be backslash-escaped
// per the Desktop Entry spec, so a home directory containing one still resolves.
function quoteExecPath(execPath) {
  return `"${execPath.replace(/(["`$\\])/g, "\\$1")}"`;
}

function buildDesktopFileContents(execPath, iconPath) {
  return [
    DESKTOP_ENTRY_GROUP,
    "Type=Application",
    "Name=OpenWhispr",
    "Comment=Voice dictation and AI agent",
    `Exec=${quoteExecPath(execPath)}`,
    iconPath ? `Icon=${iconPath}` : null,
    "Terminal=false",
    "Categories=Utility;",
    "X-GNOME-Autostart-enabled=true",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function parseDesktopEntry(contents) {
  const values = {};
  let inEntryGroup = false;

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inEntryGroup = line === DESKTOP_ENTRY_GROUP;
      continue;
    }
    if (!inEntryGroup) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  return values;
}

// A missing file and an unreadable one both mean "not autostarting", which is
// what the caller acts on; a failed write surfaces the real error instead.
function readDesktopEntry() {
  try {
    return parseDesktopEntry(fs.readFileSync(getDesktopFilePath(), "utf8"));
  } catch {
    return null;
  }
}

function readBoolean(value) {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

// GNOME Tweaks and KDE's autostart editor disable an entry by rewriting these
// keys in place rather than deleting the file, so existence alone is not enough.
function isAutostartEnabled() {
  const entry = readDesktopEntry();
  if (!entry) return false;
  if (readBoolean(entry.Hidden) === true) return false;
  return readBoolean(entry["X-GNOME-Autostart-enabled"]) !== false;
}

function writeAutostartEntry() {
  fs.mkdirSync(getAutostartDir(), { recursive: true });
  const contents = buildDesktopFileContents(resolveExecutablePath(), ensureIconInstalled());
  fs.writeFileSync(getDesktopFilePath(), contents, { mode: 0o644 });
}

function setAutostartEnabled(enabled) {
  if (!enabled) {
    fs.rmSync(getDesktopFilePath(), { force: true });
    return;
  }
  writeAutostartEntry();
}

// The recorded Exec path goes stale whenever the executable moves: an AppImage
// the user renames, or one an auto-update replaces with a new filename. The entry
// survives, so the toggle still reads as enabled while the session launches
// nothing. Skipped in development, where execPath is the local Electron binary.
function syncAutostartEntry() {
  if (isDevelopment()) return false;
  if (!isAutostartEnabled()) return false;

  const entry = readDesktopEntry();
  if (entry.Exec === quoteExecPath(resolveExecutablePath())) return false;

  writeAutostartEntry();
  return true;
}

module.exports = {
  getDesktopFilePath,
  resolveExecutablePath,
  buildDesktopFileContents,
  isAutostartEnabled,
  setAutostartEnabled,
  syncAutostartEntry,
};
