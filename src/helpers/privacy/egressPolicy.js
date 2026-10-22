const net = require("node:net");

const ROUTE_TASKS = Object.freeze([
  "dictationStt",
  "noteRecordingStt",
  "uploadStt",
  "dictationCleanup",
  "voiceAssistant",
  "assistantVision",
  "translation",
  "noteFormatting",
  "chat",
  "speakerId",
  "semanticSearch",
]);
const PURPOSE_TASKS = Object.freeze([
  "providerCheck",
  "modelDownload",
  "runtimeDownload",
  "urlImport",
  "appUpdate",
  "codex",
  "calendar",
  "unattributed",
]);
const EGRESS_TASKS = Object.freeze([...ROUTE_TASKS, ...PURPOSE_TASKS]);
const SCOPE_TO_TASK = Object.freeze({
  dictationCleanup: "dictationCleanup",
  dictationAgent: "voiceAssistant",
  dictationAgentVision: "assistantVision",
  noteFormatting: "noteFormatting",
  chatIntelligence: "chat",
  dictationTranslation: "translation",
});

function taskForScope(scope) {
  return Object.hasOwn(SCOPE_TO_TASK, scope) ? SCOPE_TO_TASK[scope] : "unattributed";
}

function validDnsName(host) {
  if (host.length > 253 || host.startsWith(".") || host.endsWith(".")) return false;
  return host
    .split(".")
    .every(
      (label) =>
        label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    );
}

function parsePort(port) {
  if (port === undefined || port === "") return true;
  if (!/^\d+$/.test(port)) return false;
  const value = Number(port);
  return Number.isInteger(value) && value >= 0 && value <= 65535;
}

// Returns only a validated bare host. Optional ports are accepted for host
// fields, but paths, credentials, queries, fragments and malformed brackets
// are never stripped into an apparently trusted host.
function normalizeHost(value) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || /[\s/@?#\\]/.test(input)) return null;

  let rawHost;
  let port;
  if (input.startsWith("[")) {
    const close = input.indexOf("]");
    if (close < 0) return null;
    rawHost = input.slice(1, close);
    const rest = input.slice(close + 1);
    if (rest && !rest.startsWith(":")) return null;
    if (rest.startsWith(":")) port = rest.slice(1);
    if (net.isIP(rawHost) !== 6) return null;
  } else {
    if (input.includes("[") || input.includes("]")) return null;
    const colonCount = (input.match(/:/g) || []).length;
    if (colonCount > 1) {
      rawHost = input;
      if (net.isIP(rawHost) !== 6) return null;
    } else if (colonCount === 1) {
      [rawHost, port] = input.split(":");
    } else {
      rawHost = input;
    }
  }
  if (!parsePort(port)) return null;

  rawHost = rawHost.toLowerCase();
  if (rawHost.endsWith(".")) rawHost = rawHost.slice(0, -1);
  if (!rawHost) return null;
  if (net.isIP(rawHost)) return rawHost;
  // Reject nonstandard numeric IPv4 spellings that WHATWG URL would otherwise
  // reinterpret (for example 127.1 or 0177.0.0.1).
  if (/^[0-9.]+$/.test(rawHost)) return null;
  return validDnsName(rawHost) ? rawHost : null;
}

function authorityHost(authority) {
  const at = authority.lastIndexOf("@");
  const raw = authority.slice(at + 1);
  if (!raw) return null;
  if (raw.startsWith("[")) {
    const close = raw.indexOf("]");
    if (close < 0) return null;
    const host = raw.slice(1, close);
    const tail = raw.slice(close + 1);
    return net.isIP(host) === 6 && (!tail || (tail.startsWith(":") && parsePort(tail.slice(1))))
      ? normalizeHost(host)
      : null;
  }
  if (raw.includes("[") || raw.includes("]")) return null;
  const colon = raw.lastIndexOf(":");
  if (colon >= 0) {
    if (raw.slice(0, colon).includes(":")) return null;
    if (!parsePort(raw.slice(colon + 1))) return null;
  }
  return normalizeHost(raw);
}

