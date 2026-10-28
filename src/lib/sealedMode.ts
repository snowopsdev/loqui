import {
  buildRouteSnapshot,
  currentRouteCopy,
  nativeEngineRequirements,
  resolveRoute,
  type RouteSettingsSnapshot,
} from "./routes";
import { useRouteFactsStore } from "../stores/routeFactsStore";
import type { SealedSnapshot } from "../stores/sealedStore";

type Settings = Parameters<typeof buildRouteSnapshot>[0];

// The dictation pre-flight. It adds no rule of its own: it asks Plan 03's
// graph, which applies isSealedLocality, rule 10's needsUrl precedence and the
// native availability overlay with the same facts Ready and route cards use.
// Only a known seal (true) blocks; unknown (null) claims nothing, because main
// enforces the seal either way.
function sealedDictation(settings: Settings, snapshot: SealedSnapshot): RouteSettingsSnapshot {
  return buildRouteSnapshot(
    settings,
    useRouteFactsStore.getState().facts,
    currentRouteCopy(),
    true,
    snapshot.attestation
  );
}

// While sealed, a dictation whose speech route leaves this computer is not
// started, so there is no recording for main to refuse afterwards.
export function isDictationSealed(settings: Settings, sealed: boolean | null): boolean {
  if (sealed !== true) return false;
  const { state } = resolveRoute(
    sealedDictation(settings, { sealed: true, attestation: null }),
    "dictationStt"
  );
  return state.status === "unreachable" && state.detail === "sealed";
}

// Only main's acknowledged pause (07b): a refused launch or a confirmed
// whole-tree stop of the selected engine. 07a's attestation has none.
export function isDictationPausedNative(settings: Settings, snapshot: SealedSnapshot): boolean {
  if (snapshot.sealed !== true) return false;
  const s = sealedDictation(settings, snapshot);
  return (
    nativeEngineRequirements(s, "dictationStt").length > 0 &&
    s.facts.nativeAvailability?.dictationStt?.status === "paused"
  );
}

// The selected built-in speech engine is paused, pending or not verified
// available while sealed. A user's own loopback server needs none of Loqui's
// engines; a remote route is isDictationSealed's case.
export function isDictationNativeUnavailable(
  settings: Settings,
  snapshot: SealedSnapshot
): boolean {
  if (snapshot.sealed !== true) return false;
  const s = sealedDictation(settings, snapshot);
  if (nativeEngineRequirements(s, "dictationStt").length === 0) return false;
  return s.facts.nativeAvailability?.dictationStt?.status !== "available";
}

// Main's fresh attestation says this build's engines do not run while sealed
// (A14, fix round 1): the same fact the graph publishes as
// unreachable/nativeUnavailable. False for a missing or stale claim, which the
// route cards show as Checking… and the pre-flight still refuses.
export function isDictationNativeAttestedUnavailable(
  settings: Settings,
  snapshot: SealedSnapshot
): boolean {
  if (snapshot.sealed !== true) return false;
  const s = sealedDictation(settings, snapshot);
  if (nativeEngineRequirements(s, "dictationStt").length === 0) return false;
  return s.facts.nativeAvailability?.dictationStt?.status === "unavailable";
}
