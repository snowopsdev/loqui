import type { Attestation } from "../types/privacy";

// Pure and Node-loadable: how old a claim from main may be before the
// renderer stops showing it. The sole sealedStore and the native route
// projection share this rule, so a stale claim is never shown by one of them
// and acted on by the other.

// Main re-broadcasts whenever the attestation changes; this bounds how old a
// claim on screen can be if a broadcast is lost. Measured from main's `at`.
export const ATTESTATION_MAX_AGE_MS = 30_000;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

// A claim is shown only while main's own timestamp is at most 30 s old. A
// timestamp further in the future than that cannot be trusted either.
export function isAttestationFresh(a: Attestation | null, now = Date.now()): boolean {
  if (!a || !isFiniteNumber(a.at) || !isFiniteNumber(now)) return false;
  const age = now - a.at;
  return age <= ATTESTATION_MAX_AGE_MS && -age <= ATTESTATION_MAX_AGE_MS;
}
