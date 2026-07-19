// Reactive view over the localStorage capability flag the sync probe writes:
// same-window flips notify subscribers; cross-window ones ride the storage event.
const CAPABILITY_KEY = "teamSpacesCapability";

const subscribers = new Set<() => void>();

export function readTeamSpacesCapability(): boolean {
  return localStorage.getItem(CAPABILITY_KEY) === "true";
}

export function notifyTeamSpacesCapabilityChanged(): void {
  subscribers.forEach((notify) => notify());
}

export function subscribeTeamSpacesCapability(onChange: () => void): () => void {
  subscribers.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === CAPABILITY_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    subscribers.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}
