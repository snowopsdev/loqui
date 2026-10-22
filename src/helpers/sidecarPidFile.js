const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const SUBDIR = "sidecar-pids";
// If an unresolved record cannot be copied, keep its original from being
// overwritten/cleared by a manager. The registry still owns current children.
const unpreserved = new Set();
function pidDir() {
  return path.join(app.getPath("userData"), SUBDIR);
}
function pidPath(name) {
  return path.join(pidDir(), `${name}.pid`);
}
function write(name, pid) {
  if (!Number.isInteger(pid) || pid <= 0 || unpreserved.has(pidPath(name))) return;
  try {
    fs.mkdirSync(pidDir(), { recursive: true });
    fs.writeFileSync(pidPath(name), String(pid), "utf-8");
  } catch {} // Best effort; current children also belong to the registry.
}
function clear(name) {
  if (unpreserved.has(pidPath(name))) return;
  try {
    fs.unlinkSync(pidPath(name));
  } catch {} // Already gone.
}
function preserve(name, pid) {
  const original = pidPath(name);
  unpreserved.add(original);
  try {
    const dir = path.join(pidDir(), "unresolved");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.${pid}.pid`), String(pid), {
      encoding: "utf8",
      flag: "wx",
    });
    unpreserved.delete(original);
    return true;
  } catch (error) {
    // An earlier intact copy is sufficient; never erase/replace it here.
    if (error.code === "EEXIST") {
      try {
        if (
          fs
            .readFileSync(path.join(pidDir(), "unresolved", `${name}.${pid}.pid`), "utf8")
            .trim() === String(pid)
        ) {
          unpreserved.delete(original);
          return true;
        }
      } catch {}
    }
    return false;
  }
}
function readRecords(dir, preserved = false) {
  const unresolved = [],
    entries = [];
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (error) {
    if (error.code !== "ENOENT")
      unresolved.push({
        kind: "sidecar-pid-registry",
        pid: null,
        reason: "PID_REGISTRY_UNREADABLE",
        rootExited: false,
        source: "sidecar-pid-file",
      });
    return { entries, unresolved };
  }
  for (const file of files) {
    if (!file.endsWith(".pid")) continue;
    const match = preserved ? file.match(/^(.*)\.([1-9][0-9]*)\.pid$/) : null;
    const name = preserved && match ? match[1] : path.basename(file, ".pid");
    const full = path.join(dir, file);
    try {
      const pid = Number(fs.readFileSync(full, "utf8").trim());
      if (
        !Number.isSafeInteger(pid) ||
        pid <= 0 ||
        (preserved && (!match || pid !== Number(match[2])))
      ) {
        unpreserved.add(full);
        unresolved.push({
          kind: name,
          pid: null,
          reason: "PID_RECORD_INVALID",
          rootExited: false,
          source: "sidecar-pid-file",
        });
        continue;
      }
      entries.push({ name, pid });
    } catch {
      unpreserved.add(full);
      unresolved.push({
        kind: name,
        pid: null,
        reason: "PID_RECORD_UNREADABLE",
        rootExited: false,
        source: "sidecar-pid-file",
      });
    }
  }
  return { entries, unresolved };
}
function readForReaping() {
  const current = readRecords(pidDir());
  const preserved = readRecords(path.join(pidDir(), "unresolved"), true);
  const unique = new Map(
    [...current.entries, ...preserved.entries].map((e) => [`${e.name}:${e.pid}`, e])
  );
  return {
    entries: [...unique.values()],
    unresolved: [...current.unresolved, ...preserved.unresolved],
  };
}
// Compatibility reader describes current manager records. Startup also reads
// durable unresolved copies, which manager write/clear deliberately cannot touch.
function readAll() {
  return readRecords(pidDir()).entries;
}
module.exports = { write, clear, readAll, readForReaping, preserve };
