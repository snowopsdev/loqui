import type { LocalProvider } from "../components/LocalModelPicker";

// The registry's local model shape, reduced to what the pickers read. Every
// field the cartridge shows has to be named here and copied below, because the
// mapping is explicit: a field that is not forwarded never reaches the grid.
export interface RegistryLocalModel {
  id: string;
  name: string;
  size: string;
  sizeBytes: number;
  description: string;
  descriptionKey?: string;
  hfRepo?: string;
  recommended?: boolean;
  contextLength?: number;
  speedTier?: number;
  qualityTier?: number;
}

export interface RegistryLocalProvider {
  id: string;
  name: string;
  models: readonly RegistryLocalModel[];
}

export function toLocalProviders(providers: readonly RegistryLocalProvider[]): LocalProvider[] {
  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.name,
      size: model.size,
      sizeBytes: model.sizeBytes,
      description: model.description,
      descriptionKey: model.descriptionKey,
      specUrl: model.hfRepo ? `https://huggingface.co/${model.hfRepo}` : undefined,
      recommended: model.recommended,
      contextLength: model.contextLength,
      speedTier: model.speedTier,
      qualityTier: model.qualityTier,
    })),
  }));
}
