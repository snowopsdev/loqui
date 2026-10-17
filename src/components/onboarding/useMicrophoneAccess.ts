import { useCallback, useEffect, useRef, useState } from "react";
import { useRecheckOnFocus } from "./useRecheckOnFocus";

export type MicAccess = "unknown" | "granted" | "denied";

export function micAccessFrom(
  result: { granted?: boolean; status?: string } | null | undefined
): MicAccess {
  if (result?.granted === true) return "granted";
  if (result?.status === "denied" || result?.status === "restricted") return "denied";
  return "unknown";
}

export function useMicrophoneAccess(): {
  access: MicAccess;
  check(): Promise<void>;
  request(): Promise<boolean>;
} {
  const [access, setAccess] = useState<MicAccess>("unknown");
  const mounted = useRef(false);
  const latest = useRef(0);
  const check = useCallback(async () => {
    if (!mounted.current) return;
    const operation = ++latest.current;
    let next: MicAccess = "unknown";
    try {
      next = micAccessFrom(await window.electronAPI?.checkMicrophoneAccess?.());
    } catch {
      // Failure to observe permission is not permission evidence.
    }
    if (mounted.current && operation === latest.current) setAccess(next);
  }, []);
  const request = useCallback(async () => {
    if (!mounted.current) return false;
    const operation = ++latest.current;
    let next: MicAccess = "unknown";
    try {
      const result = await window.electronAPI?.requestMicrophoneAccess?.();
      if (result?.granted === true) next = "granted";
      else if (result?.granted === false) next = "denied";
    } catch {
      // An absent or failed request leaves access unknown, never granted.
    }
    if (mounted.current && operation === latest.current) setAccess(next);
    return next === "granted";
  }, []);
  useEffect(() => {
    mounted.current = true;
    void check();
    return () => {
      mounted.current = false;
      // Pending replies cannot publish after this hook's lifetime ends.
    };
  }, [check]);
  useRecheckOnFocus(check, access === "denied");
  return { access, check, request };
}

/** macOS/Windows use microphone privacy; Linux uses the sound-input settings path. */
export async function openMicrophoneHelp(platform: "darwin" | "linux" | "win32"): Promise<unknown> {
  return platform === "linux"
    ? window.electronAPI?.openSoundInputSettings?.()
    : window.electronAPI?.openMicrophoneSettings?.();
}
