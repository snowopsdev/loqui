// A fake window.electronAPI.privacy that a test drives by calling the
// registered listeners, the way main's broadcasts would.
//
// 07a honesty (A1/A12/A19): every attestation here is the shape main actually
// produces without a verified native boundary: nothingLeaves false,
// effectiveSince null, isolation unavailable, nothing paused. No fixture in
// this file claims a verified seal, zero egress or an isolated child.
// pending: getSealed never answers, so the state stays unknown until an event.
function unverifiedAttestation({ sealed = true, version = 1, at = Date.now(), ...rest } = {}) {
  return {
    sealed,
    sealedSince: sealed ? at - 1000 : null,
    effectiveSince: null,
    phase: sealed ? "sealed" : "open",
    failures: sealed ? ["NATIVE_BOUNDARY_UNAVAILABLE"] : [],
    notes: [],
    loadError: null,
    saveError: null,
    guards: {
      node: true,
      dns: true,
      dgram: true,
      http: true,
      webContents: true,
      sessions: 1,
      envProxy: false,
      openRemoteSockets: 0,
      chromiumInFlightRemote: 0,
      chromiumUnresolvedAfterDestroy: 0,
      pendingDns: 0,
    },
    networkChildren: [],
    activeRemote: 0,
    children: [],
    childDiagnostics: { nativeBoundaryUnavailable: true, unresolved: [] },
    isolation: {
      platform: "linux",
      mechanism: "none",
      selfTest: "unavailable",
      checkedAt: null,
      reason: "NATIVE_BOUNDARY_UNAVAILABLE",
      pauseReason: null,
    },
    paused: [],
    persistError: null,
    blockedSinceSealed: 0,
    recordFailures: 0,
    version,
    at,
    nothingLeaves: false,
    ...rest,
  };
}

function fakePrivacy({ sealed = true, failAttestation = false, pending = false } = {}) {
  const listeners = {};
  let version = 1;
  const calls = [];
  return {
    listeners,
    calls,
    api: {
      getSealed: () => {
        calls.push("getSealed");
        return pending ? new Promise(() => {}) : Promise.resolve(sealed);
      },
      getAttestation: async () => {
        calls.push("getAttestation");
        if (failAttestation) throw new Error("ipc");
        return unverifiedAttestation({ sealed, version });
      },
      setSealed: async (next) => {
        calls.push("setSealed");
        version += 1;
        return unverifiedAttestation({ sealed: next, version });
      },
      onSealedChange: (cb) => {
        listeners.sealed = cb;
        return () => {};
      },
      onAttestation: (cb) => {
        listeners.attestation = cb;
        return () => {};
      },
    },
  };
}
const tick = () => new Promise((r) => setImmediate(r));

module.exports = { fakePrivacy, unverifiedAttestation, tick };
