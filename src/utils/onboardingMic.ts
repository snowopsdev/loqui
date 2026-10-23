import { isBuiltInMicrophone } from "./audioDeviceUtils";
import { resolveMicDeviceSelection } from "../helpers/micDeviceSelection";

// Hello's microphone picker over the same settings MicrophoneSettings writes,
// so the device chosen in setup is the one every dictation uses.
export type MicSelectionMode = "system" | "built-in" | "specific";

export interface AudioInput {
  deviceId: string;
  label: string;
  isBuiltIn: boolean;
}

export const SYSTEM_MIC = "__system__";
export const BUILT_IN_MIC = "__built-in__";
const PSEUDO_DEVICES = new Set(["default", "communications"]);

export function toAudioInputs(
  devices: ReadonlyArray<Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">>
): AudioInput[] {
  return devices
    .filter((device) => device.kind === "audioinput" && !PSEUDO_DEVICES.has(device.deviceId))
    .map((device) => ({
      deviceId: device.deviceId,
      label: device.label,
      isBuiltIn: isBuiltInMicrophone(device.label),
    }));
}

export interface MicPickerModel {
  value: string;
  previewDeviceId: string | null;
  hasBuiltIn: boolean;
  devices: AudioInput[];
  missing: boolean;
}

export function micPickerModel(
  devices: AudioInput[],
  mode: MicSelectionMode,
  selectedId: string,
  selectedLabel: string
): MicPickerModel {
  const builtIn = devices.find((device) => device.isBuiltIn) ?? null;
  const base = { hasBuiltIn: Boolean(builtIn), devices, missing: false };
  if (mode === "built-in" && builtIn)
    return { ...base, value: BUILT_IN_MIC, previewDeviceId: builtIn.deviceId };
  if (mode === "specific") {
    const resolved = resolveMicDeviceSelection(devices, selectedId, selectedLabel);
    if (resolved.device)
      return {
        ...base,
        value: resolved.device.deviceId,
        previewDeviceId: resolved.device.deviceId,
      };
    return {
      ...base,
      value: SYSTEM_MIC,
      previewDeviceId: null,
      missing: Boolean(selectedId) && devices.length > 0,
    };
  }
  return { ...base, value: SYSTEM_MIC, previewDeviceId: null };
}

export function selectionFor(
  value: string,
  devices: AudioInput[]
): { mode: MicSelectionMode; device: AudioInput | null } {
  if (value === SYSTEM_MIC) return { mode: "system", device: null };
  if (value === BUILT_IN_MIC) return { mode: "built-in", device: null };
  const device = devices.find((candidate) => candidate.deviceId === value) ?? null;
  return device ? { mode: "specific", device } : { mode: "system", device: null };
}
