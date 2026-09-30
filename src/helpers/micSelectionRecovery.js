import { getSettings } from "../stores/settingsStore";
import logger from "../utils/logger";
import { resolveMicDeviceSelection } from "./micDeviceSelection";

// Chromium's "default" pseudo-device is a follow-the-OS-default selection, not a pin.
export function followsSystemDefaultMic({
  microphoneSelectionMode,
  preferBuiltInMic,
  selectedMicDeviceId,
}) {
  if (microphoneSelectionMode) return microphoneSelectionMode === "system";
  return !preferBuiltInMic && (!selectedMicDeviceId || selectedMicDeviceId === "default");
}
