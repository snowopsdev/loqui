import { useEffect, useState } from "react";

// Total system memory in bytes, for the "too large for this device" check on
// model cartridges. null until main answers, and null if it cannot (browser
// preview, older preload): the grid then makes no fit claim at all.
export function useTotalMemory(): number | null {
  const [totalMemory, setTotalMemory] = useState<number | null>(null);
  useEffect(() => {
    let mounted = true;
    const read = window.electronAPI?.getTotalMemory?.();
    if (read) {
      read.then(
        (bytes) => {
          if (mounted) setTotalMemory(Number.isFinite(bytes) && bytes > 0 ? bytes : null);
        },
        () => {
          if (mounted) setTotalMemory(null);
        }
      );
    }
    return () => {
      mounted = false;
    };
  }, []);
  return totalMemory;
}
