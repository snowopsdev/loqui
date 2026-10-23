import type { InferenceMode } from "../types/electron";

// Where a route's data goes. Shape (solid/dotted/dashed ring) carries this
// first; see DESIGN.md "Motion" and "Roles". Anything unrecognised resolves
// to "remote" so the UI over-discloses rather than under-discloses.
export type Locality = "device" | "network" | "remote";

export interface RouteLocality {
  locality: Locality;
  provider: string | null;
}

// A Map, not an object: ids come from persisted settings, and an inherited key
// such as "constructor" or "__proto__" must never resolve to a non-string.
const PROVIDER_NAMES = new Map<string, string>(
  Object.entries({
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Google Gemini",
    vertex: "Google Vertex AI",
    groq: "Groq",
    mistral: "Mistral",
    xai: "xAI",
    openrouter: "OpenRouter",
    bedrock: "AWS Bedrock",
    azure: "Azure OpenAI",
    codex: "ChatGPT (Codex)",
    tinfoil: "Tinfoil",
    deepgram: "Deepgram",
    assemblyai: "AssemblyAI",
    custom: "Custom endpoint",
  })
);

// English display name for logs and other non-UI uses. UI must call
// providerDisplayLabel so the unknown/custom fallbacks are localised.
export function providerDisplayName(providerId: string | null | undefined): string {
  const id = (providerId ?? "").trim();
  if (!id) return "Unknown provider";
  const known = PROVIDER_NAMES.get(id.toLowerCase());
  if (known) return known;
  const titled = id
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return titled || "Unknown provider";
}

// Provider name for display in the UI: unknown and custom ids go through `t`
// (locality.unknownProvider / locality.customEndpoint); everything else is the
// brand name from providerDisplayName.
export function providerDisplayLabel(
  providerId: string | null | undefined,
  t: (key: string) => string
): string {
  const id = (providerId ?? "").trim();
  if (id.toLowerCase() === "custom") return t("locality.customEndpoint");
  if (!id || providerDisplayName(id) === "Unknown provider") return t("locality.unknownProvider");
  return providerDisplayName(id);
}

export function providerMonogram(displayName: string): string {
  const words = displayName.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].charAt(0).toUpperCase() + words[0].charAt(1);
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

// ---------------------------------------------------------------------------
// One loopback rule (Plan 07 CCR-5). "Local" means localhost, *.localhost,
// 127.0.0.0/8, ::1 and IPv4-mapped 127/8, written canonically. A LAN or public
// address, an unparseable or ambiguous spelling (127.1, 0x7f.0.0.1, percent
// escapes, backslash authority) and a name that merely resolves to loopback
// are not local.
//
// This is a line-for-line port of normalizeHost/hostOf/isLoopbackHost in
// src/helpers/privacy/egressPolicy.js, which decides what Sealed mode lets
// through in main. The renderer cannot load that CommonJS module (it needs
// node:net), so net.isIP is replaced by Node's own IP grammar below.
// test/helpers/loopbackParity.test.js holds both to test/fixtures/loopbackCases.json
// and to a generated corpus: change them together.

// Node's lib/internal/net.js isIPv4/isIPv6 grammar, including the zone suffix.
const V4_SEG = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])";
const V4_STR = `(?:${V4_SEG}\\.){3}${V4_SEG}`;
const IPV4_RE = new RegExp(`^${V4_STR}$`);
const V6_SEG = "(?:[0-9a-fA-F]{1,4})";
const IPV6_RE = new RegExp(
  "^(?:" +
    `(?:${V6_SEG}:){7}(?:${V6_SEG}|:)|` +
    `(?:${V6_SEG}:){6}(?:${V4_STR}|:${V6_SEG}|:)|` +
    `(?:${V6_SEG}:){5}(?::${V4_STR}|(?::${V6_SEG}){1,2}|:)|` +
    `(?:${V6_SEG}:){4}(?:(?::${V6_SEG}){0,1}:${V4_STR}|(?::${V6_SEG}){1,3}|:)|` +
    `(?:${V6_SEG}:){3}(?:(?::${V6_SEG}){0,2}:${V4_STR}|(?::${V6_SEG}){1,4}|:)|` +
    `(?:${V6_SEG}:){2}(?:(?::${V6_SEG}){0,3}:${V4_STR}|(?::${V6_SEG}){1,5}|:)|` +
    `(?:${V6_SEG}:){1}(?:(?::${V6_SEG}){0,4}:${V4_STR}|(?::${V6_SEG}){1,6}|:)|` +
    `(?::(?:(?::${V6_SEG}){0,5}:${V4_STR}|(?::${V6_SEG}){1,7}|:))` +
    ")(?:%[0-9a-zA-Z-.:]{1,})?$"
);

// Same answer as Node's net.isIP for a string: 4, 6 or 0.
export function ipLiteralVersion(value: string): 0 | 4 | 6 {
  if (IPV4_RE.test(value)) return 4;
  if (IPV6_RE.test(value)) return 6;
  return 0;
}

function validDnsName(host: string): boolean {
  if (host.length > 253 || host.startsWith(".") || host.endsWith(".")) return false;
  return host
    .split(".")
    .every(
      (label) =>
        label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    );
}

function validPort(port: string | undefined): boolean {
  if (port === undefined || port === "") return true;
  if (!/^\d+$/.test(port)) return false;
  const value = Number(port);
  return Number.isInteger(value) && value >= 0 && value <= 65535;
}

