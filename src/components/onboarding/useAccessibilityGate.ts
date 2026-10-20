import { useCallback, useEffect, useRef, useState } from "react";
import { useRecheckOnFocus } from "./useRecheckOnFocus";

export function useAccessibilityGate(platform: "darwin" | "linux" | "win32", active: boolean) {
  const [granted, setGranted] = useState<boolean | null>(null);
  const latest = useRef({ platform, active });
  latest.current = { platform, active };
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const observation = useRef(0);
  const check = useCallback(async () => {
    const generation = lifetime.current;
    const request = ++observation.current;
    if (
      !mounted.current ||
      platform !== "darwin" ||
      latest.current.platform !== platform ||
      !latest.current.active
    )
      return;
    let ok = false;
    try {
      ok = (await window.electronAPI?.checkAccessibilityPermission?.(true)) === true;
    } catch {
      /* Unknown is not granted. */
    }
    if (
      !mounted.current ||
      generation !== lifetime.current ||
      request !== observation.current ||
      !latest.current.active ||
      latest.current.platform !== platform
    )
      return;
    setGranted(ok);
    if (ok) {
      try {
        await window.electronAPI?.markMacAccessibilityFeaturesReady?.(null);
      } catch {
        /* Observation must never reject into a timer. */
      }
    }
  }, [platform]);
  useEffect(() => {
    lifetime.current += 1;
    mounted.current = active;
    setGranted(null);
    if (active) void check();
    return () => {
      mounted.current = false;
      lifetime.current += 1;
      observation.current += 1;
    };
  }, [active, platform, check]);
  useRecheckOnFocus(check, active && platform === "darwin" && granted !== true);
  const request = useCallback(() => {
    if (!mounted.current || !latest.current.active || latest.current.platform !== "darwin") return;
    try {
      void Promise.resolve(window.electronAPI?.openAccessibilitySettings?.()).catch(() => {});
    } catch {
      /* unavailable */
    }
  }, []);
  return { granted: platform === "darwin" ? (active ? granted : null) : true, request };
}
