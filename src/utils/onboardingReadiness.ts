import type { Locality } from "../lib/locality";
import type { ResolvedRoute } from "../lib/routes";
import type { CleanupChoice, CleanupStatus } from "./onboardingCleanup";
import { cleanupSituation } from "./onboardingCleanupPreview";
import type { VoiceDownloadState } from "./onboardingDownload";
import type { OnboardingStep } from "./onboardingState";

// Ready says only what is true (ONB-R8 A, I07). "ready" means proven in this
// setup; "configured" means set up but not yet tried.
export type ReadinessStatus = "ready" | "configured" | "pending" | "optional";
export type ReadinessKey = "speech" | "microphone" | "shortcut" | "cleanup";

export interface ReadinessRow {
  key: ReadinessKey;
  status: ReadinessStatus;
  detail: string;
  values?: Record<string, string>;
  step: OnboardingStep;
  settingsPath?: string;
}

export interface ReadinessInput {
  speechRoute: ResolvedRoute;
  noteRoute: ResolvedRoute;
  localVoiceActive: boolean;
  voiceDownload: VoiceDownloadState["status"];
  microphone: "granted" | "denied" | "unknown";
  micHeard: boolean;
  trialSucceeded: boolean;
  platform: "darwin" | "linux" | "win32";
  accessibilityGranted: boolean | null;
  shortcutProven: boolean;
  shortcutLabel: string;
  activationMode: "tap" | "push";
  cleanupChoice: CleanupChoice;
  cleanupStatus: CleanupStatus;
  cleanupRoute: ResolvedRoute;
  cleanupProviderLabel: string;
}

export interface ReadinessSummary {
  rows: ReadinessRow[];
  pending: number;
  proven: boolean;
  allLocal: boolean;
}

function speechRow(input: ReadinessInput): ReadinessRow {
  const base = { key: "speech" as const, step: "speech" as const };
  const route = input.speechRoute;
  // §5.1 rule 1: only a ready route counts. A just-finished local download waits
  // for the route facts to refresh (Plan 03), and reads "Checking…" meanwhile.
  if (route.state.status === "ready") {
    return input.trialSucceeded
      ? { ...base, status: "ready", detail: "speech.proven", values: { voice: route.model ?? "" } }
      : {
          ...base,
          status: "configured",
          detail: "speech.configured",
          values: { voice: route.model ?? "" },
        };
  }
  if (input.voiceDownload === "downloading" || input.voiceDownload === "installing") {
    return { ...base, status: "pending", detail: "speech.downloading" };
  }
  if (
    route.state.status === "unknown" ||
    (route.state.status === "needsModel" && route.locality === "device" && input.localVoiceActive)
  ) {
    return { ...base, status: "pending", detail: "speech.checking" };
  }
  if (route.state.status === "unreachable" && route.state.detail === "nativeUnavailable") {
    // Plan 07 (fix round 1, I1): main attests local engines don't run while
    // sealed on this build. Not ready, and not "checking" either.
    return {
      ...base,
      status: "pending",
      detail: "speech.nativeUnavailable",
      settingsPath: route.settingsPath,
    };
  }
  if (
    route.state.status === "needsKey" ||
    route.state.status === "needsUrl" ||
    route.state.status === "unreachable"
  ) {
    return {
      ...base,
      status: "pending",
      detail: "speech.unavailable",
      settingsPath: route.settingsPath,
    };
  }
  return { ...base, status: "pending", detail: "speech.needsModel" };
}

function microphoneRow(input: ReadinessInput): ReadinessRow {
  const base = { key: "microphone" as const, step: "welcome" as const };
  if (input.microphone === "denied")
    return { ...base, status: "pending", detail: "microphone.denied" };
  if (input.trialSucceeded || input.micHeard)
    return { ...base, status: "ready", detail: "microphone.heard" };
  if (input.microphone === "granted")
    return { ...base, status: "configured", detail: "microphone.allowed" };
  return {
    ...base,
    status: "pending",
    detail: "microphone.untested",
  };
}

