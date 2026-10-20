import { useEffect, useState } from "react";

const COMPLETED_KEY = "onboardingCompleted";

/** Until setup completes every recording is private. Missing/denied storage fails closed. */
export function isSetupIncomplete(storage?: Pick<Storage, "getItem">): boolean {
  try {
    return (storage ?? globalThis.localStorage)?.getItem(COMPLETED_KEY) !== "true";
  } catch {
    return true;
  }
}

export function useSetupIncomplete(): boolean {
  const [incomplete, setIncomplete] = useState(() => isSetupIncomplete());
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === COMPLETED_KEY) setIncomplete(isSetupIncomplete());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return incomplete;
}
