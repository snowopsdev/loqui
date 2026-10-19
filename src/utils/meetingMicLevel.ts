import { getMicAnalyser, useMeetingRecordingStore } from "../stores/meetingRecordingStore";
import { analyserRms } from "./audioLevel";

// There is a single meeting mic analyser at a time.
const micLevelBuf: { current: Float32Array<ArrayBuffer> | null } = { current: null };

/** Live analyser input; LevelBars owns flooring and normalization. */
export function readMeetingMicLevel(): number {
  const analyser = getMicAnalyser();
  if (!analyser) return useMeetingRecordingStore.getState().currentMicLevel;
  return analyserRms(analyser, micLevelBuf);
}
