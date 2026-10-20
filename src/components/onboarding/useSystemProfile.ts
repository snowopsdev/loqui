import { useEffect, useState } from "react";
import type { SystemFacts, SystemProfile } from "../../types/electron";

function fallbackFacts(): SystemFacts {
  const languages = typeof navigator !== "undefined" ? [...(navigator.languages ?? [])] : [];
  return { locales: languages, freeDiskBytes: null, gpu: { kind: "unknown", name: null } };
}

// Total memory is Plan 03's get-total-memory (§5.1): the same main value, no second channel.
async function totalMemory(): Promise<number | null> {
  try {
    const bytes = await window.electronAPI?.getTotalMemory?.();
    return typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0 ? bytes : null;
  } catch {
    return null;
  }
}

async function facts(): Promise<SystemFacts> {
  try {
    return (await window.electronAPI?.getSystemProfile?.()) ?? fallbackFacts();
  } catch {
    return fallbackFacts();
  }
}

/** Spec D8: hardware and OS locale, read once per setup. */
export function useSystemProfile(): SystemProfile | null {
  const [profile, setProfile] = useState<SystemProfile | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [base, totalMemoryBytes] = await Promise.all([facts(), totalMemory()]);
      if (alive) setProfile({ ...base, totalMemoryBytes });
    })();
    return () => {
      alive = false;
    };
  }, []);
  return profile;
}
