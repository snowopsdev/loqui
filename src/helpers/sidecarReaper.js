const childProcess = require("node:child_process");
const gate = require("./privacy/egressGate");
const registry = require("./privacy/childRegistry");
const debugLogger = require("./debugLogger");
const sidecarPidFile = require("./sidecarPidFile");

const EXPECTED_BINARY_FRAGMENTS = {
  parakeet: ["sherpa-onnx-ws-", "sherpa-onnx-online-ws-"],
  whisper: ["whisper-server"],
  llama: ["llama-server"],
  qdrant: ["qdrant"],
  diarization: ["sherpa-onnx-diarize"],
};

// A wedged sidecar can ignore SIGTERM entirely (observed with qdrant spinning
// at full CPU), so reaping must verify death and escalate rather than
// fire-and-forget.
const SIGTERM_GRACE_MS = 5000;
const SIGKILL_GRACE_MS = 1000;
const EXIT_POLL_INTERVAL_MS = 200;

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

function processCommand(pid) {
  if (gate.isSealed()) return { status: "refused-sealed" };
  try {
    if (process.platform === "win32") {
      const out = childProcess
        .execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          timeout: 2000,
        })
        .toString();
      const match = out.match(/^"([^"]+)"/);
      return match ? { status: "inspected", command: match[1] } : { status: "unavailable" };
    }
    const command = childProcess
      .execFileSync("ps", ["-p", String(pid), "-o", "command="], {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
      })
      .toString()
      .trim();
    return command ? { status: "inspected", command } : { status: "unavailable" };
  } catch (error) {
    return { status: error.code === "SEALED_MODE" ? "refused-sealed" : "failed" };
  }
}

function signalProcess(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {
    // Already dead.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid)) {
    if (Date.now() >= deadline) return false;
    await sleep(EXIT_POLL_INTERVAL_MS);
  }
  return true;
}

async function killStaleSidecar(name, pid, { sigtermGraceMs, sigkillGraceMs }) {
  debugLogger.warn("Reaping stale sidecar", { name, pid });
  signalProcess(pid, "SIGTERM");
  if (await waitForExit(pid, sigtermGraceMs)) return true;

  debugLogger.warn("Stale sidecar ignored SIGTERM, escalating to SIGKILL", { name, pid });
  signalProcess(pid, "SIGKILL");
  if (await waitForExit(pid, sigkillGraceMs)) return true;

  debugLogger.error("Stale sidecar survived SIGKILL, keeping PID entry for next launch", {
    name,
    pid,
  });
  return false;
}

async function reapStaleSidecars({
  sigtermGraceMs = SIGTERM_GRACE_MS,
  sigkillGraceMs = SIGKILL_GRACE_MS,
} = {}) {
  const { entries, unresolved: unreadable } = sidecarPidFile.readForReaping();
  const unresolved = unreadable.map((entry) => registry.recordUnresolved(entry));
  for (const { name, pid } of entries) {
    if (!sidecarPidFile.preserve(name, pid))
      unresolved.push(
        registry.recordUnresolved({
          kind: name,
          pid,
          reason: "PID_RECORD_PRESERVATION_FAILED",
          source: "sidecar-pid-file-preservation",
        })
      );
    let rootExited = !isProcessAlive(pid);
    let reason = rootExited ? "ROOT_EXITED_DESCENDANTS_UNKNOWN" : "INSPECTION_UNAVAILABLE";
    if (!rootExited) {
      const inspection = processCommand(pid);
      if (inspection.status === "refused-sealed") reason = "INSPECTION_REFUSED_SEALED";
      else if (inspection.status === "failed") reason = "INSPECTION_FAILED";
      else if (inspection.status === "inspected") {
        const fragments = EXPECTED_BINARY_FRAGMENTS[name];
        if (fragments && fragments.some((fragment) => inspection.command.includes(fragment))) {
          rootExited = await killStaleSidecar(name, pid, { sigtermGraceMs, sigkillGraceMs });
          reason = rootExited ? "ROOT_EXITED_DESCENDANTS_UNKNOWN" : "ROOT_STOP_FAILED";
        } else reason = "PID_REUSED_DESCENDANTS_UNKNOWN";
      }
    }
    // The on-disk record contains no creation-time descendant coverage. Even
    // positive PID reuse or root death cannot establish exit of that old tree.
    // 07b owns trustworthy resolution; 07a never deletes this only evidence.
    unresolved.push(registry.recordUnresolved({ kind: name, pid, reason, rootExited }));
  }
  return { unresolved };
}

module.exports = { reapStaleSidecars, waitForExit };
