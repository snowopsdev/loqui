import { formatHotkeyLabelForPlatform } from "./hotkeys";

export const HOLD_THRESHOLD_MS = 350;
export type PressStyle = "tap" | "hold";

export function pressStyle(downAtMs: number, upAtMs: number): PressStyle {
  return upAtMs - downAtMs >= HOLD_THRESHOLD_MS ? "hold" : "tap";
}

export interface KeycapState {
  pressed: boolean;
  downAtMs: number | null;
  lastStyle: PressStyle | null;
  presses: number;
}

export const INITIAL_KEYCAP: KeycapState = {
  pressed: false,
  downAtMs: null,
  lastStyle: null,
  presses: 0,
};

/**
 * Two sources can report one press (Task 4): the native listener sends down/up,
 * and globalShortcut sends a tap. A repeated down, or a tap while a native press
 * is held, is the same press (ONB-16).
 */
export function reduceKeycap(
  state: KeycapState,
  event: { phase: "down" | "up" | "tap" | "reset"; at: number }
): KeycapState {
  if (event.phase === "reset") return INITIAL_KEYCAP;
  if (event.phase === "down")
    return state.pressed ? state : { ...state, pressed: true, downAtMs: event.at };
  if (event.phase === "up") {
    if (!state.pressed || state.downAtMs === null) return state;
    return {
      pressed: false,
      downAtMs: null,
      lastStyle: pressStyle(state.downAtMs, event.at),
      presses: state.presses + 1,
    };
  }
  if (state.pressed) return state;
  // globalShortcut has no key-up: the press is a tap.
  return { pressed: false, downAtMs: null, lastStyle: "tap", presses: state.presses + 1 };
}

export function suggestActivationMode(
  current: "tap" | "push",
  style: PressStyle,
  pushSupported: boolean
): "tap" | "push" | null {
  if (style === "hold" && current === "tap" && pushSupported) return "push";
  if (style === "tap" && current === "push") return "tap";
  return null;
}

export function keycapLabel(hotkey: string, platform: "darwin" | "linux" | "win32"): string {
  if (/^(globe|fn)$/i.test(hotkey.trim())) return "fn";
  return formatHotkeyLabelForPlatform(hotkey, platform);
}
