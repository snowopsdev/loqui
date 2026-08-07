import { create } from "zustand";
import logger from "../utils/logger";
import type { SettingsState } from "./settingsStore";
import type { InferenceMode, ShareVisibility } from "../types/electron";
import type { OrgPolicy, PolicyScope } from "../types/policy";
import {
  POLICY_SUCCESS_REFRESH_MS,
  resolvedPolicyRefreshIdentity,
  shouldAcceptPolicySnapshot,
  shouldPreserveResolvedPolicyOnFailure,
} from "./policyLifecycle";
import {
  effectiveAudioRetentionDays as effectiveAudioRetentionDaysRule,
  effectiveLocalHistoryEnabled as effectiveLocalHistoryEnabledRule,
  isModeAllowedByPolicy,
  isDesktopActionAllowed as isDesktopActionAllowedRule,
  isLlmSelectionAllowed as isLlmSelectionAllowedRule,
  isPolicyActionAllowed as isPolicyActionAllowedRule,
  isProviderAllowedByPolicy,
  isShareActionAllowed as isShareActionAllowedRule,
  isShareVisibilityAllowed as isShareVisibilityAllowedRule,
  isTranscriptionSelectionAllowed,
  type PolicyDecisionSnapshot,
  type DesktopPolicyAction,
  type SharePolicyAction,
} from "./policyRules";

export interface PolicyState extends PolicyDecisionSnapshot {
  /** Account whose policy is represented by this renderer state. */
  accountId: string | null;
  authGeneration: number | null;
  revision: number;
  policyUpdatedAt: string | null;
  endpointSupported: boolean | null;
  /** True once the org enforces a policy on this user. */
  managed: boolean;
  /** True after the first fetch resolves from the network, cache, or an error. */
  loaded: boolean;
  fetchPolicy: (
    accountId: string,
    authGeneration: number,
    reason?: "default" | "recovery"
  ) => Promise<void>;
  clearPolicy: () => void;
}

// Several components mount useAuth at startup; share one in-flight fetch
// between them instead of hitting the API once per consumer.
let fetchInFlight: {
  accountId: string;
  authGeneration: number;
  promise: Promise<void>;
} | null = null;
let fetchSequence = 0;
let lifecycleListenersReady = false;
let appVersionPromise: Promise<string | null> | null = null;

interface PolicyIpcSnapshot {
  success: boolean;
  status?: string;
  revision?: number;
  accountId?: string | null;
  authGeneration?: number | null;
  managed?: boolean;
  policy?: OrgPolicy | null;
  policyUpdatedAt?: string | null;
  endpointSupported?: boolean;
  code?: string;
  error?: string;
}

function readAppVersion(): Promise<string | null> {
  if (!appVersionPromise) {
    appVersionPromise =
      window.electronAPI
        .getAppVersion?.()
        .then((result) => result?.version ?? null)
        .catch((error) => {
          logger.error("Failed to read app version for workspace policy:", error);
          return null;
        }) ?? Promise.resolve(null);
  }
  return appVersionPromise;
}

function normalizeSnapshot(
  result: PolicyIpcSnapshot,
  current: PolicyState
): Required<
  Pick<
    PolicyIpcSnapshot,
    | "revision"
    | "accountId"
    | "authGeneration"
    | "managed"
    | "policy"
    | "policyUpdatedAt"
    | "endpointSupported"
  >
> {
  return {
    revision: result.revision ?? current.revision + 1,
    // A mixed new-renderer/old-main response has no credential identity. It
    // must never inherit the renderer's requested account or generation,
    // because an older main may be returning a global cache from another user.
    accountId: result.accountId ?? null,
    authGeneration: result.authGeneration ?? null,
    managed: Boolean(result.managed),
    policy: result.policy ?? null,
    policyUpdatedAt: result.policyUpdatedAt ?? null,
    endpointSupported: result.endpointSupported !== false,
  };
}

function applyPolicySnapshot(result: PolicyIpcSnapshot, appVersion: string | null): boolean {
  const current = usePolicyStore.getState();
  const snapshot = normalizeSnapshot(result, current);
  if (
    !current.accountId ||
    current.authGeneration == null ||
    snapshot.accountId !== current.accountId ||
    snapshot.authGeneration !== current.authGeneration ||
    !shouldAcceptPolicySnapshot(
      {
        accountId: current.accountId,
        authGeneration: current.authGeneration,
        revision: current.revision,
      },
      {
        accountId: snapshot.accountId,
        authGeneration: snapshot.authGeneration,
        revision: snapshot.revision,
      }
    )
  ) {
    return false;
  }

  if (snapshot.managed && !snapshot.policy) return false;
  usePolicyStore.setState({
    accountId: snapshot.accountId,
    authGeneration: snapshot.authGeneration,
    revision: snapshot.revision,
    policyUpdatedAt: snapshot.policyUpdatedAt,
    endpointSupported: snapshot.endpointSupported,
    status: snapshot.managed ? "managed" : "unmanaged",
    managed: snapshot.managed,
    policy: snapshot.policy,
    appVersion,
    loaded: true,
  });
  return true;
}

