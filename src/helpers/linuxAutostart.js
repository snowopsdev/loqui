const fs = require("fs");
const path = require("path");
const os = require("os");

const DESKTOP_ENTRY_GROUP = "[Desktop Entry]";

// electron-builder names the packaged desktop entry and icon after the Linux
// executable, which main.js also passes to app.setDesktopName(). Reusing it here
// keeps our entry and the packaged one referring to the same icon.
const LINUX_APP_NAME = "open-whispr";
const ICON_THEME_SUBPATH = path.join(
  "icons",
  "hicolor",
  "256x256",
  "apps",
  `${LINUX_APP_NAME}.png`
);

function getAutostartDir() {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgConfigHome, "autostart");
}

function getDesktopFilePath() {
  return path.join(getAutostartDir(), `${LINUX_APP_NAME}.desktop`);
}

// Icon= is resolved against the theme search path, so deb/rpm installs already
// have one and only unpackaged layouts (AppImage, tar.gz) need a copy. The user
// directory comes first because that is the only one we may write to.
function getIconThemePaths() {
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  const systemDataDirs = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share")
    .split(":")
    .filter(Boolean);
  return [xdgDataHome, ...systemDataDirs].map((dir) => path.join(dir, ICON_THEME_SUBPATH));
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

// The icon is decoration; an unwritable data directory must not stop the entry
// itself from being written, which is the only thing the toggle promises.
function ensureIconInstalled() {
  try {
    const [userIconPath, ...systemIconPaths] = getIconThemePaths();
    if (fs.existsSync(userIconPath)) return true;
    if (systemIconPaths.some((iconPath) => fs.existsSync(iconPath))) return true;

    const iconSource = findBundledIconSource();
    if (!iconSource) return false;

    fs.mkdirSync(path.dirname(userIconPath), { recursive: true });
    fs.copyFileSync(iconSource, userIconPath);
    return true;
  } catch {
    return false;
  }
}

// Exec goes through two unescaping passes: the desktop-entry string rule runs
// first, then the argument-quoting rule. Reserved characters need a single
// backslash for the quoting rule, but a literal backslash needs four, since the
// string rule collapses each pair into one before quoting is applied.
function quoteExecPath(execPath) {
  const escaped = execPath.replace(/\\/g, "\\\\\\\\").replace(/(["`$])/g, "\\$1");
  return `"${escaped}"`;
}

function buildDesktopFileContents(execPath, iconName) {
  return [
    DESKTOP_ENTRY_GROUP,
    "Type=Application",
    "Name=OpenWhispr",
    "Comment=Voice dictation and AI agent",
    `Exec=${quoteExecPath(execPath)}`,
    iconName ? `Icon=${iconName}` : null,
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
function isEntryEnabled(entry) {
  if (!entry) return false;
  if (readBoolean(entry.Hidden) === true) return false;
  return readBoolean(entry["X-GNOME-Autostart-enabled"]) !== false;
}

function isAutostartEnabled() {
  return isEntryEnabled(readDesktopEntry());
}

function writeAutostartEntry() {
  fs.mkdirSync(getAutostartDir(), { recursive: true });
  const iconName = ensureIconInstalled() ? LINUX_APP_NAME : null;
  fs.writeFileSync(
    getDesktopFilePath(),
    buildDesktopFileContents(resolveExecutablePath(), iconName),
    { mode: 0o644 }
  );
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

  const entry = readDesktopEntry();
  if (!isEntryEnabled(entry)) return false;
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
