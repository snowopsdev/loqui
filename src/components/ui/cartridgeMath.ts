// Pure helpers for model cartridges (SET-R4 B). Tiers are estimates from file
// size unless the registry carries curated speedTier/qualityTier.

export interface CartridgeModel {
  id: string;
  name: string;
  sizeBytes?: number;
  contextLength?: number;
  recommended?: boolean;
  isDownloaded: boolean;
  isDownloading: boolean;
  isCancelling?: boolean;
  /** The archive is downloaded and unpacking: cancelling is no longer possible. */
  isInstalling?: boolean;
  progress?: number;
  speedTier?: number;
  qualityTier?: number;
  /** Short extra fact, already translated (for example an import's load status). */
  badge?: string;
  /** Model card or documentation link, with its already-translated label. */
  href?: string;
  hrefLabel?: string;
}

export type Fit = "comfortable" | "tight" | "tooLarge" | "unknown";

const GB = 1_000_000_000;
const bucket = (bytes: number, edges: number[]) => {
  const i = edges.findIndex((edge) => bytes <= edge * GB);
  return i === -1 ? edges.length + 1 : i + 1;
};

export function estimateTiers(m: Pick<CartridgeModel, "sizeBytes" | "speedTier" | "qualityTier">) {
  const size = m.sizeBytes;
  const memory = size ? bucket(size, [1.5, 3, 5, 8]) : null;
  const sizeSpeed = size ? 6 - bucket(size, [1, 2, 4, 8]) : null;
  const sizeQuality = size ? Math.min(5, bucket(size, [1, 2, 4, 8]) + 1) : null;
  return {
    speed: m.speedTier ?? sizeSpeed,
    quality: m.qualityTier ?? sizeQuality,
    memory,
    // Memory is always size-derived when shown, even with curated speed/quality.
    // Without a size, no size-derived meter is visible.
    estimated: memory !== null,
  };
}

export function estimateRamBytes(sizeBytes: number): number {
  return sizeBytes * 1.15;
}

export function fitFor(sizeBytes: number | undefined, totalMemoryBytes: number | null): Fit {
  if (!sizeBytes || !totalMemoryBytes) return "unknown";
  const share = estimateRamBytes(sizeBytes) / totalMemoryBytes;
  if (share < 0.4) return "comfortable";
  return share <= 0.7 ? "tight" : "tooLarge";
}

export function sortForDisplay<T extends Pick<CartridgeModel, "recommended" | "sizeBytes">>(
  models: T[]
): T[] {
  return models
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      if (!!a.m.recommended !== !!b.m.recommended) return a.m.recommended ? -1 : 1;
      const sa = a.m.sizeBytes ?? Number.POSITIVE_INFINITY;
      const sb = b.m.sizeBytes ?? Number.POSITIVE_INFINITY;
      return sa === sb ? a.i - b.i : sa - sb;
    })
    .map(({ m }) => m);
}

export function visibleModels<T extends Pick<CartridgeModel, "id">>(
  sorted: T[],
  selectedId: string,
  expanded: boolean,
  limit = 5
): T[] {
  if (expanded || sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit);
  const selected = sorted.find((m) => m.id === selectedId);
  return selected && !head.includes(selected) ? [...head, selected] : head;
}

export interface LocalModelFacts {
  id: string;
  name: string;
  sizeBytes?: number;
  contextLength?: number;
  recommended?: boolean;
  speedTier?: number;
  qualityTier?: number;
}

export interface CartridgeState {
  downloaded: boolean;
  downloading: boolean;
  cancelling?: boolean;
  installing?: boolean;
  progress?: number;
  badge?: string;
  href?: string;
  hrefLabel?: string;
}

// The one place a picker's model becomes a cartridge, so context length and
// curated tiers cannot be dropped by a hand-written mapper.
export function cartridgeFromLocalModel(
  model: LocalModelFacts,
  state: CartridgeState
): CartridgeModel {
  return {
    id: model.id,
    name: model.name,
    sizeBytes: model.sizeBytes,
    contextLength: model.contextLength,
    recommended: model.recommended,
    speedTier: model.speedTier,
    qualityTier: model.qualityTier,
    isDownloaded: state.downloaded,
    isDownloading: state.downloading,
    isCancelling: state.cancelling,
    isInstalling: state.installing,
    progress: state.progress,
    badge: state.badge,
    href: state.href,
    hrefLabel: state.hrefLabel,
  };
}

// Which tasks already run on each model: device routes that are not turned off,
// matched by display name or id (the resolver reports the model it resolved).
export function usedByMap(
  models: readonly Pick<CartridgeModel, "id" | "name">[],
  routes: readonly {
    id: string;
    locality: string;
    model: string | null;
    state: { status: string };
  }[],
  taskName: (routeId: string) => string
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const model of models) {
    const tasks = routes
      .filter(
        (route) =>
          route.locality === "device" &&
          route.state.status !== "off" &&
          (route.model === model.name || route.model === model.id)
      )
      .map((route) => taskName(route.id));
    if (tasks.length) map[model.id] = tasks;
  }
  return map;
}
