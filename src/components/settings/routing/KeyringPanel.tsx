/* eslint-disable react-refresh/only-export-components -- Task12 publishes these tested helpers with its panel. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { providerDisplayLabel } from "../../../lib/locality";
import {
  useResolvedRoutes,
  type CredentialId,
  type ResolvedRoute,
  type RouteId,
} from "../../../lib/routes";
import { getSealed, useSealedStore } from "../../../stores/sealedStore";
import { flushSecretSaves, useSettingsStore } from "../../../stores/settingsStore";
import type {
  KeyHealthStatus,
  KeyringAPI,
  KeyringEntry,
  KeyringIdentity,
  KeyringVerifyOptions,
  KeyringVerifyOutcome,
  VerifyTargetDescription,
} from "../../../types/electron";
import { formatRelativeTime } from "../../../utils/dateFormatting";
import { Loader2 } from "../../icons";
import { Button } from "../../ui/button";
import { BIDI_VALUE_TOKEN, BidiInterpolatedText } from "../../ui/BidiInterpolatedText";
import { Toggle } from "../../ui/toggle";
import { credentialIdFor } from "./destinations";

type Tr = (key: string, options?: Record<string, unknown>) => string;

// Status has words as well as a locality/status mark. No voice accent is used.
export const STATUS_DOT: Record<KeyHealthStatus, string> = {
  verified: "bg-locality-device",
  unverified: "bg-locality-remote",
  unreachable: "bg-locality-remote",
  rejected: "bg-destructive",
};

// Rows exist only for Task 11's 12 keyring identities; the provider name
// always comes from the entry's providerId.
export function keyringIdentityLabel(
  entry: Pick<KeyringEntry, "id" | "providerId">,
  t: Tr
): string {
  const provider = providerDisplayLabel(entry.providerId, t);
  if (entry.id === "corti:text") return t("keyring.identity.cortiText", { provider });
  if (entry.id === "corti:speech") return t("keyring.identity.cortiSpeech", { provider });
  return provider;
}

// R2-6: what Verify sends and to whom, exactly as main's describeVerify
// computed it from the request's own config (Task 11). Never derived from
// inference-route hosts: Corti speech verifies at auth.<region>.corti.app,
// not at its speech API host.
export function verifyTargetText(
  disclosure: VerifyTargetDescription | null,
  t: Tr
): { host: string | null; fields: string } {
  const hosts = disclosure?.hosts ?? [];
  return {
    host: hosts.length > 0 ? hosts.join(", ") : null,
    fields: (disclosure?.fields ?? []).map((field) => t(`keyring.fields.${field}`)).join(", "),
  };
}

// Task 11's testConfigFor reads options only for Corti speech (the auth
// server depends on region and tenant). Copy when describing, never written.
export function keyringVerifyOptions(
  id: KeyringIdentity,
  settings: { cortiEnvironment: string; cortiTenant: string }
): KeyringVerifyOptions | undefined {
  if (id !== "corti:speech") return undefined;
  return { cortiEnvironment: settings.cortiEnvironment, cortiTenant: settings.cortiTenant };
}

export function pausedTasksByCredential(
  routes: Pick<ResolvedRoute, "id" | "kind" | "providerId" | "state">[]
): Partial<Record<CredentialId, RouteId[]>> {
  const map: Partial<Record<CredentialId, RouteId[]>> = {};
  for (const route of routes) {
    if (route.state.status !== "needsKey") continue;
    const id = credentialIdFor(route.providerId, route.kind);
    if (id === null) continue;
    (map[id] ??= []).push(route.id);
  }
  return map;
}

export function keyringStatusLine(
  entry: KeyringEntry,
  pausedTaskNames: string[],
  t: Tr,
  locale: string,
  host: string | null
): { text: string; tone: "muted" | "error" } {
  if (entry.unknown) return { text: t("keyring.unknown"), tone: "muted" };
  if (!entry.lastVerifiedAt) return { text: t("keyring.never"), tone: "muted" };
  const when = formatRelativeTime(new Date(entry.lastVerifiedAt).toISOString(), t, locale);
  const parts = [t("keyring.lastVerified", { when })];
  if (entry.status === "rejected") {
    parts.push(
      entry.lastErrorStatus !== null
        ? t("keyring.rejected", { status: entry.lastErrorStatus })
        : t("keyring.rejectedNoStatus")
    );
  }
  if (entry.status === "unreachable") {
    parts.push(host ? t("keyring.unreachable", { host }) : t("keyring.unreachableNoHost"));
  }
  if (pausedTaskNames.length > 0 && entry.status === "rejected") {
    parts.push(t("keyring.paused", { tasks: pausedTaskNames.join(", ") }));
  }
  return { text: parts.join(" · "), tone: entry.status === "rejected" ? "error" : "muted" };
}

// ---- controller -------------------------------------------------------

// Task 11's KeyringAPI; onChanged is optional so the browser preview and
// tests can omit it.
export type KeyringApi = Pick<KeyringAPI, "list" | "verify" | "setReminder"> &
  Partial<Pick<KeyringAPI, "onChanged" | "describeVerify">>;
export type KeyringNotice =
  | { kind: "superseded" | "sealed" | "recipientChanged" | "unavailable" | "failed" }
  | { kind: "invalidOptions"; environment: string; tenant: string };
export interface KeyringController {
  entries: KeyringEntry[];
  loadError: boolean;
  /** A successful list matching the current request, API and options. */
  loaded: boolean;
  checking: KeyringIdentity | null;
  progress: { current: number; total: number } | null;
  notices: Partial<Record<KeyringIdentity, KeyringNotice>>;
  disclosures: Partial<Record<KeyringIdentity, VerifyTargetDescription>>;
  verify: (id: KeyringIdentity) => Promise<void>;
  verifyAll: () => Promise<void>;
  setReminder: (id: KeyringIdentity, enabled: boolean) => Promise<void>;
}
type Description = {
  target: VerifyTargetDescription;
  options: KeyringVerifyOptions | undefined;
  context: string;
  api: KeyringApi;
};
export function useKeyringController(deps: {
  api: KeyringApi | undefined;
  flush: () => Promise<void>;
  getSealed: () => boolean;
  verifyOptions?: (id: KeyringIdentity) => KeyringVerifyOptions | undefined;
  optionsKey?: string;
  onCredentialsChanged?: (callback: () => void) => () => void;
}): KeyringController {
  const [listed, setListed] = useState<{
    entries: KeyringEntry[];
    context: string;
    api: KeyringApi;
    request: number;
  } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [checking, setChecking] = useState<KeyringIdentity | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [notices, setNotices] = useState<Partial<Record<KeyringIdentity, KeyringNotice>>>({});
  const [described, setDescribed] = useState<Partial<Record<KeyringIdentity, Description>>>({});
  const live = useRef(deps);
  live.current = deps;
  const alive = useRef(true);
  const requestSeq = useRef(0);
  const running = useRef(false);
  const entriesRef = useRef<KeyringEntry[]>([]);
  // This is only renderer request ordering. Main alone owns config fingerprints
  // and credential generations; neither is synthesized here.
  const contextFor = () =>
    JSON.stringify([
      live.current.optionsKey ?? "",
      live.current.verifyOptions?.("corti:speech") ?? null,
    ]);
  const context = contextFor();
  const optionsFor = (id: KeyringIdentity) => {
    const options = live.current.verifyOptions?.(id);
    return options ? Object.freeze({ ...options }) : undefined;
  };
  const loaded = Boolean(
    listed !== null &&
    listed.api === deps.api &&
    listed.context === context &&
    listed.request === requestSeq.current
  );
  const entries = loaded
    ? listed.entries
    : (listed?.entries ?? []).map((entry) => ({
        ...entry,
        status: "unverified" as const,
        unknown: true,
        lastVerifiedAt: null,
        lastErrorCode: null,
        lastErrorStatus: null,
      }));
  const disclosures = Object.fromEntries(
    Object.entries(described)
      .filter(([, value]) => value?.api === deps.api && value.context === context)
      .map(([id, value]) => [id, value!.target])
  ) as KeyringController["disclosures"];

  const refresh = useCallback(async () => {
    const api = live.current.api;
    const seq = ++requestSeq.current;
    const capturedContext = contextFor();
    const cortiOptions = optionsFor("corti:speech");
    setDescribed({});
    if (!api) {
      entriesRef.current = [];
      setListed(null);
      setLoadError(true);
      return;
    }
    const current = () =>
      alive.current &&
      seq === requestSeq.current &&
      api === live.current.api &&
      capturedContext === contextFor();
    try {
      const next = await api.list(cortiOptions);
      if (!current()) return;
      entriesRef.current = next;
      setListed({ entries: next, context: capturedContext, api, request: seq });
      setLoadError(false);
      const pairs = await Promise.all(
        next.map(async (entry) => {
          const options = optionsFor(entry.id);
          if (entry.unknown || !api.describeVerify) return [entry.id, null] as const;
          try {
            const target = await api.describeVerify(entry.id, options);
            // Copy the displayed disclosure; no response object can mutate an admitted click.
            return [
              entry.id,
              {
                target: { ...target, hosts: [...target.hosts], fields: [...target.fields] },
                options,
                context: capturedContext,
                api,
              },
            ] as const;
          } catch {
            return [entry.id, null] as const;
          }
        })
      );
      if (current()) setDescribed(Object.fromEntries(pairs.filter(([, value]) => value !== null)));
    } catch {
      if (current()) setLoadError(true);
    }
  }, []);
  const api = deps.api;
  useEffect(() => {
    alive.current = true;
    void refresh();
    const stop = api?.onChanged?.(() => {
      void refresh();
    });
    return () => {
      alive.current = false;
      stop?.();
    };
  }, [api, context, refresh]);
  const onCredentialsChanged = deps.onCredentialsChanged;
  useEffect(
    () =>
      onCredentialsChanged?.(() => {
        void refresh();
      }),
    [onCredentialsChanged, refresh]
  );
  const setNotice = (id: KeyringIdentity, notice: KeyringNotice | null) => {
    if (!alive.current) return;
    setNotices((previous) => {
      const next = { ...previous };
      if (notice) next[id] = notice;
      else delete next[id];
      return next;
    });
  };
  const admission = (id: KeyringIdentity) => {
    const description = described[id];
    if (
      !entries.some((entry) => entry.id === id && !entry.unknown) ||
      description?.api !== deps.api ||
      description.context !== context ||
      description.context !== contextFor() ||
      description.api !== live.current.api ||
      !description.target.hosts.length ||
      !description.target.recipientToken
    )
      return null;
    // At the click, before ANY await: capture exactly the displayed token and options.
    return {
      api: description.api,
      options: Object.freeze({
        ...description.options,
        recipientToken: description.target.recipientToken,
      }),
    };
  };
  const runVerify = async (
    id: KeyringIdentity,
    admitted: NonNullable<ReturnType<typeof admission>>
  ): Promise<KeyringVerifyOutcome | null> => {
    setNotice(id, null);
    setChecking(id);
    try {
      await live.current.flush();
      if (!alive.current || admitted.api !== live.current.api) return null;
      if (live.current.getSealed()) {
        setNotice(id, { kind: "sealed" });
        return "sealed";
      }
      const { outcome } = await admitted.api.verify(id, admitted.options);
      if (!alive.current || admitted.api !== live.current.api) return null;
      // Verify.entry is intentionally ignored. Only current-options list may paint health.
      if (["superseded", "sealed", "recipientChanged", "unavailable"].includes(outcome))
        setNotice(id, {
          kind: outcome as "superseded" | "sealed" | "recipientChanged" | "unavailable",
        });
      if (outcome === "invalidOptions")
        setNotice(id, {
          kind: "invalidOptions",
          environment: admitted.options.cortiEnvironment ?? "",
          tenant: admitted.options.cortiTenant ?? "",
        });
      return outcome;
    } catch {
      setNotice(id, { kind: "failed" });
      return null;
    } finally {
      if (alive.current) {
        setChecking(null);
        await refresh();
      }
    }
  };
  const verify = async (id: KeyringIdentity) => {
    if (running.current || deps.getSealed()) return;
    const admitted = admission(id);
    if (!admitted) return;
    running.current = true;
    try {
      await runVerify(id, admitted);
    } finally {
      running.current = false;
    }
  };
  const verifyAll = async () => {
    if (running.current || deps.getSealed() || entries.length === 0) return;
    const admissions = entries.map((entry) => ({ id: entry.id, binding: admission(entry.id) }));
    if (admissions.some(({ binding }) => !binding)) return;
    running.current = true;
    try {
      for (const [index, { id, binding }] of admissions.entries()) {
        if (!alive.current || live.current.getSealed()) break;
        if (!entriesRef.current.some((entry) => entry.id === id)) continue;
        setProgress({ current: index + 1, total: admissions.length });
        // Retain the entire action's reviewed bindings through refreshes between rows.
        const outcome = await runVerify(id, binding!);
        if (outcome === "sealed" || outcome === null) break;
      }
    } finally {
      if (alive.current) setProgress(null);
      running.current = false;
    }
  };
  const setReminder = async (id: KeyringIdentity, enabled: boolean) => {
    if (!entries.some((entry) => entry.id === id && !entry.unknown)) return;
    try {
      await live.current.api?.setReminder(id, enabled);
    } catch {
      setNotice(id, { kind: "failed" });
    } finally {
      if (alive.current) await refresh();
    }
  };
  return {
    entries,
    loadError,
    loaded,
    checking,
    progress,
    notices,
    disclosures,
    verify,
    verifyAll,
    setReminder,
  };
}