function applyPolicyFailure(result: PolicyIpcSnapshot): boolean {
  const current = usePolicyStore.getState();
  if (
    result.code !== "POLICY_UNRESOLVABLE" ||
    !current.accountId ||
    current.authGeneration == null ||
    result.accountId !== current.accountId ||
    result.authGeneration !== current.authGeneration
  ) {
    return false;
  }
  if (current.status === "managed") return true;
  usePolicyStore.setState({
    status: "error",
    managed: false,
    policy: null,
    loaded: true,
  });
  return true;
}

function ensurePolicyLifecycleListeners(): void {
  if (lifecycleListenersReady) return;
  lifecycleListenersReady = true;
  window.electronAPI.onWorkspacePolicyChanged?.((snapshot) => {
    if (!snapshot.success) {
      applyPolicyFailure(snapshot);
      return;
    }
    void readAppVersion().then((appVersion) => applyPolicySnapshot(snapshot, appVersion));
  });
  const refreshResolvedPolicy = (): void => {
    const state = usePolicyStore.getState();
    const identity = resolvedPolicyRefreshIdentity(state);
    if (!identity) return;
    void state.fetchPolicy(identity.accountId, identity.authGeneration);
  };
  window.addEventListener("online", refreshResolvedPolicy);
  window.addEventListener("focus", refreshResolvedPolicy);
  window.setInterval(refreshResolvedPolicy, POLICY_SUCCESS_REFRESH_MS);
}

export const usePolicyStore = create<PolicyState>()((set, get) => ({
  accountId: null,
  authGeneration: null,
  revision: 0,
  policyUpdatedAt: null,
  endpointSupported: null,
  status: "idle",
  managed: false,
  policy: null,
  appVersion: null,
  loaded: false,
  fetchPolicy: (
    accountId: string,
    authGeneration: number,
    reason: "default" | "recovery" = "default"
  ): Promise<void> => {
    ensurePolicyLifecycleListeners();
    if (fetchInFlight?.accountId === accountId && fetchInFlight.authGeneration === authGeneration) {
      return fetchInFlight.promise;
    }

    const previous = get();
    const sameIdentity =
      previous.accountId === accountId && previous.authGeneration === authGeneration;
    const preserveResolvedPolicy =
      sameIdentity && (previous.status === "managed" || previous.status === "unmanaged");
    const sequence = ++fetchSequence;
    if (!preserveResolvedPolicy) {
      set({
        accountId,
        authGeneration,
        revision: sameIdentity ? previous.revision : 0,
        policyUpdatedAt: null,
        endpointSupported: null,
        status: "loading",
        managed: false,
        policy: null,
        appVersion: null,
        loaded: false,
      });
    }

    const promise = (async () => {
      const versionPromise = readAppVersion();
      try {
        const result = await window.electronAPI.getWorkspacePolicy?.(
          accountId,
          authGeneration,
          reason
        );
        const appVersion = await versionPromise;
        if (sequence !== fetchSequence) return;
        if (result?.success) {
          if (applyPolicySnapshot(result, appVersion)) return;
          throw new Error("Workspace policy response did not match the active credential");
        }
        throw Object.assign(new Error(result?.error || "Workspace policy is unavailable"), {
          code: result?.code,
        });
      } catch (error) {
        if (sequence !== fetchSequence) return;
        logger.error("Failed to fetch workspace policy:", error);
        const current = get();
        const failureCode =
          error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : undefined;
        if (
          current.accountId === accountId &&
          shouldPreserveResolvedPolicyOnFailure(current.status, failureCode)
        ) {
          set({ loaded: true });
        } else {
          set({
            accountId,
            status: "error",
            managed: false,
            policy: null,
            appVersion: await versionPromise,
            loaded: true,
          });
        }
      } finally {
        if (
          fetchInFlight?.accountId === accountId &&
          fetchInFlight.authGeneration === authGeneration
        ) {
          fetchInFlight = null;
        }
      }
    })();

    fetchInFlight = { accountId, authGeneration, promise };
    return promise;
  },
  clearPolicy: (): void => {
    fetchSequence += 1;
    fetchInFlight = null;
    set({
      accountId: null,
      authGeneration: null,
      revision: 0,
      policyUpdatedAt: null,
      endpointSupported: null,
      status: "idle",
      managed: false,
      policy: null,
      appVersion: null,
      loaded: false,
    });
  },
}));

type PolicySelectorState = Pick<PolicyState, "status" | "policy" | "appVersion">;

export type TranscriptionPolicyContext = "dictation" | "meeting" | "upload";

function getTranscriptionSelection(
  settings: SettingsState,
  context: TranscriptionPolicyContext
): { mode: InferenceMode; provider: string } {
  if (context === "meeting") {
    return {
      mode: settings.meetingTranscriptionMode,
      provider: settings.meetingCloudTranscriptionProvider || settings.cloudTranscriptionProvider,
    };
  }
  if (context === "upload") {
    return {
      mode: settings.uploadTranscriptionMode,
      provider: settings.uploadCloudTranscriptionProvider || settings.cloudTranscriptionProvider,
    };
  }
  return {
    mode: settings.transcriptionMode,
    provider: settings.cloudTranscriptionProvider,
  };
}

