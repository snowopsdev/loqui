import type { InferenceMode } from "../types/electron";

/** Keep the selected connection while showing only the task's supported modes. */
export function useInferenceModeOptions<T extends { id: InferenceMode; disabled?: boolean }>(
  options: T[],
  selectedMode: InferenceMode
) {
  return {
    modes: options,
    effectiveMode: selectedMode,
    isModeAllowed: (mode: InferenceMode) =>
      options.some((option) => option.id === mode && !option.disabled),
  };
}