// ---- view -------------------------------------------------------------

export interface KeyringPanelViewProps {
  entries: KeyringEntry[];
  paused: Partial<Record<CredentialId, string[]>>; // translated task names
  notices: Partial<Record<KeyringIdentity, KeyringNotice>>;
  disclosureOf: (entry: KeyringEntry) => VerifyTargetDescription | null;
  checking: KeyringIdentity | null;
  progress: { current: number; total: number } | null;
  sealed: boolean;
  loadError: boolean;
  loaded?: boolean;
  onVerify: (id: KeyringIdentity) => void;
  onVerifyAll: () => void;
  onReminder: (id: KeyringIdentity, enabled: boolean) => void;
}

export function KeyringPanelView(props: KeyringPanelViewProps) {
  const { t, i18n } = useTranslation();
  const busy = props.checking !== null || props.progress !== null;
  return (
    <section
      data-setting-id="keyring"
      aria-labelledby="keyring-title"
      className="overflow-hidden rounded-lg border border-border/70 bg-background"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div>
          <h3 id="keyring-title" className="text-sm font-semibold">
            {t("keyring.title")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("keyring.subtitle")}</p>
          {props.sealed && (
            <p className="mt-1 text-xs text-muted-foreground">{t("keyring.sealed")}</p>
          )}
          {props.loadError && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t(props.loaded === false ? "keyring.unavailable" : "keyring.loadFailed")}
            </p>
          )}
        </div>
        <Button
          size="sm"
          className="duration-[var(--motion-fast)]"
          variant="outline"
          onClick={props.onVerifyAll}
          disabled={
            busy ||
            props.sealed ||
            props.entries.length === 0 ||
            props.entries.some(
              (entry) =>
                entry.unknown ||
                !props.disclosureOf(entry)?.hosts.length ||
                !props.disclosureOf(entry)?.recipientToken
            )
          }
          title={t("keyring.verifyAllTooltip")}
        >
          {props.progress ? t("keyring.verifyingAll", props.progress) : t("keyring.verifyAll")}
        </Button>
      </div>
      {props.entries.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {t(
            props.loaded === false
              ? props.loadError
                ? "keyring.unavailable"
                : "keyring.checking"
              : "keyring.empty"
          )}
        </p>
      ) : (
        <ul>
          {props.entries.map((entry) => {
            const identity = keyringIdentityLabel(entry, t);
            const target = verifyTargetText(props.disclosureOf(entry), t);
            const host = target.host;
            const isChecking = props.checking === entry.id;
            const notice = props.notices[entry.id];
            const line = keyringStatusLine(
              entry,
              props.paused[entry.id] ?? [],
              t,
              i18n.language,
              host ? BIDI_VALUE_TOKEN : null
            );
            return (
              <li
                key={entry.id}
                data-credential={entry.id}
                data-checking={isChecking ? "true" : "false"}
                className="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-3 border-b border-border/50 px-4 py-2.5 last:border-b-0"
              >
                {isChecking ? (
                  <span role="img" aria-label={t("keyring.checking")}>
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin [animation-duration:calc(var(--motion-hero)*2)] text-muted-foreground"
                      aria-hidden="true"
                    />
                  </span>
                ) : (
                  <span
                    role="img"
                    aria-label={t(
                      entry.unknown ? "keyring.unknown" : `keyring.status.${entry.status}`
                    )}
                    className={`h-2 w-2 rounded-full ${STATUS_DOT[entry.unknown ? "unverified" : entry.status]}`}
                  />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{identity}</p>
                  <p
                    className={`text-xs ${line.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {isChecking ? (
                      t("keyring.checking")
                    ) : (
                      <BidiInterpolatedText text={line.text} value={host ?? ""} />
                    )}
                  </p>
                  <p data-verify-target={host ?? ""} className="text-xs text-muted-foreground">
                    {host ? (
                      <BidiInterpolatedText
                        text={t("keyring.verifyTarget", {
                          host: BIDI_VALUE_TOKEN,
                          fields: target.fields,
                        })}
                        value={host}
                      />
                    ) : (
                      t("keyring.verifyTargetUnknown")
                    )}
                  </p>
                  {notice && (
                    <p role="status" className="text-xs text-muted-foreground">
                      {notice.kind === "superseded"
                        ? t("keyring.superseded")
                        : notice.kind === "sealed"
                          ? t("keyring.sealed")
                          : notice.kind === "invalidOptions"
                            ? t("keyring.invalidCortiOptions", {
                                environment: notice.environment,
                                tenant: notice.tenant,
                              })
                            : notice.kind === "recipientChanged"
                              ? t("keyring.recipientChanged")
                              : notice.kind === "unavailable"
                                ? t("keyring.unavailable")
                                : t("keyring.verifyFailed")}
                    </p>
                  )}
                </div>
                <div className="col-start-2 flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    className="duration-[var(--motion-fast)]"
                    variant="ghost"
                    onClick={() => props.onVerify(entry.id)}
                    disabled={
                      busy ||
                      props.sealed ||
                      entry.unknown ||
                      host === null ||
                      !props.disclosureOf(entry)?.recipientToken
                    }
                    aria-label={t("keyring.verifyLabel", { identity })}
                    title={
                      entry.unknown
                        ? t("keyring.unknown")
                        : host
                          ? t("keyring.verifyTooltip", { identity, host, fields: target.fields })
                          : t("keyring.verifyTooltipNoHost", { identity })
                    }
                  >
                    {t("keyring.verify")}
                  </Button>
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground [&_*]:duration-[var(--motion-fast)] [&>button]:border [&>button]:border-muted-foreground [&>button]:bg-muted-foreground! [&>button]:hover:bg-muted-foreground! [&>button]:focus-visible:ring-ring!">
                    <Toggle
                      checked={!entry.unknown && entry.reminderDueAt !== null}
                      disabled={entry.unknown}
                      onChange={(on) => props.onReminder(entry.id, on)}
                      aria-label={t("keyring.remindLabel", { identity })}
                    />
                    <span aria-hidden="true">{t("keyring.remind")}</span>
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function KeyringPanel() {
  const { t } = useTranslation();
  const routes = useResolvedRoutes();
  const sealed = useSealedStore((s) => s.sealed);
  // R2-6: Corti speech's verification host depends on these, so a change
  // re-asks main (never a host map frozen at mount).
  const cortiEnvironment = useSettingsStore((s) => s.cortiEnvironment);
  const cortiTenant = useSettingsStore((s) => s.cortiTenant);
  const controller = useKeyringController({
    api: window.electronAPI?.keyring as KeyringApi | undefined,
    flush: flushSecretSaves,
    getSealed,
    // Read-only: the keyring never writes provider/model/endpoint or Corti
    // region fields; those change only through the route planner. The same
    // options go to describeVerify and to verify.
    verifyOptions: (id) => keyringVerifyOptions(id, useSettingsStore.getState()),
    optionsKey: JSON.stringify([cortiEnvironment, cortiTenant]),
    onCredentialsChanged: window.electronAPI?.credentials?.onChanged,
  });
  const paused = useMemo(() => {
    const byCredential = pausedTasksByCredential(routes);
    return Object.fromEntries(
      Object.entries(byCredential).map(([id, ids]) => [
        id,
        ids.map((rid) => t(`routes.names.${rid}`)),
      ])
    ) as Partial<Record<CredentialId, string[]>>;
  }, [routes, t]);
  return (
    <KeyringPanelView
      entries={controller.entries}
      paused={paused}
      notices={controller.notices}
      disclosureOf={(entry) => controller.disclosures[entry.id] ?? null}
      checking={controller.checking}
      progress={controller.progress}
      sealed={sealed}
      loadError={controller.loadError}
      loaded={controller.loaded}
      onVerify={(id) => void controller.verify(id)}
      onVerifyAll={() => void controller.verifyAll()}
      onReminder={(id, on) => void controller.setReminder(id, on)}
    />
  );
}
