import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import type { PersonalInferenceAPI } from "../services/ai/personalInferenceTypes";
import codexPolicy from "../config/codex.json";
import {
  ensureRouteFactsSubscribed,
  refreshRouteFacts,
  useRouteFactsStore,
} from "../stores/routeFactsStore";

type Status = Awaited<ReturnType<PersonalInferenceAPI["codexStatus"]>>;
export default function CodexConnection({
  onSignedInChange,
  onStatusChecked,
  checkStatusOnMount = false,
}: {
  /** Called when a later status refresh finds the ChatGPT account signed in or out. */
  onSignedInChange?: (signedIn: boolean) => void;
  /** Setup may re-read the passive model catalog after an explicit status check. */
  onStatusChecked?: () => void;
  /**
   * Read status when mounted. Only onboarding opts in (OnboardingFlow.tsx; Plan 05
   * owns that step). Settings never does: codexStatus starts the Codex app server
   * (codexAppServer.js:359-367) and may ask GitHub to verify the release (codexCli.js:309-340).
   */
  checkStatusOnMount?: boolean;
} = {}) {
  const { t } = useTranslation();
  // Main-confirmed presence (Task 2 stats the Codex profile's auth.json: no
  // process, no network). null until main has listed credentials.
  const storedAccount = useRouteFactsStore((s) => s.facts.credentials?.get("codex") ?? null);
  const [status, setStatus] = useState<Status | null>(null);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const api = window.electronAPI?.personalInference;
  const signedInRef = useRef<boolean | null>(null);
  const onSignedInChangeRef = useRef(onSignedInChange);
  onSignedInChangeRef.current = onSignedInChange;
  const onStatusCheckedRef = useRef(onStatusChecked);
  onStatusCheckedRef.current = onStatusChecked;
  const mountedRef = useRef(false);
  const refreshSeqRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    ensureRouteFactsSubscribed();
  }, []);
  const refresh = useCallback(async () => {
    if (!api) return;
    const seq = ++refreshSeqRef.current;
    const next = await api.codexStatus();
    // A read that finishes after unmount, or after a newer read began, is stale:
    // it must not update state or tell the owner about an account change.
    if (!mountedRef.current || seq !== refreshSeqRef.current) return;
    setStatus(next);
    onStatusCheckedRef.current?.();
    const signedIn = next.account?.type === "chatgpt";
    // The first read only establishes the baseline; later changes are reported.
    if (signedInRef.current !== null && signedInRef.current !== signedIn)
      onSignedInChangeRef.current?.(signedIn);
    signedInRef.current = signedIn;
    // A successful explicit read can be the first read after Connect. Its
    // baseline callback remains unchanged, but setup still needs main's local
    // auth.json presence even when login completed before that first reply.
    void refreshRouteFacts(["credentials"]);
    if (signedIn) {
      setLoginId(null);
      try {
        const limits = await api.codexRateLimits();
        if (!mountedRef.current || seq !== refreshSeqRef.current) return;
        const percentages = [
          limits.rateLimits?.primary?.usedPercent,
          limits.rateLimits?.secondary?.usedPercent,
        ].filter((value) => typeof value === "number") as number[];
        setRemaining(percentages.length ? Math.max(0, 100 - Math.max(...percentages)) : null);
      } catch {
        if (mountedRef.current && seq === refreshSeqRef.current) setRemaining(null);
      }
    } else setRemaining(null);
  }, [api]);
  // Onboarding only; see checkStatusOnMount.
  useEffect(() => {
    if (checkStatusOnMount) void refresh().catch((error) => setError(error.message));
  }, [checkStatusOnMount, refresh]);
  // Account events follow an explicit sign-in or sign-out (the app server runs
  // only after one of the buttons below), so they still refresh.
  useEffect(
    () =>
      api?.onTextEvent((event) => {
        if (event.type !== "account") return;
        if (event.method === "account/login/completed" && event.params?.success === false) {
          setLoginId(null);
          setError(String(event.params.error || t("codexConnection.loginFailed")));
        }
        void refresh().catch((error) => setError(error.message));
      }),
    [api, refresh, t]
  );
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Sign-in and sign-out are explicit, so the status read that follows them is too.
  const action = (fn: () => Promise<unknown>) =>
    run(async () => {
      await fn();
      await refresh();
    });
  // A read status wins over the stored presence (a stale auth.json reads as signed out).
  const signedIn = status ? status.account?.type === "chatgpt" : storedAccount === true;
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="font-medium">{t("codexConnection.title")}</div>
      <p className="text-sm text-muted-foreground">
        {t("codexConnection.description", { minimumVersion: codexPolicy.minimumVersion })}
      </p>
      {signedIn ? (
        <>
          <p className="text-sm">
            {status?.account?.type === "chatgpt"
              ? t("codexConnection.connected", {
                  account: status.account.email || status.account.planType || "ChatGPT",
                })
              : t("codexConnection.signedInStored")}
          </p>
          {remaining !== null && (
            <p className="text-sm text-muted-foreground">
              {t("codexConnection.remaining", { percent: Math.round(remaining) })}
            </p>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void action(() => api.codexLogout())}
          >
            {t("codexConnection.disconnect")}
          </Button>
        </>
      ) : loginId ? (
        <>
          <p className="text-sm">{t("codexConnection.waiting")}</p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await api.codexCancelLogin(loginId);
                setLoginId(null);
              })
            }
          >
            {t("codexConnection.cancel")}
          </Button>
        </>
      ) : (
        // Connect is the explicit action that starts Codex; only a status read that
        // found Codex unavailable disables it.
        <Button
          disabled={busy || status?.available === false}
          onClick={() =>
            void action(async () => {
              const login = await api.codexLogin();
              setLoginId(login.loginId);
            })
          }
        >
          {t("codexConnection.connect")}
        </Button>
      )}
      <Button
        className="ms-2"
        variant="ghost"
        disabled={busy}
        data-action="codex-check-status"
        title={t("codexConnection.checkStatusTitle")}
        onClick={() => void run(refresh)}
      >
        {t("codexConnection.checkStatus")}
      </Button>
      {(error || status?.error) && (
        <p className="text-sm text-destructive" role="alert">
          {error || status.error}
        </p>
      )}
    </div>
  );
}
