import logger from "./logger";
import { getSettings } from "../stores/settingsStore";

// VO-R10 A "Soft family": sine + 2nd harmonic (-14 dB), 4 ms attack,
// exponential decay with a 40 ms tail, base gain 0.12. "Classic" keeps the
// two cues Loqui shipped before (gain 0.2), so nobody's ear is retrained by
// surprise. Notes: { freq, at (ms), dur (ms), glideTo?, gain? }.
/** @typedef {"start" | "stop" | "success" | "cancel" | "error" | "back"} CueName */
const n = (freq, at, dur, extra = {}) => Object.freeze({ freq, at, dur, ...extra });

export const CUE_SETS = Object.freeze({
  soft: Object.freeze({
    start: [n(659.25, 0, 60), n(987.77, 80, 90)],
    stop: [n(987.77, 0, 60), n(659.25, 70, 110)],
    success: [n(783.99, 0, 120), n(1046.5, 0, 120)],
    cancel: [n(440, 0, 140, { glideTo: 349.23, gain: 0.08 })],
    error: [n(293.66, 0, 110, { gain: 0.1 }), n(220, 120, 160, { gain: 0.1 })],
    back: [n(659.25, 0, 80)],
  }),
  classic: Object.freeze({
    start: [n(523.25, 0, 90, { gain: 0.2 }), n(659.25, 115, 90, { gain: 0.2 })],
    stop: [n(587.33, 0, 90, { gain: 0.2 }), n(440, 115, 90, { gain: 0.2 })],
    success: null,
    cancel: null,
    error: null,
    back: null,
  }),
});

export const CUE_VOLUME = Object.freeze({ low: 0.5, medium: 1, high: 1.4 });

const SOFT_GAIN = 0.12;
const HARMONIC_WEIGHT = 0.2; // -14 dB
const MIN_GAIN = 0.0001;

let audioContext = null;

const getAudioContext = () => {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext || audioContext.state === "closed") audioContext = new Ctor();
  return audioContext;
};

const resumeContextIfNeeded = async () => {
  try {
    const context = getAudioContext();
    if (!context) return null;
    if (context.state === "suspended") await context.resume();
    return context.state === "running" ? context : null;
  } catch (error) {
    logger.debug(
      "Failed to initialize dictation cue audio context",
      { error: String(error?.message ?? error) },
      "audio"
    );
    return null;
  }
};

function scheduleTone(context, { freq, dur, glideTo, gain }, startTime, volume, setName) {
  const soft = setName === "soft";
  const peak = (gain ?? (soft ? SOFT_GAIN : 0.2)) * volume;
  const attack = soft ? 0.004 : 0.015;
  const end = startTime + dur / 1000;
  const partials = soft
    ? [
        [1, 1],
        [2, HARMONIC_WEIGHT],
      ]
    : [[1, 1]];
  for (const [mult, weight] of partials) {
    const osc = context.createOscillator();
    const env = context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * mult, startTime);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo * mult, end);
    env.gain.setValueAtTime(MIN_GAIN, startTime);
    env.gain.linearRampToValueAtTime(peak * weight, startTime + attack);
    env.gain.exponentialRampToValueAtTime(MIN_GAIN, end + (soft ? 0.04 : 0));
    osc.connect(env);
    env.connect(context.destination);
    osc.start(startTime);
    osc.stop(end + 0.06);
  }
  return partials.length;
}

export function scheduleCue(context, setName, cue, volumeName) {
  const notes = CUE_SETS[setName]?.[cue];
  if (!notes) return 0;
  const volume = CUE_VOLUME[volumeName] ?? 1;
  const base = context.currentTime + 0.02;
  return notes.reduce(
    (count, note) => count + scheduleTone(context, note, base + note.at / 1000, volume, setName),
    0
  );
}

const playCue = async (cue) => {
  try {
    const settings = getSettings();
    if (!settings.audioCuesEnabled) return;
    const context = await resumeContextIfNeeded();
    if (!context) return;
    scheduleCue(
      context,
      settings.dictationCueSet === "classic" ? "classic" : "soft",
      cue,
      settings.dictationCueVolume ?? "medium"
    );
  } catch (error) {
    logger.debug(
      "Failed to play dictation cue",
      { error: String(error?.message ?? error) },
      "audio"
    );
  }
};

export const playStartCue = () => playCue("start");
export const playStopCue = () => playCue("stop");
export const playSuccessCue = () => playCue("success");
export const playCancelCue = () => playCue("cancel");
export const playErrorCue = () => playCue("error");
export const playMicBackCue = () => playCue("back");
