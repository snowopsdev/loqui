export type EgressTask =
  | "dictationStt"
  | "noteRecordingStt"
  | "uploadStt"
  | "dictationCleanup"
  | "voiceAssistant"
  | "assistantVision"
  | "translation"
  | "noteFormatting"
  | "chat"
  | "speakerId"
  | "semanticSearch"
  | "providerCheck"
  | "modelDownload"
  | "runtimeDownload"
  | "urlImport"
  | "appUpdate"
  | "codex"
  | "calendar"
  | "unattributed";
export type EgressOutcome = "ok" | "error" | "blocked" | "cancelled";
export type EgressPayload = "audio" | "text" | "image" | "metadata";
export interface EgressEvent {
  id: number;
  ts: number;
  endedAt: number | null;
  task: EgressTask;
  host: string;
  hosts: string[]; // host = hosts[0]; the trail includes redirects (Task 4)
  kind: "request" | "stream" | "connection" | "session" | "operation";
  operationId: number | null;
  bytesOut: number | null;
  bytesIn: number | null;
  outcome: EgressOutcome;
  status: number | null;
  errorClass: string | null;
  model: string | null; // errorClass: a category (Task 4 ERROR_CLASSES); model: an identifier or null
  attributed: boolean;
  opaque: boolean;
}
export interface EgressSummary {
  left: number;
  observed: number;
  connections: number; // left = observed + connections + opaqueSessions; operations never count
  blocked: number;
  unattributed: number;
  unattributedHosts: string[];
  bytesOut: number;
  bytesIn: number;
  unknownBytes: number;
  opaqueSessions: number;
}
export type EgressNotice =
  | {
      phase: "dispatched" | "delivered" | "undelivered";
      ticketId: number;
      operationId: number;
      attemptId: string | null;
      task: EgressTask;
      targetId: string; // provider id, or "host:<host>" for custom/LAN endpoints (Plan 04 encoding)
      host: string;
      payload: EgressPayload;
      correlationId: string | null;
      ts: number;
    }
  | { phase: "recorded"; event: EgressEvent };
export interface Attestation {
  sealed: boolean;
  sealedSince: number | null; // when the switch was turned on
  effectiveSince: null; // 07a has no verified native boundary
  phase: "open" | "sealing" | "sealed";
  failures: string[]; // unresolved: "codexStop", "childStop", "timeout:<what is still running>"
  notes: string[]; // resolved before effectiveSince, shown for honesty
  loadError: "corrupt" | "unreadable" | null;
  saveError: string | null;
  guards: {
    node: boolean;
    dns: boolean;
    dgram: boolean;
    http: boolean;
    webContents: boolean;
    sessions: number;
    envProxy: boolean;
    openRemoteSockets: number;
    chromiumInFlightRemote: number;
    chromiumUnresolvedAfterDestroy: number;
    pendingDns: number;
  };
  networkChildren: string[];
  activeRemote: number;
  children: Array<{ kind: string; pid?: number | null; local: boolean }>;
  childDiagnostics: {
    nativeBoundaryUnavailable: boolean;
    unresolved: Array<{
      kind: string;
      pid: number | null;
      reason: string;
      rootExited: boolean;
      source: string;
      inspection?: string;
      knownDescendants?: number[];
      observedLiveDescendantPids?: number[];
      observedGroupAlive?: boolean | null;
    }>;
  };
  isolation: {
    platform: string;
    mechanism: "none";
    selfTest: "unavailable";
    checkedAt: null;
    reason: "NATIVE_BOUNDARY_UNAVAILABLE";
    pauseReason: null;
  };
  paused: never[];
  persistError: string | null;
  blockedSinceSealed: number;
  recordFailures: number;
  version: number;
  at: number;
  nothingLeaves: false;
}
export interface PrivacyAPI {
  getSealed(): Promise<boolean>;
  setSealed(sealed: boolean): Promise<Attestation & { declined?: boolean }>;
  getAttestation(): Promise<Attestation>;
  onSealedChange(callback: (sealed: boolean) => void): () => void;
  onAttestation(callback: (attestation: Attestation) => void): () => void;
  listEgress(options?: { since?: number; limit?: number }): Promise<EgressEvent[]>;
  egressSummary(options?: { since?: number }): Promise<EgressSummary>;
  clearEgress(): Promise<boolean>; // false when the user declined main's confirmation
  exportEgressCsv(): Promise<{ saved: boolean }>;
  onEgress(callback: (notice: EgressNotice) => void): () => void;
  onEgressCleared(callback: () => void): () => void;
}
