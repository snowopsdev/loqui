// Plan 07 (spec §5.1 "Native availability", D14/D15): projects main's
// attestation onto each route's selected built-in native engines. Pure and
// Node-loadable: no store, no IPC. The facade (routes.ts) and the dictation
// pre-flight (sealedMode.ts) call it with the sole sealedStore attestation, so
// Ready, route cards and pre-flight read the same facts.
//
// 07a has no verified native boundary on any platform: main's attestation
// always reports `isolation.selfTest: "unavailable"`, `nothingLeaves: false`
// and `childDiagnostics.nativeBoundaryUnavailable`. A route that needs one of
// Loqui's own engines is therefore "unknown" while sealed; nothing here can
// produce "available". "paused" (main-acknowledged refusal or confirmed
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
import type { Attestation } from "../types/privacy";

const NOT_REQUIRED: NativeRouteAvailability = Object.freeze({ status: "notRequired" });
const UNVERIFIED: NativeRouteAvailability = Object.freeze({
  status: "unknown",
  reason: "isolation",
});

// Availability of one engine kind from main's attestation. 07a: always
// unverified, whatever the attestation says (including no attestation).
function engineAvailability(
  _engine: NativeEngine,
  _attestation: Attestation | null
): NativeRouteAvailability {
  return UNVERIFIED;
}

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
    // A route is only as available as its least available required engine.
    const each = engines.map((engine) => engineAvailability(engine, attestation));
    out[id] = each.every((a) => a.status === "available")
      ? each[0]
      : (each.find((a) => a.status !== "available") ?? UNVERIFIED);
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
