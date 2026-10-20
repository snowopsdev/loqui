export type CleanupChoice = "none" | "local" | "codex" | "provider";
export type CleanupStatus =
  "checking" | "pending" | "ready" | "failed" | "skipped" | "review" | "modelSetup";

import type { SettingsPatch } from "../lib/providerSwitchPlans";
export interface CleanupSettings {
  cleanupModel: string;
}

export interface CleanupBridge {
  modelTestLoad?: (model: string) => Promise<{ success?: boolean } | undefined>;
  personalInference?: {
    codexModelCatalog?: () => Promise<{
      connected: boolean;
      data: Array<{ model: string; isDefault?: boolean }>;
    }>;
    credentialStatus: (ref: string) => Promise<{ configured?: boolean }>;
  };
}

/** Which model ids a cloud provider accepts, and the one it should start with. */
export interface CleanupModelCatalog {
  owns(provider: string, model: string): boolean;
  defaultModel(provider: string): string;
}

export interface ApplyCleanupChoiceOptions {
  choice: CleanupChoice;
  settings: CleanupSettings;
  bridge?: CleanupBridge;
  catalog: CleanupModelCatalog;
  setStatus: (status: CleanupStatus) => void;
  requestPatch: (patch: SettingsPatch) => Promise<"ready" | "review" | "failed">;
  /** False once the user has chosen something else; the result is then discarded. */
  isCurrent: () => boolean;
}

/** Availability checks never mutate settings. The sole route planner owns the
 * complete patch, its review, commit and exact Undo, including reused scopes. */
export async function applyCleanupChoice({
  choice,
  settings,
  bridge,
  catalog,
  setStatus,
  isCurrent,
  requestPatch,
}: ApplyCleanupChoiceOptions): Promise<void> {
  setStatus("checking");
  let patch: SettingsPatch;
  try {
    if (choice === "none") patch = { useCleanupModel: false };
    else if (choice === "local") {
      const model = "qwen3.5-2b-q4_k_m";
      const result = await bridge?.modelTestLoad?.(model);
      if (!isCurrent()) return;
      if (!result?.success) {
        setStatus("pending");
        return;
      }
      patch = {
        useCleanupModel: true,
        cleanupMode: "local",
        cleanupProvider: "local",
        cleanupModel: model,
      };
    } else if (choice === "codex") {
      const snapshot = await bridge?.personalInference?.codexModelCatalog?.();
      if (!isCurrent()) return;
      if (!snapshot?.connected) {
        setStatus("failed");
        return;
      }
      // No Codex shipped defaults exist. Only main's account-bound explicitly
      // discovered inventory can acknowledge ownership; never borrow cloud ids.
      const models = snapshot.data.filter((entry) => entry.model.trim());
      const model = models.some((entry) => entry.model === settings.cleanupModel)
        ? settings.cleanupModel
        : (models.find((entry) => entry.isDefault) ?? models[0])?.model;
      if (!model) {
        setStatus("modelSetup");
        return;
      }
      patch = {
        useCleanupModel: true,
        cleanupMode: "providers",
        cleanupProvider: "codex",
        cleanupModel: model,
      };
    } else {
      const status = await bridge?.personalInference?.credentialStatus("openai");
      if (!isCurrent()) return;
      const model = catalog.owns("openai", settings.cleanupModel)
        ? settings.cleanupModel
        : catalog.defaultModel("openai");
      if (!status?.configured || !model) {
        setStatus("failed");
        return;
      }
      patch = {
        useCleanupModel: true,
        cleanupMode: "providers",
        cleanupProvider: "openai",
        cleanupModel: model,
      };
    }
    if (!isCurrent()) return;
    const result = await requestPatch(patch);
    if (isCurrent()) setStatus(choice === "none" && result === "ready" ? "skipped" : result);
  } catch {
    if (isCurrent()) setStatus(choice === "local" ? "pending" : "failed");
  }
}
