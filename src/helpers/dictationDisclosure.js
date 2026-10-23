import { providerDisplayLabel } from "../lib/locality";

export const PAYLOAD_RANK = { text: 1, image: 2, audio: 3 };
const DISCLOSURE_TASKS = new Set([
  "dictationStt",
  "dictationCleanup",
  "translation",
  "voiceAssistant",
  "assistantVision",
]);

// The user's own server is named by host; every other non-device route by
// provider id. Network-route URLs come from the session's own snapshot.
const NETWORK_URL_KEY = {
  dictationStt: "remoteTranscriptionUrl",
  dictationCleanup: "cleanupRemoteUrl",
  translation: "translationRemoteUrl",
  voiceAssistant: "dictationAgentRemoteUrl",
  assistantVision: "dictationAgentRemoteUrl",
};

export function disclosureTargetFor(route, settingsView = {}) {
  if (!route) return "";
  if (route.locality === "device") return null;
  if (route.locality === "network") {
    try {
      // "host:<hostname>", the same encoding as main's EgressNotice.targetId (§5.4).
      return `host:${new URL(settingsView[NETWORK_URL_KEY[route.id]]).hostname}`;
    } catch {
      return "host:";
    }
  }
  return route.providerId ?? "";
}

export function dispatchTargetLabel(target, t) {
  if (typeof target === "string" && target.startsWith("host:"))
    return target.slice(5) || t("locality.network");
  return providerDisplayLabel(target, t);
}

export function disclosureCopy(d, t) {
  if (d.alsoSentTo?.length) {
    // Several receivers: name them all rather than hide any (one string, not one per payload).
    const providers = [d.target, ...d.alsoSentTo].map((x) => dispatchTargetLabel(x, t)).join(", ");
    return t(
      d.evidence === "attested" ? "pill.caption.remoteSeveral" : "pill.caption.mayHaveSeveral",
      { provider: providers }
    );
  }
  const noun = d.payload === "audio" ? "Audio" : d.payload === "image" ? "Image" : "Text";
  const key =
    d.evidence === "attested" ? `pill.caption.remote${noun}` : `pill.caption.mayHave${noun}`;
  return t(key, { provider: dispatchTargetLabel(d.target, t) });
}

const EVIDENCE_RANK = { dispatched: 1, attested: 2 };

