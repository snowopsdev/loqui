/**
 * Applies the cleanup choice made in onboarding. The connection or model check
 * is asynchronous (a local model load can take many seconds), so the user can
 * pick another option before it settles. A superseded check must never write
 * its outcome: activating cleanup for an option the user already left would
 * silently turn cleanup on after they chose "No cleanup".
 * Pure module so the ordering guarantee is unit-testable
 * (test/utils/onboardingCleanup.test.js).
 */
export type CleanupChoice = "none" | "local" | "codex" | "provider";
export type CleanupStatus = "checking" | "pending" | "ready" | "failed" | "skipped";

export interface CleanupSettings {
  cleanupModel: string;
  setUseCleanupModel(value: boolean): void;
  setCleanupMode(mode: "local" | "providers"): void;
  setCleanupProvider(provider: string): void;
  setCleanupModel(model: string): void;
}

export interface CleanupBridge {
  modelTestLoad?: (model: string) => Promise<{ success?: boolean } | undefined>;
  personalInference?: {
    codexStatus: () => Promise<{ available?: boolean; account?: { type?: string } | null }>;
    codexModels: () => Promise<{ data: Array<{ model: string; isDefault?: boolean }> }>;
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
  preview: boolean;
  scenario: string;
  setStatus: (status: CleanupStatus) => void;
  /** False once the user has chosen something else; the result is then discarded. */
  isCurrent: () => boolean;
}

export async function applyCleanupChoice({
  choice,
  settings,
  bridge,
  catalog,
  preview,
  scenario,
  setStatus,
  isCurrent,
}: ApplyCleanupChoiceOptions): Promise<void> {
  if (choice === "none") {
    settings.setUseCleanupModel(false);
    setStatus("skipped");
    return;
  }
  // Keep the choice visible while the connection/model check runs, but do not
  // activate cleanup until that check succeeds.
  settings.setUseCleanupModel(false);
  setStatus("checking");
  const settle = (ready: boolean, pending: CleanupStatus) => {
    if (!isCurrent()) return;
    if (ready) settings.setUseCleanupModel(true);
    setStatus(ready ? "ready" : pending);
  };
  if (choice === "local") {
    settings.setCleanupMode("local");
    settings.setCleanupProvider("local");
    settings.setCleanupModel("qwen3.5-2b-q4_k_m");
    if (preview) return settle(scenario === "ready", "pending");
    try {
      const result = await bridge?.modelTestLoad?.("qwen3.5-2b-q4_k_m");
      settle(Boolean(result?.success), "pending");
    } catch {
      settle(false, "pending");
    }
  } else if (choice === "codex") {
    settings.setCleanupMode("providers");
    settings.setCleanupProvider("codex");
    if (preview) return settle(scenario === "ready", "failed");
    try {
      const inference = bridge?.personalInference;
      const status = await inference?.codexStatus();
      if (!(status?.available && status.account?.type === "chatgpt"))
        return settle(false, "failed");
      // The stored cleanup model may still be the local default. Codex lists its
      // own models, so confirm one it serves instead of sending a foreign id.
      const { data } = (await inference?.codexModels()) ?? { data: [] };
      const model = data.some((item) => item.model === settings.cleanupModel)
        ? settings.cleanupModel
        : (data.find((item) => item.isDefault) ?? data[0])?.model;
      if (!model || !isCurrent()) return settle(false, "failed");
      settings.setCleanupModel(model);
      settle(true, "failed");
    } catch {
      settle(false, "failed");
    }
  } else {
    settings.setCleanupMode("providers");
    settings.setCleanupProvider("openai");
    // A model id left over from another provider would 404 on every request.
    const model = catalog.owns("openai", settings.cleanupModel)
      ? settings.cleanupModel
      : catalog.defaultModel("openai");
    if (preview) {
      if (model) settings.setCleanupModel(model);
      return settle(scenario === "ready", "failed");
    }
    try {
      const status = await bridge?.personalInference?.credentialStatus("openai");
      if (isCurrent() && status?.configured && model) settings.setCleanupModel(model);
      settle(Boolean(status?.configured && model), "failed");
    } catch {
      settle(false, "failed");
    }
  }
}
