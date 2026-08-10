import { getSettings } from "../../stores/settingsStore";
import type { EnterpriseProvider } from "../../models/ModelRegistry";
import type { InferenceScope } from "../../config/inferenceScopes";
import type { ManagedEnterpriseRequestContext } from "../../types/enterpriseIdentity";
import { useEnterpriseIdentityStore } from "../../stores/enterpriseIdentityStore";

export type EnterpriseCallSettings = {
  apiKey: string;
  bedrockRegion: string;
  bedrockProfile: string;
  bedrockAccessKeyId: string;
  bedrockSecretAccessKey: string;
  bedrockSessionToken: string;
  azureEndpoint: string;
  azureApiVersion: string;
  vertexProject: string;
  vertexLocation: string;
  managedContext?: ManagedEnterpriseRequestContext;
};

export function getEnterpriseCallSettings(
  provider: EnterpriseProvider,
  inferenceScope: InferenceScope
): EnterpriseCallSettings {
  const s = getSettings();
  const managedState = useEnterpriseIdentityStore.getState();
  const managedContext =
    managedState.config &&
    managedState.accountId &&
    managedState.workspaceId &&
    managedState.authGeneration != null
      ? {
          accountId: managedState.accountId,
          workspaceId: managedState.workspaceId,
          authGeneration: managedState.authGeneration,
          setupMode: s.enterpriseSetupMode,
          inferenceScope,
        }
      : undefined;
  return {
    apiKey: provider === "azure" ? s.azureApiKey : provider === "vertex" ? s.vertexApiKey : "",
    bedrockRegion: s.bedrockRegion,
    bedrockProfile: s.bedrockProfile,
    bedrockAccessKeyId: s.bedrockAccessKeyId,
    bedrockSecretAccessKey: s.bedrockSecretAccessKey,
    bedrockSessionToken: s.bedrockSessionToken,
    azureEndpoint: s.azureEndpoint,
    azureApiVersion: s.azureApiVersion,
    vertexProject: s.vertexProject,
    vertexLocation: s.vertexLocation,
    managedContext,
  };
}
