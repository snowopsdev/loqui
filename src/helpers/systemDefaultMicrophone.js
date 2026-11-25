const { execFile } = require("child_process");
const { resolveBundledBinary } = require("./binaryResolver");
const debugLogger = require("./debugLogger");

const COMMAND_TIMEOUT_MS = 3000;
// A failed lookup is retried after this long, so a transient error (a helper
// still extracting) does not stick for the session.
const FAILURE_RETRY_MS = 30000;

function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 256 * 1024,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function parseJsonResult(output) {
  const line = String(output || "")
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) return null;
  const result = JSON.parse(line);
  if (!result || typeof result.name !== "string" || !result.name.trim()) return null;
  return {
    name: result.name.trim(),
    nativeId: typeof result.id === "string" && result.id ? result.id : undefined,
  };
}

function parseWpctlResult(output) {
  const description = String(output || "").match(
    /^\s*(?:node\.description|device\.description)\s*=\s*"([^"]+)"/m
  )?.[1];
  const name = String(output || "").match(/^\s*node\.name\s*=\s*"([^"]+)"/m)?.[1];
  const label = description || name;
  return label ? { name: label, nativeId: name || undefined } : null;
}

function parsePactlSources(output, defaultSourceName) {
  let sources;
  try {
    sources = JSON.parse(output);
  } catch {
    return null;
  }
  if (!Array.isArray(sources)) return null;
  const source = sources.find((candidate) => candidate?.name === defaultSourceName);
  if (!source) return null;
  const label = source.description || source.properties?.["device.description"] || source.name;
  return label ? { name: label, nativeId: source.name } : null;
}

function createSystemDefaultMicrophoneResolver({
  platform = process.platform,
  run = runFile,
  resolveBinary = resolveBundledBinary,
  now = Date.now,
} = {}) {
  let cache = null;
  let cachedAt = 0;
  let inflight = null;

  const resolveDarwin = async () => {
    const helper = resolveBinary("macos-mic-listener", "audio");
    if (!helper) return null;
    return parseJsonResult(await run(helper, ["--print-default-input"]));
  };

  const resolveLinux = async () => {
    try {
      const output = await run("wpctl", ["inspect", "@DEFAULT_AUDIO_SOURCE@"]);
      const result = parseWpctlResult(output);
      if (result) return result;
    } catch {
      // PulseAudio remains common on distributions without WirePlumber.
    }

    const defaultSourceName = (await run("pactl", ["get-default-source"])).trim();
    if (!defaultSourceName) return null;
    const sources = await run("pactl", ["--format=json", "list", "sources"]);
    return parsePactlSources(sources, defaultSourceName);
  };

  const lookup = async () => {
    try {
      let result = null;
      if (platform === "darwin") result = await resolveDarwin();
      else if (platform === "linux") result = await resolveLinux();

      cache = result
        ? { ...result, platform, source: "system" }
        : { name: "", platform, source: "unavailable" };
    } catch (error) {
      debugLogger.debug(
        "Failed to resolve the system default microphone",
        { platform, error: error.message },
        "audio"
      );
      cache = { name: "", platform, source: "unavailable" };
    }
    cachedAt = now();
    return cache;
  };

  // A successful lookup stays valid until a renderer sees a devicechange and
  // asks for a refresh: each lookup spawns a helper, too slow to sit on the
  // hotkey path. Every caller joins an in-flight lookup so all windows share
  // one process and see the same answer.
  return async ({ refresh = false } = {}) => {
    if (inflight) return inflight;
    if (!refresh && cache && (cache.source === "system" || now() - cachedAt < FAILURE_RETRY_MS)) {
      return cache;
    }
    inflight = lookup().finally(() => {
      inflight = null;
    });
    return inflight;
  };
}

module.exports = {
  createSystemDefaultMicrophoneResolver,
  parseJsonResult,
  parsePactlSources,
  parseWpctlResult,
  resolveSystemDefaultMicrophone: createSystemDefaultMicrophoneResolver(),
};
