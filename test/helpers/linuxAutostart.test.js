const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const load = () => import("../../src/helpers/linuxAutostart.js");

// Assigning undefined to process.env coerces to the string "undefined", which
// would leak a bogus value into every later test in this file.
const MANAGED_ENV = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_DATA_DIRS", "APPIMAGE", "NODE_ENV"];

const ICON_THEME_SUBPATH = path.join("icons", "hicolor", "256x256", "apps", "open-whispr.png");

function setEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function withTmpXdgDirs(fn) {
  return async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-autostart-test-"));
    const saved = Object.fromEntries(MANAGED_ENV.map((name) => [name, process.env[name]]));
    MANAGED_ENV.forEach((name) => setEnv(name, undefined));
    process.env.XDG_CONFIG_HOME = path.join(root, "config");
    process.env.XDG_DATA_HOME = path.join(root, "data");
    process.env.XDG_DATA_DIRS = path.join(root, "system-data");
    try {
      await fn(root);
    } finally {
      MANAGED_ENV.forEach((name) => setEnv(name, saved[name]));
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function writeEntry(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

test(
  "prefers APPIMAGE over process.execPath, since execPath is the ephemeral mount",
  withTmpXdgDirs(async () => {
    const { resolveExecutablePath } = await load();

    process.env.APPIMAGE = "/home/user/Applications/OpenWhispr.AppImage";
    assert.equal(resolveExecutablePath(), "/home/user/Applications/OpenWhispr.AppImage");
  })
);

test(
  "falls back to process.execPath for deb/rpm/tar.gz installs (no APPIMAGE set)",
  withTmpXdgDirs(async () => {
    const { resolveExecutablePath } = await load();

    assert.equal(resolveExecutablePath(), process.execPath);
  })
);

test(
  "desktop file contents quote the exec path and reference the icon by theme name",
  withTmpXdgDirs(async () => {
    const { buildDesktopFileContents } = await load();

    const contents = buildDesktopFileContents("/a/b/OpenWhispr.AppImage", "open-whispr");
    assert.match(contents, /^Exec="\/a\/b\/OpenWhispr\.AppImage"$/m);
    assert.match(contents, /^Icon=open-whispr$/m);
    assert.match(contents, /^X-GNOME-Autostart-enabled=true$/m);
  })
);

test(
  "desktop file omits the Icon line rather than writing a broken reference",
  withTmpXdgDirs(async () => {
    const { buildDesktopFileContents } = await load();

    const contents = buildDesktopFileContents("/a/b/OpenWhispr.AppImage", null);
    assert.doesNotMatch(contents, /^Icon=/m);
  })
);

// The desktop-entry string rule unescapes the value before the quoting rule
// splits it into arguments, so a literal backslash has to survive both passes.
test(
  "exec paths containing reserved characters are escaped, not written raw",
  withTmpXdgDirs(async () => {
    const { buildDesktopFileContents } = await load();

    const contents = buildDesktopFileContents('/home/o"neill/$HOME/`app`\\v/OpenWhispr', null);
    assert.match(contents, /^Exec="\/home\/o\\"neill\/\\\$HOME\/\\`app\\`\\\\\\\\v\/OpenWhispr"$/m);
  })
);

test(
  "an icon the package already installed is referenced, not copied into the user theme",
  withTmpXdgDirs(async (root) => {
    const { setAutostartEnabled, getDesktopFilePath } = await load();

    writeEntry(path.join(root, "system-data", ICON_THEME_SUBPATH), "pretend png");

    setAutostartEnabled(true);
    assert.match(fs.readFileSync(getDesktopFilePath(), "utf8"), /^Icon=open-whispr$/m);
    assert.ok(!fs.existsSync(path.join(root, "data", ICON_THEME_SUBPATH)));
  })
);

test(
  "an unwritable icon directory still leaves launch at login enabled",
  withTmpXdgDirs(async (root) => {
    const { setAutostartEnabled, isAutostartEnabled, getDesktopFilePath } = await load();

    // A file where the icon tree has to go makes every mkdir below it fail with
    // ENOTDIR, standing in for a read-only or quota-exhausted home directory.
    fs.writeFileSync(path.join(root, "data"), "not a directory");

    assert.doesNotThrow(() => setAutostartEnabled(true));
    assert.equal(isAutostartEnabled(), true);
    assert.doesNotMatch(fs.readFileSync(getDesktopFilePath(), "utf8"), /^Icon=/m);
  })
);

test(
  "setAutostartEnabled(true) writes a desktop file, isAutostartEnabled reflects it, false removes it",
  withTmpXdgDirs(async () => {
    const { setAutostartEnabled, isAutostartEnabled, getDesktopFilePath } = await load();

    assert.equal(isAutostartEnabled(), false);

    setAutostartEnabled(true);
    assert.equal(isAutostartEnabled(), true);
    assert.ok(fs.existsSync(getDesktopFilePath()));

    setAutostartEnabled(false);
    assert.equal(isAutostartEnabled(), false);
    assert.ok(!fs.existsSync(getDesktopFilePath()));
  })
);

test(
  "setAutostartEnabled(false) on an already-disabled install is a no-op, not an error",
  withTmpXdgDirs(async () => {
    const { setAutostartEnabled, isAutostartEnabled } = await load();

    assert.doesNotThrow(() => setAutostartEnabled(false));
    assert.equal(isAutostartEnabled(), false);
  })
);

test(
  "an entry GNOME Tweaks disabled in place reads as disabled, not as enabled",
  withTmpXdgDirs(async () => {
    const { isAutostartEnabled, getDesktopFilePath } = await load();

    writeEntry(
      getDesktopFilePath(),
      "[Desktop Entry]\nType=Application\nName=OpenWhispr\nX-GNOME-Autostart-enabled=false\n"
    );
    assert.equal(isAutostartEnabled(), false);
  })
);

test(
  "an entry hidden by an autostart editor reads as disabled",
  withTmpXdgDirs(async () => {
    const { isAutostartEnabled, getDesktopFilePath } = await load();

    writeEntry(
      getDesktopFilePath(),
      "[Desktop Entry]\nType=Application\nName=OpenWhispr\nHidden=TRUE\n"
    );
    assert.equal(isAutostartEnabled(), false);
  })
);

test(
  "keys outside the [Desktop Entry] group do not affect the enabled state",
  withTmpXdgDirs(async () => {
    const { isAutostartEnabled, getDesktopFilePath } = await load();

    writeEntry(
      getDesktopFilePath(),
      "[Desktop Entry]\nType=Application\n\n[Desktop Action Other]\nHidden=true\n"
    );
    assert.equal(isAutostartEnabled(), true);
  })
);

test(
  "setAutostartEnabled(true) re-enables an entry that was disabled in place",
  withTmpXdgDirs(async () => {
    const { setAutostartEnabled, isAutostartEnabled, getDesktopFilePath } = await load();

    writeEntry(getDesktopFilePath(), "[Desktop Entry]\nType=Application\nHidden=true\n");
    assert.equal(isAutostartEnabled(), false);

    setAutostartEnabled(true);
    assert.equal(isAutostartEnabled(), true);
  })
);

test(
  "syncAutostartEntry re-points a stale Exec after the AppImage moves",
  withTmpXdgDirs(async () => {
    const { setAutostartEnabled, syncAutostartEntry, getDesktopFilePath } = await load();

    process.env.APPIMAGE = "/old/path/OpenWhispr.AppImage";
    setAutostartEnabled(true);

    process.env.APPIMAGE = "/new/path/OpenWhispr-1.9.0.AppImage";
    assert.equal(syncAutostartEntry(), true);

    const contents = fs.readFileSync(getDesktopFilePath(), "utf8");
    assert.match(contents, /^Exec="\/new\/path\/OpenWhispr-1\.9\.0\.AppImage"$/m);
  })
);

test(
  "syncAutostartEntry leaves an up-to-date entry untouched",
  withTmpXdgDirs(async () => {
    const { setAutostartEnabled, syncAutostartEntry, getDesktopFilePath } = await load();

    process.env.APPIMAGE = "/path/OpenWhispr.AppImage";
    setAutostartEnabled(true);
    const before = fs.statSync(getDesktopFilePath()).mtimeMs;

    assert.equal(syncAutostartEntry(), false);
    assert.equal(fs.statSync(getDesktopFilePath()).mtimeMs, before);
  })
);

test(
  "syncAutostartEntry never resurrects an entry the user disabled in place",
  withTmpXdgDirs(async () => {
    const { syncAutostartEntry, isAutostartEnabled, getDesktopFilePath } = await load();

    process.env.APPIMAGE = "/new/path/OpenWhispr.AppImage";
    writeEntry(
      getDesktopFilePath(),
      '[Desktop Entry]\nType=Application\nExec="/old/path/OpenWhispr.AppImage"\nX-GNOME-Autostart-enabled=false\n'
    );

    assert.equal(syncAutostartEntry(), false);
    assert.equal(isAutostartEnabled(), false);
    assert.match(fs.readFileSync(getDesktopFilePath(), "utf8"), /X-GNOME-Autostart-enabled=false/);
  })
);

test(
  "syncAutostartEntry is a no-op with no entry at all",
  withTmpXdgDirs(async () => {
    const { syncAutostartEntry, getDesktopFilePath } = await load();

    assert.equal(syncAutostartEntry(), false);
    assert.ok(!fs.existsSync(getDesktopFilePath()));
  })
);

test(
  "syncAutostartEntry skips development, where execPath is the local Electron binary",
  withTmpXdgDirs(async () => {
    const { setAutostartEnabled, syncAutostartEntry, getDesktopFilePath } = await load();

    process.env.APPIMAGE = "/installed/OpenWhispr.AppImage";
    setAutostartEnabled(true);

    process.env.NODE_ENV = "development";
    delete process.env.APPIMAGE;
    assert.equal(syncAutostartEntry(), false);

    const contents = fs.readFileSync(getDesktopFilePath(), "utf8");
    assert.match(contents, /^Exec="\/installed\/OpenWhispr\.AppImage"$/m);
  })
);
