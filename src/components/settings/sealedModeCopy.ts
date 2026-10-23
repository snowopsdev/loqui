import type { Attestation } from "../../types/privacy";
import { isAttestationFresh } from "../../lib/attestationFreshness";

// What the Sealed mode panel may say (Plan 07a). This build has no native
// boundary on any platform, so there is no verified, isolated or paused state
// to show: main's claim is always unverified. The panel states the build's
// limit plainly, names the most fundamental unresolved fact from main's
// fresh attestation, and says "Checking" when that claim is missing or stale.
export type StatusTone = "neutral" | "warn";
export type StatusLine = {
  key: string;
  params?: Record<string, string | number>;
  tone: StatusTone;
};

const P = "settingsPage.privacy.sealed";

// Unicode isolates keep LTR program names intact inside RTL copy.
const isolate = (names: string[]) => `⁨${names.join(", ")}⁩`;

// Requests, transitions or hooks main asked to stop that did not confirm.
const STOP_FAILURES = new Set([
  "codexStop",
  "codexStopUnavailable",
  "childStop",
  "childStopUnavailable",
  "updatesPause",
  "updatesPauseUnavailable",
  "calendar:stop",
  "calendar:stopUnavailable",
  "calendarsUnavailable",
  "pendingCancel",
]);
// Main could not read whether its programs are still running.
const CHILD_STATUS_UNKNOWN = new Set([
  "childrenUnavailable",
  "childDiagnosticsUnavailable",
  "codexStatusUnavailable",
  "timeout:childrenUnknown",
  "timeout:codexStatusUnavailable",
]);
// Main read the status, and the programs were still running at the deadline
// (privacyBoot running()): work that hasn't confirmed it stopped (T14-M2).
const CHILD_STILL_RUNNING = new Set(["timeout:children", "timeout:codex"]);
// The one failure every 07a attestation carries; it is the build limit, which
// the panel states on its own line.
const BUILD_LIMIT = "NATIVE_BOUNDARY_UNAVAILABLE";

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

// The most fundamental unresolved fact first; one at a time.
function unresolvedCause(a: Attestation): StatusLine | null {
  // A malformed list cannot vouch for anything: it is an unresolved failure.
  const listed: unknown[] = Array.isArray(a.failures) ? a.failures : [];
  const malformed = !Array.isArray(a.failures) || listed.some((f) => typeof f !== "string");
  const failures = listed.filter((f): f is string => typeof f === "string");
  const g = a.guards;
  if (
    !g ||
    !g.node ||
    !g.dns ||
    !g.dgram ||
    !g.http ||
    !g.webContents ||
    !(g.sessions > 0) ||
    failures.some((f) => f === "sessionWatchUnavailable" || f.startsWith("guard:"))
  )
    return { key: `${P}.unverified.guards`, tone: "warn" };
  if (g.envProxy || failures.includes("envProxy"))
    return { key: `${P}.unverified.envProxy`, tone: "warn" };
  const networkChildren = Array.isArray(a.networkChildren) ? a.networkChildren : [];
  if (failures.some((f) => STOP_FAILURES.has(f)))
    return networkChildren.length > 0
      ? {
          key: `${P}.unverified.stopFailed`,
          params: { names: isolate(unique(networkChildren)) },
          tone: "warn",
        }
      : { key: `${P}.unverified.stopFailedUnnamed`, tone: "warn" };
  // child:<kind>:<pid>:<reason> is a tree main could not resolve (Task 6a/7).
  const unresolvedKinds = failures
    .filter((f) => f.startsWith("child:"))
    .map((f) => f.split(":")[1] ?? "");
  const names = unique([...networkChildren, ...unresolvedKinds]);
  if (names.length > 0)
    return { key: `${P}.unverified.child`, params: { names: isolate(names) }, tone: "warn" };
  if (failures.some((f) => CHILD_STILL_RUNNING.has(f)))
    return { key: `${P}.unverified.stopFailedUnnamed`, tone: "warn" };
  if (failures.some((f) => CHILD_STATUS_UNKNOWN.has(f)))
    return { key: `${P}.unverified.childUnknown`, tone: "warn" };
  if (
    g.chromiumInFlightRemote > 0 ||
    (g.chromiumUnresolvedAfterDestroy ?? 0) > 0 ||
    failures.includes("timeout:chromium")
  )
    return { key: `${P}.unverified.chromium`, tone: "warn" };
  if (g.pendingDns > 0 || failures.includes("timeout:dns"))
    return { key: `${P}.unverified.dns`, tone: "warn" };
  if (
    a.activeRemote > 0 ||
    g.openRemoteSockets > 0 ||
    failures.some((f) =>
      ["timeout:tickets", "timeout:ticketsUnknown", "timeout:sockets"].includes(f)
    )
  )
    return { key: `${P}.unverified.active`, tone: "warn" };
  // Any other failure main names (a transition step such as
  // meetingDetectionPause or sessionHardening, a startup barrier, or a name a
  // later build adds) is still unresolved: never the clean steady state (T14-M1).
  if (malformed || failures.some((f) => f !== BUILD_LIMIT))
    return { key: `${P}.unverified.other`, tone: "warn" };
  return null;
}

// The only place the panel decides what it may say. `sealed` is the store's
// answer from main (null until main answered). The attestation is checked for
// freshness again at render, and must describe the same state.
export function sealedStatusLines(
  sealed: boolean | null,
  attestationIn: Attestation | null,
  now: number = Date.now()
): StatusLine[] {
  if (sealed === null) return [{ key: `${P}.checking`, tone: "neutral" }];
  const attestation =
    isAttestationFresh(attestationIn, now) && attestationIn?.sealed === sealed
      ? attestationIn
      : null;
  const lines: StatusLine[] = [];
  if (!sealed) {
    lines.push({ key: `${P}.description`, tone: "neutral" });
    // D-5: programs the user runs (forwarders, SOCKS, tunnels) are outside it.
    lines.push({ key: `${P}.forwarders`, tone: "neutral" });
  } else {
    lines.push({ key: `${P}.on`, tone: "neutral" });
    // A fact of this build (07a), not of the attestation: no platform has a
    // native boundary, so local engines never run while sealed.
    lines.push({ key: `${P}.buildLimit`, tone: "warn" });
    if (!attestation) {
      lines.push({ key: `${P}.statusChecking`, tone: "neutral" });
    } else {
      const cause = unresolvedCause(attestation);
      if (cause) lines.push(cause);
      const count = attestation.blockedSinceSealed;
      if (Number.isSafeInteger(count) && count > 0)
        lines.push({ key: `${P}.blocked`, params: { count }, tone: "neutral" });
    }
    // Always shown while sealed: what Sealed mode covers, and its limits.
    lines.push({ key: `${P}.scope`, tone: "neutral" });
    lines.push({ key: `${P}.forwarders`, tone: "neutral" });
  }
  if (attestation?.loadError) lines.push({ key: `${P}.loadError`, tone: "warn" });
  if (attestation?.saveError) lines.push({ key: `${P}.saveError`, tone: "warn" });
  return lines;
}
