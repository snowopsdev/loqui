import { create } from "zustand";
import {
  clearManagedEnterpriseIdentity,
  getManagedEnterpriseConfig,
} from "../services/EnterpriseIdentityService";
import type {
  EnterpriseSetupMode,
  ManagedEnterpriseConfig,
  ManagedEnterpriseScopeResolution,
} from "../types/enterpriseIdentity";
import type { InferenceScope } from "../config/inferenceScopes";
import logger from "../utils/logger";
import { resolveManagedEnterpriseScope } from "../helpers/enterpriseManagedConfig.mjs";
import { isLlmSelectionAllowed } from "./policyRules";
import { usePolicyStore } from "./policyStore";

interface EnterpriseIdentityState {
  accountId: string | null;
  workspaceId: string | null;
  authGeneration: number | null;
  status: "idle" | "loading" | "ready" | "error";
  config: ManagedEnterpriseConfig | null;
  error: string | null;
  refresh: (accountId: string, workspaceId: string, authGeneration: number) => Promise<void>;
  clear: () => void;
}

let requestSequence = 0;
let inFlightKey: string | null = null;
let inFlightPromise: Promise<void> | null = null;

export const useEnterpriseIdentityStore = create<EnterpriseIdentityState>((set, get) => ({
  accountId: null,
  workspaceId: null,
  authGeneration: null,
  status: "idle",
  config: null,
  error: null,

  refresh: (accountId, workspaceId, authGeneration) => {
    const key = `${accountId}:${workspaceId}:${authGeneration}`;
    if (inFlightKey === key && inFlightPromise) return inFlightPromise;
    const sequence = ++requestSequence;
    const current = get();
    const sameIdentity =
      current.accountId === accountId &&
      current.workspaceId === workspaceId &&
      current.authGeneration === authGeneration;
    set({
      accountId,
      workspaceId,
      authGeneration,
      status: sameIdentity && current.config ? "ready" : "loading",
      config: sameIdentity ? current.config : null,
      error: null,
    });

    const promise = (async () => {
      try {
        const result = await getManagedEnterpriseConfig(accountId, workspaceId, authGeneration);
        if (sequence !== requestSequence) return;
        if (
          !result.success ||
          result.accountId !== accountId ||
          result.workspaceId !== workspaceId ||
          result.authGeneration !== authGeneration
        ) {
          throw new Error(result.error || "Managed enterprise AI configuration is unavailable.");
        }
        set({ status: "ready", config: result.config ?? null, error: null });
      } catch (error) {
        if (sequence !== requestSequence) return;
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("Managed enterprise AI configuration unavailable", { error: message }, "auth");
        set((state) => ({
          status: "error",
          config: state.config,
          error: message,
        }));
      } finally {
        if (inFlightKey === key) {
          inFlightKey = null;
          inFlightPromise = null;
        }
      }
    })();
    inFlightKey = key;
    inFlightPromise = promise;
    return promise;
  },

  clear: () => {
    requestSequence += 1;
    inFlightKey = null;
    inFlightPromise = null;
    clearManagedEnterpriseIdentity();
    set({
      accountId: null,
      workspaceId: null,
      authGeneration: null,
      status: "idle",
      config: null,
      error: null,
    });
  },
}));

function resolveScope(
  config: ManagedEnterpriseConfig | null,
  scope: InferenceScope,
  setupMode: EnterpriseSetupMode
): ManagedEnterpriseScopeResolution {
  const resolution = resolveManagedEnterpriseScope(
    config,
    scope,
    setupMode
  ) as ManagedEnterpriseScopeResolution;
  // Managed access and the provider allowlist are separate admin pages, so a workspace can end up
  // pointing at a provider its own policy forbids. Leave the employee on their own configuration
  // rather than failing every request on policy; policy still governs whatever they fall back to.
  if (
    resolution.kind === "managed" &&
    !isLlmSelectionAllowed(usePolicyStore.getState(), {
      mode: "enterprise",
      provider: resolution.provider,
    })
  ) {
    logger.warn(
      "Managed enterprise provider is blocked by workspace policy; using local configuration",
      { provider: resolution.provider, scope },
      "auth"
    );
    return { kind: "manual" };
  }
  return resolution;
}

/** Imperative reads (services, stores). Components should use useManagedScopeResolution. */
export function getManagedScopeResolution(
  scope: InferenceScope,
  setupMode: EnterpriseSetupMode
): ManagedEnterpriseScopeResolution {
  return resolveScope(useEnterpriseIdentityStore.getState().config, scope, setupMode);
}

/** Subscribes to the managed config so the UI re-renders when an administrator changes it. */
export function useManagedScopeResolution(
  scope: InferenceScope,
  setupMode: EnterpriseSetupMode
): ManagedEnterpriseScopeResolution {
  return resolveScope(
    useEnterpriseIdentityStore((state) => state.config),
    scope,
    setupMode
  );
}
