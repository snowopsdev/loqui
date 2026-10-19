import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CodexConnection from "../CodexConnection";
import { RouteDestinationChip, RouteStateChip } from "../settings/routing/RouteChips";
import { Button } from "../ui/button";
import type { ResolvedRoute } from "../../lib/routes";
import type { CleanupChoice, CleanupStatus } from "../../utils/onboardingCleanup";
import type { TextOperationDescriptor } from "../../services/ai/personalInferenceTypes";
import {
  cleanupPreview,
  cleanupSituation,
  countWords,
  copyCleanupDescriptor,
  type CleanupRun,
} from "../../utils/onboardingCleanupPreview";
import { cleanupErrorKey, type SetupCleanupOperation } from "./cleanupRunner";
import { RadioCardGroup } from "./RadioCardGroup";

/** Historical disclosure only. This grants no permission to send or retry. */
export interface CleanupRemoteAttempt {
  readonly count: number;
  readonly provider: string;
}

export interface CleanupStepProps {
  choice: CleanupChoice;
  status: CleanupStatus;
  onChoose(choice: CleanupChoice): void;
  userText: string | null;
  route: ResolvedRoute;
  providerLabel: string;
  lastRemoteAttempt: CleanupRemoteAttempt | null;
  onRemoteAttempt(attempt: CleanupRemoteAttempt): void;
  selection: TextOperationDescriptor | null;
  isSelectionCurrent(selection: TextOperationDescriptor): boolean;
  runCleanup(
    text: string,
    selection: TextOperationDescriptor,
    isCurrent: () => boolean
  ): SetupCleanupOperation;
  reuse: boolean;
  onReuseChange(value: boolean): void;
}
const CHOICES = ["none", "local", "codex", "provider"] as const;

/** A new render context has no old permission, result or running presentation.
 * Generation identity also fences A→B→A. Main capture remains the authority.
 */
export function CleanupStep(props: CleanupStepProps) {
  const sentence = props.userText?.trim() || null;
  const selection = props.selection ? copyCleanupDescriptor(props.selection) : null;
  const { route } = props;
  const providerLabel =
    route.locality === "network" && route.host ? route.host : props.providerLabel;
  const fingerprint = JSON.stringify([
    props.choice,
    props.status,
    sentence,
    selection,
    route.id,
    route.locality,
    route.providerId,
    route.host,
    route.model,
    route.settingsPath,
    route.state,
  ]);
  const context = useRef({ fingerprint, generation: 0 });
  if (context.current.fingerprint !== fingerprint)
    context.current = { fingerprint, generation: context.current.generation + 1 };
  const identity = context.current;
  const { t } = useTranslation();
  const situation = cleanupSituation(props.choice, props.status, route);
  const now =
    situation === "ready"
      ? t(
          route.locality === "network"
            ? "setupFlow.cleanup.now.readyNetwork"
            : "setupFlow.cleanup.now.ready",
          {
            name: route.model ?? providerLabel,
            provider: providerLabel,
          }
        )
      : t(`setupFlow.cleanup.now.${situation}`, { provider: providerLabel });
  const showRouteState =
    props.choice !== "none" && props.status === "ready" && route.state.status !== "off";
  return (
    <>
      <section className="onb-card" aria-labelledby="onb-cleanup-title">
        <h2 id="onb-cleanup-title" className="onb-card__title">
          {t("setupFlow.cleanup.title")}
        </h2>
        <RadioCardGroup
          label={t("setupFlow.cleanup.label")}
          idPrefix="onb-cleanup"
          variant="segmented"
          value={props.choice}
          onChange={props.onChoose}
          options={CHOICES.map((value) => ({
            value,
            label: t(`setupFlow.cleanup.options.${value}`),
          }))}
        />
        <CleanupContext
          key={identity.generation}
          {...props}
          providerLabel={providerLabel}
          selection={selection}
          isContextCurrent={() => context.current === identity}
        />
      </section>
      {props.choice === "codex" ? (
        <CodexConnection onSignedInChange={() => props.onChoose("codex")} />
      ) : null}
      <p className="onb-muted" role="status">
        {showRouteState ? <RouteStateChip state={route.state} /> : null} {now}
      </p>
      <label className="onb-check">
        <input
          type="checkbox"
          dir="ltr"
          checked={props.reuse}
          onChange={(event) => props.onReuseChange(event.target.checked)}
        />
        <span>{t("setupFlow.cleanup.reuse")}</span>
      </label>
    </>
  );
}