export function createDisclosureTracker({ session, onChange, privacyApi, dispatchApi } = {}) {
  let listener = onChange;
  let disposed = false;
  const byTarget = new Map(); // target -> payload -> strongest evidence for that payload
  const tickets = new Map(); // main's ticketId -> { target, payload, phase }
  let mainFed = false;
  let detach = () => undefined;
  let detachDispatch = () => undefined;
  let attested = false;
  let current = null;
  const settingsView = session?.settings ?? {};
  const summarize = () => {
    const entries = [...byTarget.entries()]
      .map(([target, payloads]) => {
        const payload = Object.keys(payloads).sort((a, b) => PAYLOAD_RANK[b] - PAYLOAD_RANK[a])[0];
        return [
          target,
          {
            payload,
            evidence: payloads[payload],
            rank: Math.max(...Object.values(payloads).map((value) => EVIDENCE_RANK[value])),
          },
        ];
      })
      .sort(([, a], [, b]) => b.rank - a.rank || PAYLOAD_RANK[b.payload] - PAYLOAD_RANK[a.payload]);
    if (!entries.length) return null;
    const [[target, top], ...rest] = entries;
    // The public caption names every receiver. Attested wording requires an
    // attestation for every payload being represented, not an unrelated ticket.
    const evidence = entries.every(([, value]) => value.evidence === "attested")
      ? "attested"
      : "dispatched";
    return { target, payload: top.payload, evidence, alsoSentTo: rest.map(([name]) => name) };
  };
  const tracker = {
    record({ task, payload, evidence }) {
      if (disposed || mainFed || !DISCLOSURE_TASKS.has(task) || !EVIDENCE_RANK[evidence]) return; // Plan 07 present: main's egress notices are the only evidence (§5.2)
      if (!PAYLOAD_RANK[payload]) return; // "metadata" never counts
      // No routes (the reader failed): fail toward disclosure, as an unknown provider (D4).
      const target = session?.routes ? disclosureTargetFor(session.routes[task], settingsView) : "";
      if (target === null) return;
      merge(target, payload, evidence);
    },
    applyEgress(notice) {
      if (disposed) return;
      if (
        notice?.correlationId !== session?.id ||
        !DISCLOSURE_TASKS.has(notice?.task) ||
        notice.ticketId == null ||
        typeof notice.targetId !== "string"
      )
        return;
      if (!PAYLOAD_RANK[notice?.payload] || !EGRESS_EVIDENCE[notice.phase]) return;
      const prev = tickets.get(notice.ticketId);
      if (prev?.phase === "delivered") return; // delivered is final
      tickets.set(notice.ticketId, {
        target: notice.targetId,
        payload: notice.payload,
        phase: notice.phase,
      });
      // Rebuild from the tickets, so an undelivered ticket withdraws only its own evidence.
      byTarget.clear();
      attested = false;
      for (const t of tickets.values())
        if (t.phase !== "undelivered")
          merge(t.target, t.payload, EGRESS_EVIDENCE[t.phase], { quiet: true });
      const next = summarize();
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        current = next;
        listener?.(current);
      }
    },
    _startMainFeed(off) {
      if (!mainFed) {
        byTarget.clear();
        tickets.clear();
        current = null;
        attested = false;
      }
      mainFed = true;
      detach = typeof off === "function" ? off : () => {};
    },
    _startDispatchFeed(off) {
      detachDispatch = typeof off === "function" ? off : () => {};
    },
    get: () => current,
    attested: () => attested,
    setOnChange(fn) {
      listener = fn;
    },
    dispose() {
      disposed = true;
      attested = false;
      detach();
      detachDispatch();
      byTarget.clear();
      tickets.clear();
      current = null;
      listener = undefined;
    },
  };
  if (session?.id) {
    attachEgressEvidence(tracker, session.id, privacyApi);
    attachDispatchEvidence(tracker, session.id, dispatchApi);
  }
  return tracker;

  function merge(target, payload, evidence, { quiet = false } = {}) {
    if (evidence === "attested") attested = true;
    const prev = byTarget.get(target);
    const next = { ...prev, [payload]: prev?.[payload] === "attested" ? "attested" : evidence };
    if (prev?.[payload] === next[payload]) return;
    byTarget.set(target, next);
    if (quiet) return;
    current = summarize();
    listener?.(current);
  }
}

const EGRESS_EVIDENCE = {
  dispatched: "dispatched",
  delivered: "attested",
  undelivered: "dispatched",
};

/** Plan 07's egress feed (§5.4) for this session's correlation id. `recorded` rows are not evidence. */
export function attachEgressEvidence(
  tracker,
  sessionId,
  privacyApi = globalThis.window?.electronAPI?.privacy
) {
  if (!privacyApi?.onEgress) return () => undefined;
  const off = privacyApi.onEgress((notice) => {
    if (notice?.correlationId !== sessionId) return;
    tracker.applyEgress(notice);
  });
  tracker._startMainFeed?.(off);
  return off;
}

/**
 * Main's transport hand-off for this session (no Plan 07): sent right before a
 * provider request, or a streaming session's first frame, leaves, so it is "may
 * have received", never "already received". record() ignores it once Plan 07's
 * egress feed is attached.
 */
export function attachDispatchEvidence(
  tracker,
  sessionId,
  dispatchApi = globalThis.window?.electronAPI
) {
  if (!dispatchApi?.onDictationDispatch) return () => undefined;
  const off = dispatchApi.onDictationDispatch((dispatch) => {
    if (dispatch?.correlationId !== sessionId || !DISCLOSURE_TASKS.has(dispatch.task)) return;
    tracker.record({ task: dispatch.task, payload: dispatch.payload, evidence: "dispatched" });
  });
  tracker._startDispatchFeed?.(off);
  return off;
}
