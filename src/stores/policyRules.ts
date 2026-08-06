import type { InferenceMode, ShareVisibility } from "../types/electron";
import type { OrgPolicy, PolicyScope } from "../types/policy";
import { compareAppVersions } from "../utils/version.ts";

export type PolicyStatus = "idle" | "loading" | "managed" | "unmanaged" | "error";

export interface PolicyDecisionSnapshot {
  status: PolicyStatus;
  policy: OrgPolicy | null;
  appVersion: string | null;
}

export function isPolicyActionAllowed(state: PolicyDecisionSnapshot): boolean {
  if (state.status === "idle" || state.status === "unmanaged") return true;
  if (state.status !== "managed" || !state.policy) return false;
  if (!state.policy.minAppVersion) return true;
  if (!state.appVersion) return false;
  return compareAppVersions(state.appVersion, state.policy.minAppVersion) >= 0;
}

export type DesktopPolicyAction =
  | "capture"
  | "inference"
  | "agent"
  | "sharing"
  | "cloud-backup"
  | "history"
  | "retention-settings"
  | "updater"
  | "diagnostics"
  | "permissions"
  | "account"
  | "sign-out";

const RECOVERY_ACTIONS = new Set<DesktopPolicyAction>([
  "history",
  "retention-settings",
  "updater",
  "diagnostics",
  "permissions",
  "account",
  "sign-out",
]);

export function isDesktopActionAllowed(
  state: PolicyDecisionSnapshot,
  action: DesktopPolicyAction
): boolean {
  return RECOVERY_ACTIONS.has(action) || isPolicyActionAllowed(state);
}

export function effectiveLocalHistoryEnabled(
  state: PolicyDecisionSnapshot,
  personalPreference: boolean
): boolean {
  if (state.status !== "managed" || !state.policy) return personalPreference;
  const mode = state.policy.dataRetention.localHistoryMode;
  if (mode === "always_on") return true;
  if (mode === "always_off") return false;
  return personalPreference;
}

export function effectiveAudioRetentionDays(
  state: PolicyDecisionSnapshot,
  personalPreference: number
): number {
  if (personalPreference === 0 || state.status !== "managed" || !state.policy) {
    return personalPreference;
  }
  const maximumDays = state.policy.dataRetention.audioRetentionMaxDays;
  return maximumDays === null ? personalPreference : Math.min(personalPreference, maximumDays);
}

export function isModeAllowedByPolicy(
  state: PolicyDecisionSnapshot,
  scope: PolicyScope,
  mode: InferenceMode
): boolean {
  if (!isPolicyActionAllowed(state)) return false;
  if (state.status !== "managed" || !state.policy) return true;
  return state.policy[scope].allowedModes.includes(mode);
}

export function isProviderAllowedByPolicy(
  state: PolicyDecisionSnapshot,
  scope: PolicyScope,
  providerId: string
): boolean {
  if (!isPolicyActionAllowed(state)) return false;
  if (state.status !== "managed" || !state.policy) return true;
  return state.policy[scope].allowedByokProviders.includes(providerId);
}

export interface LlmSelection {
  mode: InferenceMode;
  provider: string;
}

export function isLlmSelectionAllowed(
  state: PolicyDecisionSnapshot,
  selection: LlmSelection
): boolean {
  if (!isModeAllowedByPolicy(state, "llm", selection.mode)) return false;
  if (selection.mode === "providers") {
    return isProviderAllowedByPolicy(state, "llm", selection.provider);
  }
  if (selection.mode === "enterprise") {
    if (state.status !== "managed" || !state.policy) return true;
    return state.policy.llm.allowedEnterpriseProviders.includes(selection.provider);
  }
  return true;
}

export interface TranscriptionSelection {
  mode: InferenceMode;
  provider: string;
}

export function isTranscriptionSelectionAllowed(
  state: PolicyDecisionSnapshot,
  selection: TranscriptionSelection
): boolean {
  if (!isModeAllowedByPolicy(state, "transcription", selection.mode)) return false;
  if (selection.mode !== "providers") return true;
  return isProviderAllowedByPolicy(state, "transcription", selection.provider);
}

export function isShareVisibilityAllowed(
  state: PolicyDecisionSnapshot,
  visibility: ShareVisibility
): boolean {
  if (!isPolicyActionAllowed(state)) return false;
  if (state.status !== "managed" || !state.policy) return true;
  const mode = state.policy.sharing.externalLinkSharing;
  if (mode === "allowed") return true;
  if (mode === "domain_only") return visibility === "private" || visibility === "domain";
  return visibility === "private";
}

export type SharePolicyAction =
  | "create-link"
  | "copy-link"
  | "rotate-link"
  | "invite"
  | "resend-invitation"
  | "create-grant"
  | "change-grant"
  | "set-domain"
  | "make-private"
  | "revoke-invitation"
  | "remove-grant";

export function isShareActionAllowed(
  state: PolicyDecisionSnapshot,
  action: SharePolicyAction,
  currentVisibility: ShareVisibility
): boolean {
  if (action === "make-private" || action === "revoke-invitation" || action === "remove-grant") {
    return true;
  }
  if (action === "copy-link" || action === "rotate-link") {
    return currentVisibility === "link" && isShareVisibilityAllowed(state, "link");
  }
  if (action === "create-link") return isShareVisibilityAllowed(state, "link");
  if (action === "set-domain") return isShareVisibilityAllowed(state, "domain");
  return isShareVisibilityAllowed(state, "invited");
}

export function canChangeCloudBackupPreference(
  policyAllowsBackup: boolean,
  backupCurrentlyEnabled: boolean
): boolean {
  return policyAllowsBackup || backupCurrentlyEnabled;
}

export function isControlPanelViewAllowed(
  view: string,
  agentAllowed: boolean,
  policyActionsAllowed: boolean
): boolean {
  if (view === "chat") return agentAllowed;
  if (view === "upload") return policyActionsAllowed;
  return true;
}

interface CloudProviderOption {
  id: string;
  models?: ReadonlyArray<{ id: string }>;
}

export function reconcileCloudProviderSelection({
  selectedProvider,
  selectedModel,
  allowedProviders,
  customAllowed,
  hasCustomUrl,
}: {
  selectedProvider: string;
  selectedModel: string;
  allowedProviders: readonly CloudProviderOption[];
  customAllowed: boolean;
  hasCustomUrl: boolean;
}): { provider: string; model: string } | null {
  if (selectedProvider === "custom" && customAllowed) return null;
  const selected = allowedProviders.find((provider) => provider.id === selectedProvider);
  if (selected) {
    if (selectedModel || !selected.models?.length) return null;
    return { provider: selected.id, model: selected.models[0].id };
  }
  if (hasCustomUrl && customAllowed) {
    return { provider: "custom", model: selectedModel || "whisper-1" };
  }
  const first = allowedProviders[0];
  if (!first) return null;
  return { provider: first.id, model: first.models?.[0]?.id ?? "" };
}