function CleanupContext(
  props: CleanupStepProps & {
    isContextCurrent(): boolean;
  }
) {
  const { choice, status, userText, route, providerLabel, selection, runCleanup } = props;
  const { t } = useTranslation();
  const [run, setRun] = useState<CleanupRun | null>(null);
  const [attempt, setAttempt] = useState<{ running: boolean; error: string | null } | null>(null);
  const owner = useRef<SetupCleanupOperation | null>(null);
  const mounted = useRef(true);
  const situation = cleanupSituation(choice, status, route);
  const sentence = userText?.trim() || null;
  const onDevice = route.locality === "device";
  const mayAdmit =
    choice !== "none" && situation === "ready" && sentence !== null && selection !== null;
  const current = () =>
    mounted.current &&
    props.isContextCurrent() &&
    selection !== null &&
    props.isSelectionCurrent(selection);
  const admit = () => {
    if (!mayAdmit || owner.current || !current()) return;
    if (!onDevice) props.onRemoteAttempt({ count: countWords(sentence), provider: providerLabel });
    setRun(null);
    setAttempt({ running: true, error: null });
    let operation: SetupCleanupOperation;
    try {
      // The device effect or named/count tap is the admission. The callback
      // captures config and text synchronously, before any import/IPC await.
      operation = runCleanup(sentence, selection, current);
    } catch (error) {
      if (current())
        setAttempt({
          running: false,
          error: (error as { code?: string }).code || "CLEANUP_FAILED",
        });
      return;
    }
    owner.current = operation;
    void operation.result
      .then(
        (text) => {
          if (current() && owner.current === operation) setRun({ text, locality: route.locality });
        },
        (error) => {
          if (current() && owner.current === operation)
            setAttempt({
              running: false,
              error: (error as { code?: string }).code || "CLEANUP_FAILED",
            });
        }
      )
      .finally(() => {
        operation.retire();
        if (owner.current !== operation) return;
        owner.current = null;
        if (current())
          setAttempt((previous) => (previous ? { ...previous, running: false } : previous));
      });
  };
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const old = owner.current;
      owner.current = null;
      old?.retire();
    };
  }, []);
  useEffect(() => {
    // One automatic attempt for this valid device context. Callback identity
    // changes cannot re-run it. Every off-device attempt belongs to its tap.
    if (onDevice) admit();
    // Context is keyed by the complete request/route/choice/sentence fingerprint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preview = cleanupPreview({
    choice,
    userText,
    run,
    examples: {
      original: t("setupFlow.cleanup.example.original"),
      local: t("setupFlow.cleanup.example.local"),
      codex: t("setupFlow.cleanup.example.codex"),
      provider: t("setupFlow.cleanup.example.provider"),
    },
  });
  const offerConsent = mayAdmit && !onDevice && !attempt?.running && run === null;
  return (
    <>
      {attempt?.error ? (
        <div className="onb-cleanup-error" role="alert">
          <p>{t(cleanupErrorKey(attempt.error), { provider: providerLabel })}</p>
          {!onDevice ? (
            <p>
              {t("setupFlow.cleanup.attemptNotice", {
                count: countWords(sentence ?? ""),
                provider: providerLabel,
              })}
            </p>
          ) : null}
          <p className="onb-eyebrow">{t("setupFlow.cleanup.original")}</p>
          <p dir="auto">{sentence}</p>
        </div>
      ) : (
        <div className="onb-panes" data-source={preview.source}>
          <div className="onb-pane">
            <p className="onb-eyebrow">{t("setupFlow.cleanup.original")}</p>
            <p dir="auto">{preview.original}</p>
          </div>
          <div className="onb-pane onb-pane--after">
            <p className="onb-eyebrow">{t("setupFlow.cleanup.withCleanup")}</p>
            <p dir="auto">
              {preview.segments.map((segment, index) => (
                <span key={index}>
                  {index > 0 ? " " : ""}
                  {segment.changed ? <mark>{segment.text}</mark> : segment.text}
                </span>
              ))}
            </p>
          </div>
        </div>
      )}
      <div className="onb-reco__meta">
        {choice === "none" ? (
          <span>{t("setupFlow.cleanup.nothingChanges")}</span>
        ) : (
          <RouteDestinationChip route={route} />
        )}
        {!onDevice && !attempt?.error && choice !== "none" ? (
          <span>
            {t(run ? "setupFlow.cleanup.sentNotice" : "setupFlow.cleanup.wordsSent", {
              count: preview.wordsSent ?? countWords(sentence ?? preview.original),
              provider: providerLabel,
            })}
          </span>
        ) : null}
        {attempt?.running ? <span role="status">{t("setupFlow.cleanup.running")}</span> : null}
      </div>
      {!attempt &&
      preview.source === "example" &&
      choice !== "none" &&
      (onDevice || !props.lastRemoteAttempt) ? (
        <p className="onb-muted">
          {t(onDevice ? "setupFlow.cleanup.localExampleNotice" : "setupFlow.cleanup.exampleNotice")}
        </p>
      ) : null}
      {props.lastRemoteAttempt && !attempt ? (
        <p className="onb-muted">
          {t("setupFlow.cleanup.previousAttemptNotice", {
            count: props.lastRemoteAttempt.count,
            provider: props.lastRemoteAttempt.provider,
          })}
        </p>
      ) : null}
      {attempt?.running && !onDevice ? (
        <p className="onb-muted">{t("setupFlow.cleanup.exampleInProgress")}</p>
      ) : null}
      {offerConsent ? (
        <Button size="sm" variant="outline" className="onb-cleanup-consent" onClick={admit}>
          {t("setupFlow.cleanup.tryMine", {
            count: countWords(sentence),
            provider: providerLabel,
          })}
        </Button>
      ) : null}
    </>
  );
}