function hostOf(target) {
  if (target instanceof URL) {
    const authority = target.href.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1];
    return authority ? authorityHost(authority) : null;
  }
  if (target && typeof target === "object") {
    const candidate = target.hostname ?? target.host;
    return normalizeHost(candidate);
  }
  if (typeof target !== "string") return null;
  const match = target.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i);
  if (!match) return null;
  const host = authorityHost(match[1]);
  if (!host) return null;
  try {
    const parsed = new URL(target);
    // Do not let URL's permissive legacy IPv4 parser turn malformed raw
    // numeric hosts into a loopback address.
    if (
      parsed.hostname &&
      net.isIP(parsed.hostname) === 4 &&
      !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(
        match[1].slice(match[1].lastIndexOf("@") + 1).replace(/:\d+$/, "")
      )
    )
      return null;
    return host;
  } catch {
    return null;
  }
}

function ipv6Words(host) {
  let address = host;
  if (address.includes(".")) {
    const colon = address.lastIndexOf(":");
    if (colon < 0) return null;
    const octets = address
      .slice(colon + 1)
      .split(".")
      .map(Number);
    if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    address = `${address.slice(0, colon)}:${high}:${low}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (part) =>
    part ? part.split(":").map((word) => Number.parseInt(word, 16)) : [];
  const left = parseHalf(halves[0]);
  const right = halves.length === 2 ? parseHalf(halves[1]) : [];
  const missing = 8 - left.length - right.length;
  const words = halves.length === 2 ? [...left, ...Array(missing).fill(0), ...right] : left;
  return words.length === 8 ? words : null;
}

function isLoopbackHost(value) {
  const host = normalizeHost(value);
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (net.isIP(host) === 4) return Number(host.split(".")[0]) === 127;
  if (net.isIP(host) !== 6) return false;
  const words = ipv6Words(host);
  if (!words) return false;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true;
  return (
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff && words[6] >> 8 === 127
  );
}

function decideEgress({ sealed, target }) {
  const host = hostOf(target);
  const loopback = isLoopbackHost(host);
  if (loopback) return { allow: true, host, loopback: true, reason: "loopback" };
  return {
    allow: !sealed,
    host: host ?? "unknown",
    loopback: false,
    reason: sealed ? "sealed" : "unsealed",
  };
}

const SEALED_MODE = "SEALED_MODE";
class SealedModeError extends Error {
  constructor({ task, host, phase = "refused" }) {
    const interrupted = phase === "interrupted";
    super(
      interrupted
        ? `[${SEALED_MODE}:interrupted] Sealed mode interrupted ${task} to ${host}; the provider may have received part of the request.`
        : `[${SEALED_MODE}] Sealed mode blocked ${task} to ${host} before any socket opened; nothing was sent.`
    );
    this.name = "SealedModeError";
    this.code = SEALED_MODE;
    this.messageKey = interrupted ? "sealedMode.interrupted.generic" : "sealedMode.blocked.generic";
    this.details = { task, host, phase: interrupted ? "interrupted" : "refused" };
  }
}

function messageOf(error) {
  return error && typeof error.message === "string" ? error.message : "";
}

function isSealedModeError(error, depth = 0) {
  if (!error || depth > 3) return false;
  if (error.code === SEALED_MODE || messageOf(error).includes(`[${SEALED_MODE}`)) return true;
  return isSealedModeError(error.cause, depth + 1);
}

function sealedPhaseOf(error, depth = 0) {
  if (!error || depth > 3) return null;
  if (error.details?.phase === "interrupted" || error.details?.phase === "refused")
    return error.details.phase;
  const message = messageOf(error);
  if (message.includes(`[${SEALED_MODE}:interrupted]`)) return "interrupted";
  if (message.includes(`[${SEALED_MODE}]`)) return "refused";
  if (error.code === SEALED_MODE) return "refused";
  return sealedPhaseOf(error.cause, depth + 1);
}

module.exports = {
  ROUTE_TASKS,
  PURPOSE_TASKS,
  EGRESS_TASKS,
  SCOPE_TO_TASK,
  taskForScope,
  normalizeHost,
  hostOf,
  isLoopbackHost,
  decideEgress,
  SEALED_MODE,
  SealedModeError,
  isSealedModeError,
  sealedPhaseOf,
};
