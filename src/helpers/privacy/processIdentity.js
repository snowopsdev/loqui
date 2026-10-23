const fs = require("node:fs");
const gate = require("./egressGate");

// Owner decision D-3 (2026-10-23): a process identity is { pid, pgid, sid,
// startTime }, read the same way at spawn and before a group is signalled.
// - Linux: /proc/<pid>/stat (a file read, allowed while sealed). startTime is
//   field 22, clock ticks since boot; sid is the session id.
// - macOS: ps (a native launch, so refused while sealed: no proof, no signal).
//   startTime is lstart in milliseconds, one-second resolution; sid is not
//   available (ps "sess" is a kernel address), so it is null.
// - Windows: no process groups here; 07b owns the job/taskkill path.
// readIdentity returns null when no process has the pid. Anything else it
// cannot read throws, and the caller must treat that as "not proven".

// The fields after the command name, which may itself contain ") ".
function parseStat(text) {
  const close = String(text).lastIndexOf(")");
  if (close < 0) throw new Error("PROC_UNREADABLE");
  const open = String(text).indexOf("(");
  const pid = Number(String(text).slice(0, open).trim());
  const fields = String(text)
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  // fields[0] is field 3 (state): pgrp is field 5, session 6, starttime 22.
  const identity = {
    pid,
    pgid: Number(fields[2]),
    sid: Number(fields[3]),
    startTime: Number(fields[19]),
  };
  if (!Object.values(identity).every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new Error("PROC_UNREADABLE");
  return identity;
}
const gone = (error) => error?.code === "ENOENT" || error?.code === "ESRCH";
function linuxIdentity(pid) {
  try {
    return parseStat(fs.readFileSync(`/proc/${pid}/stat`, "latin1"));
  } catch (error) {
    if (gone(error)) return null;
    throw error;
  }
}
function linuxGroupMembers(pgid) {
  const members = [];
  for (const name of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const identity = linuxIdentity(Number(name)); // a process that just ended reads as null
    if (identity && identity.pgid === pgid) members.push(identity);
  }
  return members;
}

function psRows(args) {
  // The ps launch is itself a native launch (A2): never while sealed.
  if (gate.isSealed()) throw new Error("INSPECTION_REFUSED_SEALED");
  const cp = require("node:child_process");
  let output;
  try {
    output = cp.execFileSync("ps", args, {
      encoding: "utf8",
      timeout: 2000,
      env: { ...process.env, LC_ALL: "C" },
    });
  } catch (error) {
    if (error?.status === 1 && !String(error.stdout ?? "").trim()) return []; // no match
    throw error;
  }
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
      const startTime = match ? Date.parse(match[3]) : NaN;
      if (!match || !Number.isFinite(startTime)) throw new Error("PROC_UNREADABLE");
      return { pid: Number(match[1]), pgid: Number(match[2]), sid: null, startTime };
    });
}
const darwinIdentity = (pid) =>
  psRows(["-o", "pid=,pgid=,lstart=", "-p", String(pid)]).find((row) => row.pid === pid) ?? null;
const darwinGroupMembers = (pgid) =>
  psRows(["-A", "-o", "pid=,pgid=,lstart="]).filter((row) => row.pgid === pgid);

function unsupported() {
  throw new Error("PROC_UNSUPPORTED");
}
function forPlatform(platform = process.platform) {
  if (platform === "linux") return { readIdentity: linuxIdentity, groupMembers: linuxGroupMembers };
  if (platform === "darwin")
    return { readIdentity: darwinIdentity, groupMembers: darwinGroupMembers };
  return { readIdentity: unsupported, groupMembers: unsupported };
}

module.exports = { parseStat, forPlatform };
