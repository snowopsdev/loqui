import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import type { PersonalInferenceAPI } from "../services/ai/personalInferenceTypes";
import codexPolicy from "../config/codex.json";

type Status = Awaited<ReturnType<PersonalInferenceAPI["codexStatus"]>>;
export default function CodexConnection({
  onSignedInChange,
}: {
  /** Called when a later status refresh finds the ChatGPT account signed in or out. */
  onSignedInChange?: (signedIn: boolean) => void;
} = {}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status | null>(null);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const api = window.electronAPI?.personalInference;
  const signedInRef = useRef<boolean | null>(null);
  const onSignedInChangeRef = useRef(onSignedInChange);
  onSignedInChangeRef.current = onSignedInChange;
  const mountedRef = useRef(false);
  const refreshSeqRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!api) return;
    const seq = ++refreshSeqRef.current;
    const next = await api.codexStatus();
    // A read that finishes after unmount, or after a newer read began, is stale:
    // it must not update state or tell the owner about an account change.
    if (!mountedRef.current || seq !== refreshSeqRef.current) return;
    setStatus(next);
    const signedIn = next.account?.type === "chatgpt";
    // The first read only establishes the baseline; later changes are reported.
    if (signedInRef.current !== null && signedInRef.current !== signedIn)
      onSignedInChangeRef.current?.(signedIn);
    signedInRef.current = signedIn;
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
  useEffect(() => {
    void refresh().catch((error) => setError(error.message));
    return api?.onTextEvent((event) => {
      if (event.type !== "account") return;
      if (event.method === "account/login/completed" && event.params?.success === false) {
        setLoginId(null);
        setError(String(event.params.error || t("codexConnection.loginFailed")));
      }
      void refresh().catch((error) => setError(error.message));
    });
  }, [api, refresh, t]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="font-medium">{t("codexConnection.title")}</div>
      <p className="text-sm text-muted-foreground">
        {t("codexConnection.description", { minimumVersion: codexPolicy.minimumVersion })}
      </p>
      {status?.account?.type === "chatgpt" ? (
        <>
          <p className="text-sm">
            {t("codexConnection.connected", {
              account: status.account.email || status.account.planType || "ChatGPT",
            })}
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
        <Button
          disabled={busy || !status?.available}
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
      <Button className="ml-2" variant="ghost" disabled={busy} onClick={() => void action(refresh)}>
        {t("codexConnection.refresh")}
      </Button>
      {(error || status?.error) && (
        <p className="text-sm text-destructive" role="alert">
          {error || status.error}
        </p>
      )}
    </div>
  );
}
