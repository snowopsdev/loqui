import type {
  Attestation,
  EgressEvent,
  EgressNotice,
  EgressSummary,
  PrivacyAPI,
} from "../types/privacy";

// An in-memory stand-in for main's privacy bridge, for the browser preview
// only (installBrowserPreview supplies it; Electron never loads it). It mirrors
// the typed PrivacyAPI and the shape main produces in Plan 07a, and it keeps
// 07a's honesty: there is no native boundary here, so nothing is ever verified,
// isolated or "nothing leaves". No IPC, network or filesystem access.

const UNAVAILABLE = "NATIVE_BOUNDARY_UNAVAILABLE" as const;
const MAX_LIMIT = 5000;
const MINUTE = 60_000;

const startOfDay = (ms: number): number => {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

// Metadata only: bare hosts, counts, outcomes and error classes. No URLs,
// paths, content, prompts, keys or messages. Times are relative to `nowMs`
// and never earlier than today's midnight, except the one row that deliberately
// started just before it and ended after it.
export function createSampleEgress(nowMs: number): EgressEvent[] {
  const midnight = startOfDay(nowMs);
  const at = (minutesAgo: number) => Math.max(midnight, nowMs - minutesAgo * MINUTE);
  const base = {
    operationId: null,
    status: null,
    errorClass: null,
    model: null,
    attributed: true,
    opaque: false,
  } satisfies Partial<EgressEvent>;
  const rows: Omit<EgressEvent, "id">[] = [
    {
      ...base,
      ts: at(2),
      endedAt: Math.min(nowMs, at(2) + 1400),
      task: "dictationCleanup",
      host: "api.openai.com",
      hosts: ["api.openai.com"],
      kind: "request",
      bytesOut: 1840,
      bytesIn: 612,
      outcome: "ok",
      status: 200,
      model: "gpt-4.1-mini",
    },
    {
      ...base,
      ts: at(9),
      endedAt: at(9),
      task: "chat",
      host: "api.anthropic.com",
      hosts: ["api.anthropic.com"],
      kind: "request",
      bytesOut: 0,
      bytesIn: 0,
      outcome: "blocked",
      errorClass: "SEALED_MODE",
    },
    {
      ...base,
      ts: at(16),
      endedAt: Math.min(nowMs, at(16) + 900),
      task: "noteFormatting",
      host: "api.openai.com",
      hosts: ["api.openai.com"],
      kind: "request",
      bytesOut: null,
      bytesIn: null,
      outcome: "cancelled",
      errorClass: "SEALED_MODE",
    },
    {
      ...base,
      ts: at(24),
      endedAt: Math.min(nowMs, at(24) + 8 * MINUTE),
      task: "codex",
      host: "chatgpt.com",
      hosts: ["chatgpt.com"],
      kind: "session",
      bytesOut: null,
      bytesIn: null,
      outcome: "ok",
      opaque: true,
    },
    {
      ...base,
      ts: at(33),
      endedAt: Math.min(nowMs, at(33) + 2 * MINUTE),
      task: "dictationStt",
      host: "api.deepgram.com",
      hosts: ["api.deepgram.com"],
      kind: "connection",
      bytesOut: 96_512,
      bytesIn: 4_208,
      outcome: "ok",
      model: "nova-3",
    },
    {
      // Started 40 s before local midnight and ended 30 s after it (or at
      // "now", if the clock is closer to midnight than that).
      ...base,
      ts: midnight - 40_000,
      endedAt: Math.min(nowMs, midnight + 30_000),
      task: "uploadStt",
      host: "api.deepgram.com",
      hosts: ["api.deepgram.com"],
      kind: "request",
      bytesOut: 2_457_600,
      bytesIn: 1_204,
      outcome: "ok",
      status: 200,
      model: "nova-3",
    },
  ];
  return rows.map((row, index) => ({ ...row, id: rows.length - index }));
}

const inWindow = (row: EgressEvent, since: number) =>
  row.ts >= since || (row.endedAt != null && row.endedAt >= since);

// The same arithmetic as FlightRecorder.summary (main), over the in-memory rows.
function summarize(rows: EgressEvent[]): EgressSummary {
  const sent = rows.filter((row) => row.outcome !== "blocked" && row.kind !== "operation");
  const observed = sent.filter((row) => row.kind === "request" || row.kind === "stream");
  const connections = sent.filter((row) => row.kind === "connection");
  const sessions = sent.filter((row) => row.kind === "session");
  const unexplained = rows.filter((row) => !row.attributed);
  const sum = (key: "bytesOut" | "bytesIn") =>
    observed.reduce((total, row) => total + (row[key] ?? 0), 0);
  return {
    left: observed.length + connections.length + sessions.length,
    observed: observed.length,
    connections: connections.length,
    blocked: rows.filter((row) => row.outcome === "blocked").length,
    unattributed: unexplained.length,
    unattributedHosts: [...new Set(unexplained.map((row) => row.host))],
    bytesOut: sum("bytesOut"),
    bytesIn: sum("bytesIn"),
    unknownBytes: observed.filter((row) => row.bytesOut == null).length,
    opaqueSessions: sessions.length,
  };
}

export function createPreviewPrivacyAPI(clock: () => number = Date.now): PrivacyAPI {
  let sealed = false;
  let sealedSince: number | null = null;
  let version = 0;
  let events = createSampleEgress(clock());
  const sealedListeners = new Set<(value: boolean) => void>();
  const attestationListeners = new Set<(value: Attestation) => void>();
  const clearedListeners = new Set<() => void>();
  const eventListeners = new Set<(notice: EgressNotice) => void>();
  const subscribe =
    <T>(group: Set<T>) =>
    (callback: T) => {
      group.add(callback);
      return () => {
        group.delete(callback);
      };
    };

  // The preview runs none of main's guards, so none is claimed, and while sealed
  // the unavailable native boundary is the first unresolved fact, as in 07a.
  const attest = (): Attestation => ({
    sealed,
    sealedSince,
    effectiveSince: null,
    phase: sealed ? "sealing" : "open",
    failures: sealed
      ? [
          UNAVAILABLE,
          "guard:node",
          "guard:dns",
          "guard:dgram",
          "guard:http",
          "guard:webContents",
          "guard:sessions",
        ]
      : [],
    notes: [],
    loadError: null,
    saveError: null,
    guards: {
      node: false,
      dns: false,
      dgram: false,
      http: false,
      webContents: false,
      sessions: 0,
      envProxy: false,
      openRemoteSockets: 0,
      chromiumInFlightRemote: 0,
      chromiumUnresolvedAfterDestroy: 0,
      pendingDns: 0,
    },
    networkChildren: [],
    activeRemote: 0,
    children: [],
    childDiagnostics: { nativeBoundaryUnavailable: true, unresolved: [] },
    isolation: {
      platform: "preview",
      mechanism: "none",
      selfTest: "unavailable",
      checkedAt: null,
      reason: UNAVAILABLE,
      pauseReason: null,
    },
    paused: [],
    persistError: null,
    blockedSinceSealed: 0,
    recordFailures: 0,
    version: ++version,
    at: clock(),
    nothingLeaves: false,
  });

  return {
    getSealed: async () => sealed,
    // Main's confirmation to unseal is simulated as accepted.
    setSealed: async (next) => {
      if (typeof next !== "boolean") throw new TypeError("sealed must be a boolean");
      if (next !== sealed) {
        sealed = next;
        sealedSince = next ? clock() : null;
        attestationListeners.forEach((listener) => listener(attest()));
        sealedListeners.forEach((listener) => listener(sealed));
      }
      return attest();
    },
    getAttestation: async () => attest(),
    onSealedChange: subscribe(sealedListeners),
    onAttestation: subscribe(attestationListeners),
    listEgress: async (options) => {
      const since = options?.since ?? startOfDay(clock());
      const limit = Math.min(Math.max(Math.trunc(options?.limit ?? 500) || 1, 1), MAX_LIMIT);
      return events
        .filter((row) => inWindow(row, since))
        .sort((a, b) => b.ts - a.ts || b.id - a.id)
        .slice(0, limit)
        .map((row) => ({ ...row, hosts: [...row.hosts] }));
    },
    egressSummary: async (options) =>
      summarize(events.filter((row) => inWindow(row, options?.since ?? 0))),
    // Main asks in its own dialog; the preview simulates "Clear" accepted.
    clearEgress: async () => {
      events = [];
      clearedListeners.forEach((listener) => listener());
      return true;
    },
    // Nothing is written anywhere in the preview.
    exportEgressCsv: async () => ({ saved: true }),
    onEgress: subscribe(eventListeners),
    onEgressCleared: subscribe(clearedListeners),
  };
}
