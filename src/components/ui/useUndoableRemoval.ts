import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MULTI_FIELD_CREDENTIALS, type CredentialSlot } from "../../lib/credentialSlots";
import type { CredentialsAPI } from "../../types/electron";
import { ToastContext, type ToastContextType } from "./useToast";

export const UNDO_WINDOW_MS = 8000;
export type UndoFailureReason = "expired" | "replaced" | "unknown" | "persistFailed";
export type RemovalNotice =
  | { kind: "removed"; token: string; expiresAt: number; restoreFailed: boolean }
  | { kind: "undoFailed"; reason: Exclude<UndoFailureReason, "persistFailed"> }
  | { kind: "error"; message: string };
export const UNDO_FAILURE_KEY = {
  expired: "apiKeyInput.undoExpired",
  replaced: "apiKeyInput.undoReplaced",
  unknown: "apiKeyInput.undoUnknown",
} as const;
export type CredentialsRemovalApi = Pick<CredentialsAPI, "remove" | "undoRemove">;
export interface RemovalDeps {
  api?: CredentialsRemovalApi;
  toast?: ToastContextType["toast"] | null;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}
export type UndoOutcome =
  | { kind: "restored" }
  | { kind: "retry" }
  | { kind: "failed"; reason: Exclude<UndoFailureReason, "persistFailed"> }
  | { kind: "error"; message: string };

// Never propagate arbitrary IPC errors: an error can contain credential material.
export async function undoRemoval(
  api: Pick<CredentialsRemovalApi, "undoRemove">,
  token: string,
  expiresAt: number,
  now: () => number
): Promise<UndoOutcome> {
  try {
    const result = await api.undoRemove(token);
    if (result.ok === true) return { kind: "restored" };
    if (result.reason === "persistFailed")
      return now() < expiresAt ? { kind: "retry" } : { kind: "failed", reason: "expired" };
    return { kind: "failed", reason: result.reason };
  } catch {
    return { kind: "error", message: "unavailable" };
  }
}
const scheduleDefault = (fn: () => void, ms: number): unknown => setTimeout(fn, ms);
const cancelDefault = (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>);
const remaining = (expiresAt: number, now: () => number) =>
  Math.max(0, Math.min(UNDO_WINDOW_MS, expiresAt - now()));

// These values belong to this removal, not to the next rendered field. No token
// is put into toast data/copy; only its action closure retains the capability.
function offerUndo(
  toast: ToastContextType["toast"],
  api: CredentialsRemovalApi,
  id: CredentialSlot,
  token: string,
  expiresAt: number,
  now: () => number,
  t: (key: string) => string,
  retry = false
) {
  let pending = false;
  let finished = false;
  toast({
    title: t(
      retry
        ? "apiKeyInput.undoRetry"
        : MULTI_FIELD_CREDENTIALS.has(id)
          ? "apiKeyInput.removedCredential"
          : "apiKeyInput.removed"
    ),
    duration: remaining(expiresAt, now),
    actions: [
      {
        label: t("apiKeyInput.undo"),
        dismissOnClick: true,
        onClick: async () => {
          if (pending || finished) return;
          pending = true;
          const outcome = await undoRemoval(api, token, expiresAt, now);
          finished = true;
          if (outcome.kind === "restored") toast({ title: t("apiKeyInput.restored") });
          else if (outcome.kind === "retry")
            offerUndo(toast, api, id, token, expiresAt, now, t, true);
          else
            toast({
              title: t(
                outcome.kind === "failed"
                  ? UNDO_FAILURE_KEY[outcome.reason]
                  : "apiKeyInput.undoUnknown"
              ),
            });
        },
      },
    ],
  });
}

export function useUndoableRemoval(
  credentialId: CredentialSlot | undefined,
  deps: RemovalDeps = {}
) {
  const { t } = useTranslation();
  const context = useContext(ToastContext);
  const api =
    deps.api ?? (typeof window === "undefined" ? undefined : window.electronAPI?.credentials);
  const toast = deps.toast === undefined ? context?.toast : deps.toast;
  const [notice, setNotice] = useState<RemovalNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<{ handle: unknown; cancel: (handle: unknown) => void } | null>(null);
  const inline = useRef<{
    api: CredentialsRemovalApi;
    token: string;
    expiresAt: number;
    now: () => number;
  } | null>(null);
  const owner = useRef({ id: credentialId, api, epoch: 0 });
  if (owner.current.id !== credentialId || owner.current.api !== api)
    owner.current = { id: credentialId, api, epoch: owner.current.epoch + 1 };
  const mounted = useRef(true);
  const pending = useRef(false);
  const clearTimer = useCallback(() => {
    if (timer.current) timer.current.cancel(timer.current.handle);
    timer.current = null;
  }, []);
  const clear = useCallback(() => {
    clearTimer();
    inline.current = null;
    setNotice(null);
  }, [clearTimer]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      inline.current = null;
    };
  }, [clearTimer]);
  useEffect(() => {
    clear();
    setBusy(false);
    pending.current = false;
  }, [credentialId, api, clear]);
  const available =
    !!credentialId && typeof api?.remove === "function" && typeof api?.undoRemove === "function";
  const arm = (captured: NonNullable<typeof inline.current>, restoreFailed: boolean) => {
    clearTimer();
    inline.current = captured;
    setNotice({
      kind: "removed",
      token: captured.token,
      expiresAt: captured.expiresAt,
      restoreFailed,
    });
    timer.current = {
      cancel: deps.cancel ?? cancelDefault,
      handle: (deps.schedule ?? scheduleDefault)(
        () => {
          if (inline.current !== captured) return;
          timer.current = null;
          inline.current = null;
          if (mounted.current) setNotice(null);
        },
        remaining(captured.expiresAt, captured.now)
      ),
    };
  };
  const remove = async () => {
    if (
      !available ||
      pending.current ||
      owner.current.id !== credentialId ||
      owner.current.api !== api
    )
      return;
    const capturedOwner = owner.current;
    const id = credentialId!;
    const capturedApi = api!;
    const now = deps.now ?? Date.now;
    pending.current = true;
    setBusy(true);
    clear();
    const current = () => mounted.current && owner.current === capturedOwner;
    try {
      const result = await capturedApi.remove(id);
      if (result.ok === false) {
        if (current()) setNotice({ kind: "error", message: "unavailable" });
        return;
      }
      if (toast) offerUndo(toast, capturedApi, id, result.undoToken, result.expiresAt, now, t);
      else if (current())
        arm({ api: capturedApi, token: result.undoToken, expiresAt: result.expiresAt, now }, false);
    } catch {
      if (current()) setNotice({ kind: "error", message: "unavailable" });
    } finally {
      if (current()) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  const undo = async () => {
    const captured = inline.current;
    if (
      !captured ||
      pending.current ||
      owner.current.id !== credentialId ||
      owner.current.api !== api
    )
      return;
    const capturedOwner = owner.current;
    clearTimer();
    pending.current = true;
    setBusy(true);
    const outcome = await undoRemoval(
      captured.api,
      captured.token,
      captured.expiresAt,
      captured.now
    );
    if (!mounted.current || owner.current !== capturedOwner) return;
    pending.current = false;
    setBusy(false);
    if (outcome.kind === "restored") clear();
    else if (outcome.kind === "retry") arm(captured, true);
    else {
      inline.current = null;
      setNotice(
        outcome.kind === "failed"
          ? { kind: "undoFailed", reason: outcome.reason }
          : { kind: "error", message: "unavailable" }
      );
    }
  };
  return { available, notice, busy, remove, undo, clear };
}