export function isTranscriptionContextAllowed(
  state: PolicySelectorState,
  settings: SettingsState,
  context: TranscriptionPolicyContext
): boolean {
  return isTranscriptionSelectionAllowed(state, getTranscriptionSelection(settings, context));
}

export function isPolicyActionAllowed(state: PolicySelectorState): boolean {
  return isPolicyActionAllowedRule(state);
}

export function isDesktopActionAllowed(
  state: PolicySelectorState,
  action: DesktopPolicyAction
): boolean {
  return isDesktopActionAllowedRule(state, action);
}

export function isLlmSelectionAllowed(
  state: PolicySelectorState,
  mode: InferenceMode,
  provider: string
): boolean {
  return isLlmSelectionAllowedRule(state, { mode, provider });
}

/** Whether a transcription/LLM mode is allowed. Unmanaged users allow everything. */
export function isModeAllowed(
  state: PolicySelectorState,
  scope: PolicyScope,
  mode: InferenceMode
): boolean {
  return isModeAllowedByPolicy(state, scope, mode);
}

/** Whether a BYOK provider id is allowed for a scope. Unmanaged users allow everything. */
export function isProviderAllowed(
  state: PolicySelectorState,
  scope: PolicyScope,
  providerId: string
): boolean {
  return isProviderAllowedByPolicy(state, scope, providerId);
}

/** Whether an enterprise-cloud provider id is allowed. Unmanaged users allow everything. */
export function isEnterpriseProviderAllowed(
  state: PolicySelectorState,
  providerId: string
): boolean {
  if (!isPolicyActionAllowed(state)) return false;
  if (state.status !== "managed" || !state.policy) return true;
  return state.policy.llm.allowedEnterpriseProviders.includes(providerId);
}

/** Whether the AI agent (dictation, voice, and chat) is allowed. */
export function isAgentAllowed(state: PolicySelectorState): boolean {
  if (!isPolicyActionAllowed(state)) return false;
  if (state.status !== "managed" || !state.policy) return true;
  return state.policy.features.agentEnabled;
}

/** Whether the agent's web_search tool is allowed. */
export function isWebSearchAllowed(state: PolicySelectorState): boolean {
  if (!isPolicyActionAllowed(state)) return false;
  if (state.status !== "managed" || !state.policy) return true;
  return state.policy.features.webSearchEnabled;
}

/** Whether a note share visibility is allowed under the org's external-sharing mode. */
export function isShareVisibilityAllowed(
  state: PolicySelectorState,
  visibility: ShareVisibility
): boolean {
  return isShareVisibilityAllowedRule(state, visibility);
}

export function isShareActionAllowed(
  state: PolicySelectorState,
  action: SharePolicyAction,
  currentVisibility: ShareVisibility
): boolean {
  return isShareActionAllowedRule(state, action, currentVisibility);
}

/** The org-forced local history value, or null when the user may choose. */
export function lockedLocalHistoryValue(state: PolicySelectorState): boolean | null {
  if (state.status !== "managed" || !state.policy) return null;
  const mode = state.policy.dataRetention.localHistoryMode;
  if (mode === "always_on") return true;
  if (mode === "always_off") return false;
  return null;
}

/** The history setting used at runtime without overwriting the user's preference. */
export function effectiveLocalHistoryEnabled(
  state: PolicySelectorState,
  personalPreference: boolean
): boolean {
  return effectiveLocalHistoryEnabledRule(state, personalPreference);
}

/** Whether cloud backup/sync is allowed. */
export function isCloudBackupAllowed(state: PolicySelectorState): boolean {
  if (!isPolicyActionAllowed(state)) return false;
  if (state.status !== "managed" || !state.policy) return true;
  return state.policy.dataRetention.cloudBackupAllowed;
}

/** The org cap on audio retention days, or null when uncapped. */
export function maxAudioRetentionDays(state: PolicySelectorState): number | null {
  if (state.status !== "managed" || !state.policy) return null;
  return state.policy.dataRetention.audioRetentionMaxDays;
}

/** The audio retention period used at runtime without overwriting the user's preference. */
export function effectiveAudioRetentionDays(
  state: PolicySelectorState,
  personalPreference: number
): number {
  return effectiveAudioRetentionDaysRule(state, personalPreference);
}

/** Mark policy-disallowed mode options disabled with a "managed" badge. */
export function enforceModeOptions<
  T extends { id: InferenceMode; disabled?: boolean; badge?: string },
>(options: T[], scope: PolicyScope, state: PolicySelectorState, managedBadge: string): T[] {
  if (state.status === "idle" || state.status === "unmanaged") return options;
  return options.map((option) =>
    isModeAllowed(state, scope, option.id)
      ? option
      : { ...option, disabled: true, badge: managedBadge }
  );
}