// A validated bare host, or null. Paths, credentials, queries, fragments and
// malformed brackets are never stripped into an apparently trusted host.
function normalizeHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || /[\s/@?#\\]/.test(input)) return null;

  let rawHost: string;
  let port: string | undefined;
  if (input.startsWith("[")) {
    const close = input.indexOf("]");
    if (close < 0) return null;
    rawHost = input.slice(1, close);
    const rest = input.slice(close + 1);
    if (rest && !rest.startsWith(":")) return null;
    if (rest.startsWith(":")) port = rest.slice(1);
    if (ipLiteralVersion(rawHost) !== 6) return null;
  } else {
    if (input.includes("[") || input.includes("]")) return null;
    const colonCount = (input.match(/:/g) || []).length;
    if (colonCount > 1) {
      rawHost = input;
      if (ipLiteralVersion(rawHost) !== 6) return null;
    } else if (colonCount === 1) {
      [rawHost, port] = input.split(":");
    } else {
      rawHost = input;
    }
  }
  if (!validPort(port)) return null;

  rawHost = rawHost.toLowerCase();
  if (rawHost.endsWith(".")) rawHost = rawHost.slice(0, -1);
  if (!rawHost) return null;
  if (ipLiteralVersion(rawHost)) return rawHost;
  // Nonstandard numeric IPv4 spellings (127.1, 0177.0.0.1) are not hosts.
  if (/^[0-9.]+$/.test(rawHost)) return null;
  return validDnsName(rawHost) ? rawHost : null;
}

function authorityHost(authority: string): string | null {
  const at = authority.lastIndexOf("@");
  const raw = authority.slice(at + 1);
  if (!raw) return null;
  if (raw.startsWith("[")) {
    const close = raw.indexOf("]");
    if (close < 0) return null;
    const host = raw.slice(1, close);
    const tail = raw.slice(close + 1);
    return ipLiteralVersion(host) === 6 &&
      (!tail || (tail.startsWith(":") && validPort(tail.slice(1))))
      ? normalizeHost(host)
      : null;
  }
  if (raw.includes("[") || raw.includes("]")) return null;
  const colon = raw.lastIndexOf(":");
  if (colon >= 0) {
    if (raw.slice(0, colon).includes(":")) return null;
    if (!validPort(raw.slice(colon + 1))) return null;
  }
  return normalizeHost(raw);
}

function ipv6Words(host: string): number[] | null {
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
  const parseHalf = (part: string) =>
    part ? part.split(":").map((word) => Number.parseInt(word, 16)) : [];
  const left = parseHalf(halves[0]);
  const right = halves.length === 2 ? parseHalf(halves[1]) : [];
  const missing = 8 - left.length - right.length;
  const words = halves.length === 2 ? [...left, ...Array<number>(missing).fill(0), ...right] : left;
  return words.length === 8 ? words : null;
}

function sameHostAddress(left: string, right: string): boolean {
  if (left === right) return true;
  if (ipLiteralVersion(left) !== 6 || ipLiteralVersion(right) !== 6) return false;
  const leftWords = ipv6Words(left);
  const rightWords = ipv6Words(right);
  return (
    !!leftWords && !!rightWords && leftWords.every((word, index) => word === rightWords[index])
  );
}

// The host a URL string reaches, only when its raw authority and the WHATWG
// parse agree on it. Anything ambiguous is null, which is never loopback.
function urlHost(target: string): string | null {
  const match = target.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i);
  if (!match) return null;
  // WHATWG treats backslashes as separators for special URLs and strips some
  // ASCII controls while parsing: such an authority is ambiguous.
  if (/[\\\u0000- \u007f]/.test(match[1])) return null;
  const host = authorityHost(match[1]);
  if (!host) return null;
  try {
    const parsed = new URL(target);
    const parsedHost = normalizeHost(parsed.hostname);
    if (!parsedHost || !sameHostAddress(parsedHost, host)) return null;
    // URL's legacy IPv4 parser must not turn a malformed raw numeric host
    // into a loopback address.
    if (
      parsed.hostname &&
      ipLiteralVersion(parsed.hostname) === 4 &&
      !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(
        match[1].slice(match[1].lastIndexOf("@") + 1).replace(/:\d+$/, "")
      )
    )
      return null;
    return parsedHost;
  } catch {
    return null;
  }
}

// A bare host, optionally bracketed and with a port: main's isLoopbackHost.
export function isLoopbackHostname(hostname: string | null | undefined): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (ipLiteralVersion(host) === 4) return Number(host.split(".")[0]) === 127;
  if (ipLiteralVersion(host) !== 6) return false;
  const words = ipv6Words(host);
  if (!words) return false;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true;
  return (
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff && words[6] >> 8 === 127
  );
}

// A URL string: main's isLoopbackHost(hostOf(url)).
export function isLoopbackUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string" || !url) return false;
  return isLoopbackHostname(urlHost(url));
}

export function resolveLocality(input: {
  mode: InferenceMode | string | null | undefined;
  provider?: string | null;
  remoteUrl?: string | null;
}): RouteLocality {
  if (input.mode === "local") return { locality: "device", provider: null };
  if (input.mode === "self-hosted") {
    // Executors trim the configured URL before sending (routeGraph does too).
    return isLoopbackUrl(input.remoteUrl?.trim())
      ? { locality: "device", provider: null }
      : { locality: "network", provider: null };
  }
  return { locality: "remote", provider: providerDisplayName(input.provider) };
}
