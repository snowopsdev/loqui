import { useEffect, useReducer, useRef, useState } from "react";
import { INITIAL_KEYCAP, reduceKeycap } from "../../utils/onboardingShortcut";
import type { DictationBinding } from "../../types/electron";

export function bindingMatches(
  a: DictationBinding | null | undefined,
  b: DictationBinding | null | undefined
): boolean {
  return !!a && !!b && a.hotkey === b.hotkey && a.activationMode === b.activationMode;
}

/** Query the registered main slot, never infer acknowledgement from preferences. */
export function useDictationHotkey(active: boolean, expected?: DictationBinding) {
  const [state, dispatch] = useReducer(reduceKeycap, INITIAL_KEYCAP);
  const [ack, setAck] = useState<DictationBinding | null>(null);
  const latest = useRef({ active, expected });
  latest.current = { active, expected };
  const key = expected ? JSON.stringify(expected) : "";
  useEffect(() => {
    let live = true;
    dispatch({ phase: "reset", at: 0 });
    setAck(null);
    if (!active) return;
    const api = window.electronAPI;
    try {
      void Promise.resolve(api?.getDictationBinding?.())
        .then((binding) => {
          if (live && binding && bindingMatches(binding, latest.current.expected)) setAck(binding);
        })
        .catch(() => {});
    } catch {
      /* Missing acknowledgement leaves the binding unproven. */
    }
    const off = api?.onDictationHotkeyEvent?.((event) => {
      if (
        !live ||
        !latest.current.active ||
        !bindingMatches(event.binding, latest.current.expected)
      )
        return;
      setAck(event.binding!);
      dispatch(event);
    });
    return () => {
      live = false;
      if (typeof off === "function") off();
    };
  }, [active, key]);
  const acknowledged = active && bindingMatches(ack, expected) ? ack : null;
  return { ...(acknowledged ? state : INITIAL_KEYCAP), binding: acknowledged };
}

let shortcutDemoSequence = 0;

/** A shortcut demo only mirrors presses through the existing main owner. */
export function useShortcutDemo(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const api = window.electronAPI;
    // A partial preload must not open a demo it cannot release.
    if (
      typeof api?.beginOnboardingDemo !== "function" ||
      typeof api.endOnboardingDemo !== "function"
    )
      return;
    const id = `onboarding-shortcut-${++shortcutDemoSequence}-${crypto.randomUUID()}`;
    let begun: Promise<unknown>;
    try {
      begun = Promise.resolve(api.beginOnboardingDemo({ id, kind: "shortcut" })).catch(() => false);
    } catch {
      begun = Promise.resolve(false);
    }
    return () => {
      // IPC may have applied a begin whose acknowledgement was refused/lost.
      // Await it, then end only this id; main fences off any newer owner.
      void begun.then(async () => {
        try {
          await api.endOnboardingDemo(id);
        } catch {
          // The original main owner is unavailable. Never cancel another demo.
        }
      });
    };
  }, [active]);
}
