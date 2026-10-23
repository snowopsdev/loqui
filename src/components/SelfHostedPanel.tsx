import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EndpointDraft, type EndpointDraftValue } from "./settings/routing/EndpointDraft";
import { Button } from "./ui/button";

interface SelfHostedPanelProps {
  service: "transcription" | "reasoning";
  /** The committed server address and model. */
  url: string;
  model?: string;
  /** Commit through the route planner. Without it the panel is read-only (upload shares dictation's server). */
  onUse?: (next: EndpointDraftValue) => void;
}

type ProbeState =
  | { kind: "idle" }
  | { kind: "testing"; host: string }
  | { kind: "ok"; host: string; count: number }
  | { kind: "fail"; host: string; code: string };

function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).host || null;
  } catch {
    return null;
  }
}

export default function SelfHostedPanel({ service, url, model, onUse }: SelfHostedPanelProps) {
  const { t } = useTranslation();
  // No sealed check here: spec §5.4 has main gate the probe as providerCheck (loopback stays
  // testable while sealed) and answer { ok: false, code: "sealed" } otherwise.
  const [probe, setProbe] = useState<ProbeState>({ kind: "idle" });
  const placeholderUrl =
    service === "transcription" ? "http://localhost:8178" : "http://localhost:11434/v1";

  const runTest = async (address: string) => {
    const host = hostOf(address);
    if (!host) return;
    setProbe({ kind: "testing", host });
    // Main's probe sends no headers (selfHostedProbe.js), so no saved key can reach this address.
    let result: Awaited<ReturnType<NonNullable<Window["electronAPI"]["probeSelfHosted"]>>> | null =
      null;
    try {
      result = (await window.electronAPI?.probeSelfHosted?.(address.trim())) ?? null;
    } catch {
      result = null;
    }
    if (result && result.ok === true) setProbe({ kind: "ok", host, count: result.count });
    else
      setProbe({
        kind: "fail",
        host,
        code: result && result.ok === false ? result.code : "network",
      });
  };

  const testButton = (address: string) => {
    const host = hostOf(address);
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-action="probe-self-hosted"
        title={host ? t("settingsPage.selfHosted.testTitle", { host }) : undefined}
        disabled={!host || probe.kind === "testing"}
        onClick={() => void runTest(address)}
      >
        {probe.kind === "testing"
          ? t("settingsPage.selfHosted.testing")
          : t("settingsPage.selfHosted.test")}
      </Button>
    );
  };

  const status = (
    <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
      {probe.kind === "ok"
        ? t("settingsPage.selfHosted.testOk", { count: probe.count, host: probe.host })
        : probe.kind === "fail"
          ? probe.code === "sealed"
            ? t("routes.state.sealed")
            : probe.code === "httpsRequired"
              ? t("settingsPage.selfHosted.testHttpsRequired")
              : t("settingsPage.selfHosted.testFail", { host: probe.host })
          : ""}
    </p>
  );

  if (!onUse) {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-xs font-medium text-foreground">
          {t("settingsPage.selfHosted.serverUrl")}
        </p>
        <p dir="ltr" className="font-mono text-xs text-foreground">
          {url || t("settingsPage.selfHosted.notSet")}
        </p>
        {model && (
          <p dir="ltr" className="font-mono text-xs text-muted-foreground">
            {model}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t("settingsPage.selfHosted.sharedReadOnly")}
        </p>
        <div className="flex items-center gap-2">{testButton(url)}</div>
        {status}
      </div>
    );
  }

  return (
    <div className="space-y-2.5 rounded-lg border border-border p-3">
      <EndpointDraft
        label={t("settingsPage.selfHosted.serverUrl")}
        url={url}
        urlPlaceholder={placeholderUrl}
        model={service === "transcription" ? (model ?? "") : undefined}
        modelLabel={t("common.model")}
        modelPlaceholder="whisper-large-v3-turbo"
        useLabel={t("staging.useServer")}
        onUse={onUse}
        actions={(draft) => testButton(draft.url)}
      />
      {status}
    </div>
  );
}