function shortcutRow(input: ReadinessInput): ReadinessRow {
  const base = { key: "shortcut" as const, step: "shortcuts" as const };
  if (input.platform === "darwin" && input.accessibilityGranted !== true) {
    return {
      ...base,
      status: "pending",
      detail:
        input.accessibilityGranted === false
          ? "shortcut.needsAccessibility"
          : "shortcut.checkAccessibility",
    };
  }
  const values = { key: input.shortcutLabel };
  return input.shortcutProven
    ? { ...base, status: "ready", detail: `shortcut.proven.${input.activationMode}`, values }
    : {
        ...base,
        status: "configured",
        detail: `shortcut.configured.${input.activationMode}`,
        values,
      };
}

function cleanupRow(input: ReadinessInput): ReadinessRow {
  const base = { key: "cleanup" as const, step: "cleanup" as const };
  const route = input.cleanupRoute;
  const situation = cleanupSituation(input.cleanupChoice, input.cleanupStatus, route);
  const provider = { provider: input.cleanupProviderLabel };
  switch (situation) {
    case "off":
      return { ...base, status: "optional", detail: "cleanup.off" };
    case "ready":
      // A choice check establishes configuration, not provider execution.
      return {
        ...base,
        status: "configured",
        detail: route.locality === "network" ? "cleanup.configuredNetwork" : "cleanup.configured",
        values: {
          name: route.model ?? input.cleanupProviderLabel,
          provider: input.cleanupProviderLabel,
        },
      };
    case "review":
      return { ...base, status: "pending", detail: "cleanup.review" };
    case "checking":
    case "needsConnection":
    case "modelSetup":
      return { ...base, status: "pending", detail: `cleanup.${situation}` };
    default:
      return {
        ...base,
        status: "pending",
        detail: `cleanup.${situation}`,
        values: provider,
        settingsPath: route.settingsPath,
      };
  }
}

export function summarizeReadiness(input: ReadinessInput): ReadinessSummary {
  const rows = [speechRow(input), microphoneRow(input), shortcutRow(input), cleanupRow(input)];
  const pending = rows.filter((row) => row.status === "pending").length;
  const speechLocal = input.speechRoute.locality === "device";
  const cleanupLocal = rows[3].status === "optional" || input.cleanupRoute.locality === "device";
  const noteLocal = input.noteRoute.locality === "device";
  return {
    rows,
    pending,
    proven: rows[0].status === "ready",
    allLocal: speechLocal && cleanupLocal && noteLocal,
  };
}

export type NoteBlock =
  | "microphone"
  | "unsupported"
  | "sealed"
  | "nativeUnavailable"
  | "needsModel"
  | "needsKey"
  | "needsUrl"
  | "unreachable";

export interface NoteActionState {
  status: "ready" | "checking" | "blocked";
  block: NoteBlock | null;
  locality: Locality;
  providerId: string | null;
  model: string | null;
  settingsPath: string;
}

/**
 * I06: "Dictate into a note" records through noteRecordingStt, which can differ
 * from dictation (Task 13 leaves it alone). The route is the only input: §5.1
 * rule 9 resolves self-hosted notes as unreachable/unsupported, because the
 * recorder throws unsupportedSelfHosted (src/helpers/meetingTranscriptionRouting.js).
 */
export function noteActionState({
  route,
  microphone,
}: {
  route: ResolvedRoute;
  microphone: "granted" | "denied" | "unknown";
}): NoteActionState {
  const base = {
    locality: route.locality,
    providerId: route.providerId,
    model: route.model,
    settingsPath: route.settingsPath,
  };
  const blocked = (block: NoteBlock): NoteActionState => ({ ...base, status: "blocked", block });
  const state = route.state;
  if (state.status === "unknown") return { ...base, status: "checking", block: null };
  if (state.status === "unreachable" && state.detail === "unsupported")
    return blocked("unsupported");
  if (state.status === "unreachable" && state.detail === "sealed") return blocked("sealed");
  if (state.status === "unreachable" && state.detail === "nativeUnavailable")
    return blocked("nativeUnavailable");
  if (state.status === "needsModel" || state.status === "off") return blocked("needsModel");
  if (state.status === "needsKey") return blocked("needsKey");
  if (state.status === "needsUrl") return blocked("needsUrl");
  if (state.status === "unreachable") return blocked("unreachable");
  if (microphone === "denied") return blocked("microphone");
  return { ...base, status: "ready", block: null };
}
