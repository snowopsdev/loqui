// Plan 07 (spec §5.1 "Native availability", D14/D15): projects main's
// attestation onto each route's selected built-in native engines. Pure and
// Node-loadable: no store, no IPC. The facade (routes.ts) and the dictation
// pre-flight (sealedMode.ts) call it with the sole sealedStore attestation, so
// Ready, route cards and pre-flight read the same facts.
//
// 07a has no verified native boundary on any platform: main's attestation
// always reports `isolation.selfTest: "unavailable"`, `nothingLeaves: false`
// and `childDiagnostics.nativeBoundaryUnavailable`. That is a positive,
// settled answer (A14, fix round 1): a route that needs one of Loqui's own
// engines is "unavailable" while sealed on this build. It claims no isolation
// and no pause. Only a missing or stale attestation is "unknown". Nothing here
// can produce "available". "paused" (main-acknowledged refusal or confirmed
// whole-tree stop) and "pending" (a live draining tree) need 07b's lifecycle
// facts and are not produced yet. An empty child list, a test fixture or a
// self-test result is never evidence of availability.
import {
  nativeEngineRequirements,
  ROUTE_IDS,
  type NativeEngine,
  type NativeRouteAvailability,
  type RouteId,
  type RouteSettingsSnapshot,
} from "./routeGraph.ts";
import { isAttestationFresh } from "./attestationFreshness.ts";
import type { Attestation } from "../types/privacy";

const NOT_REQUIRED: NativeRouteAvailability = Object.freeze({ status: "notRequired" });
const UNKNOWN: NativeRouteAvailability = Object.freeze({ status: "unknown" });
const UNAVAILABLE: NativeRouteAvailability = Object.freeze({
  status: "unavailable",
  reason: "isolation",
});

// Main says, in a claim that is still fresh, that this build has no native
// boundary. Either diagnostic is enough; neither can ever mean "available".
function attestsNoNativeBoundary(attestation: Attestation | null): boolean {
  if (!attestation || !isAttestationFresh(attestation)) return false;
  return (
    attestation.childDiagnostics?.nativeBoundaryUnavailable === true ||
    attestation.isolation?.selfTest === "unavailable"
  );
}

// Availability of one engine kind from main's attestation. 07a never yields
// "available", whatever the attestation says.
function engineAvailability(
  _engine: NativeEngine,
  attestation: Attestation | null
): NativeRouteAvailability {
  return attestsNoNativeBoundary(attestation) ? UNAVAILABLE : UNKNOWN;
}

// A route is only as available as its least available required engine.
const WORST_FIRST: readonly NativeRouteAvailability["status"][] = [
  "paused",
  "unavailable",
  "pending",
  "unknown",
];

export function nativeRouteAvailability(
  snapshot: RouteSettingsSnapshot,
  attestation: Attestation | null
): Readonly<Record<RouteId, NativeRouteAvailability>> {
  const out = {} as Record<RouteId, NativeRouteAvailability>;
  for (const id of ROUTE_IDS) {
    const engines = nativeEngineRequirements(snapshot, id);
    if (engines.length === 0) {
      out[id] = NOT_REQUIRED;
      continue;
    }
    const each = engines.map((engine) => engineAvailability(engine, attestation));
    out[id] = each.every((a) => a.status === "available")
      ? each[0]
      : (WORST_FIRST.map((status) => each.find((a) => a.status === status)).find(Boolean) ??
        UNKNOWN);
  }
  return Object.freeze(out);
}

// A new snapshot whose facts carry the projection; the input is not mutated.
export function withNativeRouteAvailability(
  snapshot: RouteSettingsSnapshot,
  attestation: Attestation | null
): RouteSettingsSnapshot {
  return {
    ...snapshot,
    facts: {
      ...snapshot.facts,
      nativeAvailability: nativeRouteAvailability(snapshot, attestation),
    },
  };
}
