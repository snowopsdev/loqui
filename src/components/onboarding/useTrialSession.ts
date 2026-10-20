import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { INITIAL_TRIAL_STATE, reduceTrial, canUndo } from "../../utils/onboardingTrial";
import type { DictationBinding, OnboardingDemoEvent } from "../../types/electron";
import type { CleanupOperationIdentity } from "../../services/ai/personalInferenceTypes";
import { bindingMatches } from "./useDictationHotkey";
import { revokeSetupCleanupSelection } from "../../stores/setupCleanupAdmission";
import { retryCleanupOperation, sameCleanupOperation } from "./cleanupRunner";

export interface TrialProof {
  demoId: string;
  takeId: string;
  context: string | null;
  binding: DictationBinding | null;
  usedHotkey: boolean;
  rawText: string | null;
  text: string;
}
let demoSequence = 0;

/** Setup observes the original overlay/private owner. No audio or cancellation owner lives here. */
export function useTrialSession(active: boolean, context = "", binding?: DictationBinding) {
  const [state, dispatch] = useReducer(reduceTrial, INITIAL_TRIAL_STATE);
  const [lastTake, setLastTake] = useState<TrialProof | null>(null);
  const [cleanupCode, setCleanupCode] = useState<string | null>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [undoInFlight, setUndoInFlight] = useState(false);
  const [available, setAvailable] = useState(false);
  const [controlError, setControlError] = useState(false);
  const latest = useRef({ active, context, binding });
  latest.current = { active, context, binding };
  const stateRef = useRef(state);
  stateRef.current = state;
  const lifetime = useRef<{
    id: string;
    context: string;
    accepted: Promise<boolean>;
    take: string | null;
    seenTakes: Set<string>;
    stage: "preparing" | "recording" | "processing" | "cancelled" | "closed";
    cancelSession: string | null;
    cancelRevision: number;
    undoing: boolean;
    operation: CleanupOperationIdentity | null;
    retrying: boolean;
  } | null>(null);
  const live = useCallback(
    (owner: NonNullable<typeof lifetime.current>) =>
      lifetime.current === owner &&
      latest.current.active &&
      latest.current.context === owner.context,
    []
  );

  useEffect(() => {
    if (!active) return;
    // Effect activation, including StrictMode replay, always owns a new identity.
    const id = `onboarding-${++demoSequence}-${crypto.randomUUID()}`;
    const api = window.electronAPI;
    const owner: NonNullable<typeof lifetime.current> = {
      id,
      context,
      accepted: Promise.resolve(false),
      take: null,
      seenTakes: new Set(),
      stage: "closed",
      cancelSession: null,
      cancelRevision: 0,
      undoing: false,
      operation: null,
      retrying: false,
    };
    lifetime.current = owner;
    dispatch({ status: "reset", atMs: Date.now() });
    setUndoAvailable(false);
    setUndoInFlight(false);
    setCleanupCode(null);
    setAvailable(false);
    setControlError(false);
    const error = () => {
      if (live(owner)) dispatch({ status: "error", code: "DEMO_UNAVAILABLE", atMs: Date.now() });
    };
    let off: (() => void) | undefined;
    const observe = (event: OnboardingDemoEvent) => {
      if (
        !live(owner) ||
        event.demoId !== id ||
        event.kind !== "dictation" ||
        typeof event.takeId !== "string"
      )
        return;
      if (event.status === "preparing") {
        if (owner.seenTakes.has(event.takeId)) return;
        owner.seenTakes.add(event.takeId);
        setControlError(false);
        owner.cancelSession = null;
        owner.undoing = false;
        setUndoAvailable(false);
        setUndoInFlight(false);
        owner.take = event.takeId;
        owner.stage = "preparing";
        owner.operation = null;
        owner.retrying = false;
        setCleanupCode(null);
        dispatch({ status: "reset", atMs: Date.now() });
        return;
      }
      if (owner.take !== event.takeId) return;
      if (
        event.status === "cancelled" &&
        event.cancelled &&
        event.sessionId === event.cancelled.sessionId
      ) {
        if (
          owner.stage === "closed" ||
          (owner.cancelSession && owner.cancelSession !== event.sessionId)
        )
          return;
        owner.cancelSession = event.sessionId;
        owner.cancelRevision += 1;
        owner.stage = "cancelled";
        owner.operation = null;
        setControlError(false);
        setUndoAvailable(true);
        dispatch({ ...event, atMs: Date.now() });
        return;
      }
      if (event.status === "cancelClosed") {
        if (!owner.cancelSession || event.sessionId !== owner.cancelSession) return;
        owner.cancelSession = null;
        owner.stage = event.reason === "restored" ? "processing" : "closed";
        setUndoAvailable(false);
        dispatch({ ...event, atMs: Date.now() });
        return;
      }
      if (owner.stage === "closed" || owner.stage === "cancelled") return;
      if (["listening", "processing", "success", "error", "cancelled"].includes(event.status))
        setControlError(false);
      if (event.status === "listening") {
        if (owner.stage !== "preparing") return;
        owner.stage = "recording";
      } else if (event.status === "error" || event.status === "cancelled") {
        owner.stage = "closed";
        owner.operation = null;
      } else {
        if (owner.stage === "preparing") return;
        if (event.status === "processing") owner.stage = "processing";
        if (event.status === "success") {
          owner.stage = "closed";
          owner.operation = event.cleanupOperationId
            ? { demoId: id, takeId: event.takeId, operationId: event.cleanupOperationId }
            : null;
          setCleanupCode(event.cleanupCode ?? null);
          if (event.text?.trim()) {
            revokeSetupCleanupSelection();
            setLastTake({
              demoId: id,
              takeId: event.takeId,
              context: event.context ?? null,
              binding: event.binding ?? null,
              usedHotkey: event.origin === "hotkey" && !!event.binding,
              rawText: event.rawText ?? null,
              text: event.text,
            });
          }
        }
      }
      dispatch({ ...event, atMs: Date.now() });
    };
    try {
      off = api?.onOnboardingDemoEvent?.(observe);
      if (typeof off !== "function") {
        // A partial/older preload cannot safely admit a demo setup cannot observe.
        void Promise.resolve(off).catch(() => {});
        throw new Error("Demo observation is unavailable");
      }
      owner.accepted = Promise.resolve(
        api?.beginOnboardingDemo?.({ id, kind: "dictation", context })
      ).then(
        (ok) => {
          if (live(owner)) {
            setAvailable(ok === true);
            if (ok !== true) error();
          }
          return ok === true;
        },
        () => {
          error();
          return false;
        }
      );
    } catch {
      error();
    }
    return () => {
      if (lifetime.current === owner) lifetime.current = null;
      if (typeof off === "function") off();
      const end = async () => {
        // Even a delayed begin must settle before its matching end. Main's id fence protects newer demos.
        await owner.accepted;
        try {
          if ((await api?.endOnboardingDemo?.(id)) === true) return;
        } catch {
          /* Fall through to the existing main cancel owner. */
        }
        try {
          await api?.cancelOnboardingDemo?.(id, owner.take);
        } catch {
          /* Owner no longer available. */
        }
      };
      void end();
      dispatch({ status: "reset", atMs: Date.now() });
    };
  }, [active, context, live]);

  const control = useCallback(
    async (action: "toggleOnboardingDemo" | "cancelOnboardingDemo") => {
      const owner = lifetime.current;
      if (!owner || !live(owner)) return false;
      const take = owner.take;
      if (!(await owner.accepted) || !live(owner) || owner.take !== take) return false;
      try {
        if ((await window.electronAPI?.[action]?.(owner.id, take)) === true) {
          if (live(owner) && owner.take === take) setControlError(false);
          return true;
        }
      } catch {
        /* Render a stable error, never the native/provider body. */
      }
      if (live(owner) && owner.take === take) {
        if (stateRef.current.phase === "recording" || stateRef.current.phase === "processing")
          setControlError(true);
        else dispatch({ status: "error", code: "DEMO_UNAVAILABLE", atMs: Date.now() });
      }
      return false;
    },
    [live]
  );
  const toggle = useCallback(() => control("toggleOnboardingDemo"), [control]);
  const cancel = useCallback(() => control("cancelOnboardingDemo"), [control]);
  const undo = useCallback(async () => {
    const owner = lifetime.current;
    if (!owner || !live(owner) || owner.undoing || !canUndo(stateRef.current, Date.now())) return;
    const take = owner.take,
      sessionId = owner.cancelSession,
      revision = owner.cancelRevision;
    if (!sessionId) return;
    owner.undoing = true;
    setUndoInFlight(true);
    let restored = false;
    try {
      if (
        !(await owner.accepted) ||
        !live(owner) ||
        owner.take !== take ||
        owner.cancelSession !== sessionId
      )
        return;
      restored =
        (await window.electronAPI?.undoOnboardingDemoCancel?.(owner.id, take, sessionId)) === true;
    } catch {
      /* The original owner publishes retained state or a terminal close. */
    } finally {
      if (live(owner) && owner.take === take) {
        owner.undoing = false;
        setUndoInFlight(false);
        // A fresh retained same-session event may arrive before OR after false.
        // Only an unchanged window is withheld; a later publication re-enables it.
        if (!restored && owner.cancelSession === sessionId && owner.cancelRevision === revision)
          setUndoAvailable(false);
      }
    }
  }, [live]);
  const retryCleanup = useCallback(async () => {
    const owner = lifetime.current;
    const current = stateRef.current;
    if (
      !owner ||
      !live(owner) ||
      owner.retrying ||
      current.phase !== "success" ||
      current.cleanup !== "failed"
    )
      return;
    const identity = owner.operation;
    if (!identity) {
      setCleanupCode("CLEANUP_OPERATION_UNAVAILABLE");
      return;
    }
    const counter = current.takeId;
    owner.retrying = true;
    dispatch({ status: "cleanupRetry", takeId: counter, atMs: Date.now() });
    const result = await retryCleanupOperation(identity);
    if (!live(owner) || owner.operation !== identity || !sameCleanupOperation(identity, result))
      return;
    owner.retrying = false;
    setCleanupCode(result.ok === false ? result.code : null);
    dispatch({
      status: "cleanupResult",
      takeId: counter,
      text: result.ok ? result.text : null,
      atMs: Date.now(),
    });
  }, [live]);
  const current =
    active && lifetime.current?.context === context
      ? state
      : { ...INITIAL_TRIAL_STATE, successes: state.successes, takeId: state.takeId };
  const level = useRef(0);
  level.current = current.level;
  const readLevel = useCallback(() => level.current, []);
  const matchingProof = !!lastTake && active && lastTake.context === context;
  const usedHotkey =
    matchingProof && lastTake.usedHotkey && bindingMatches(lastTake.binding, binding);
  return {
    state: current,
    dispatch,
    toggle,
    cancel,
    readLevel,
    usedHotkey,
    lastTake,
    cleanupCode,
    controlError,
    retryCleanup,
    undo,
    undoInFlight,
    undoAvailable:
      undoAvailable && !undoInFlight && active && lifetime.current?.context === context,
    available: active && lifetime.current?.context === context && available,
  };
}
