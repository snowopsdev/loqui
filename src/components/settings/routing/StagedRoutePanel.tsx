import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { providerDisplayLabel } from "../../../lib/locality";
import { useResolvedRoutes, type CredentialId, type RouteId } from "../../../lib/routes";
import type { RouteTarget } from "../../../lib/routePlanner";
import { useRouteDraftStore } from "../../../stores/routeDraftStore";
import { saveSecret, useSettingsStore, type SettingsState } from "../../../stores/settingsStore";
import ApiKeyInput, { type AcknowledgedSecretSave } from "../../ui/ApiKeyInput";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { stepLinear } from "../../ui/rovingNav";
import { EndpointDraft } from "./EndpointDraft";
import {
  capabilityOf,
  credentialFor,
  hasSavedCredential,
  modelsForRoute,
  providersForRoute,
  setsUpInEditor,
  type StagedModelOption,
} from "./providerCatalog";
import { useRouteChange } from "./useRouteChange";
import { routeDraftTarget } from "./stagedTarget";

export interface StagedProviderOption {
  id: string;
  name: string;
  key: "saved" | "missing" | "none";
}
export interface StagedCredentialInput {
  storeKey: string;
  label: string;
  value: string;
  // R2-3: the exact ApiKeyInput callback type. Never cast, never dropped.
  save: AcknowledgedSecretSave;
}
export interface StagedRoutePanelViewProps {
  routeId: RouteId;
  target: RouteTarget;
  providers: StagedProviderOption[];
  credential: { credentialId: CredentialId; inputs: StagedCredentialInput[] } | null;
  models: StagedModelOption[];
  sharedServerUrl: string | null;
  onTarget: (target: RouteTarget) => void;
  // R2-9: provider setup that readiness needs (Task 9: Codex sign-in, enterprise fields).
  setup?: ReactNode;
}

// A typed model id for providers without a registry list (OpenRouter, Codex,
// enterprise deployments). A local draft until "Use this model".
function ModelIdDraft({ value, onUse }: { value: string; onUse: (model: string) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-foreground">
        {t("staging.modelId")}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          dir="ltr"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-8 max-w-xs text-sm"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-action="use-model"
          disabled={!draft.trim() || draft.trim() === value}
          onClick={() => onUse(draft.trim())}
        >
          {t("staging.useModel")}
        </Button>
      </div>
    </div>
  );
}

export function StagedRoutePanelView({
  routeId,
  target,
  providers,
  credential,
  models,
  sharedServerUrl,
  onTarget,
  setup,
}: StagedRoutePanelViewProps) {
  const { t, i18n } = useTranslation();
  const modelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusedModel, setFocusedModel] = useState<string | null>(null);
  const selectedModel = models.findIndex((option) => option.id === target.model);
  const focusedIndex = models.findIndex((option) => option.id === focusedModel);
  const tabStop = focusedIndex >= 0 ? focusedIndex : Math.max(0, selectedModel);
  if (target.mode === "local") return null;
  const task = t(`routes.names.${routeId}`);
  const chosen = target.mode === "providers" ? target.provider : "";
  const text = capabilityOf(routeId) !== "speech";
  const model = target.model ?? "";
  return (
    <section
      aria-label={t("staging.region")}
      className="space-y-3 rounded-lg border border-dashed border-locality-remote/70 bg-locality-remote/5 px-4 py-3 text-xs text-foreground"
    >
      <div>
        <p className="text-sm font-semibold text-foreground">
          {target.mode === "self-hosted"
            ? t("staging.server.title", { task })
            : t("staging.cloud.title", { task })}
        </p>
        <p className="mt-1 text-muted-foreground">
          {target.mode === "self-hosted" ? t("staging.server.body") : t("staging.cloud.body")}
        </p>
      </div>
      {target.mode === "providers" && (
        <div role="group" aria-label={t("staging.provider")} className="flex flex-wrap gap-1.5">
          {providers.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={chosen === option.id}
              onClick={() => onTarget({ mode: "providers", provider: option.id })}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                chosen === option.id
                  ? "border-ring bg-background ring-1 ring-ring"
                  : "border-muted-foreground bg-background"
              }`}
            >
              {option.name}
              {option.key !== "none" && (
                <span className="text-muted-foreground">
                  {option.key === "saved" ? t("staging.keySaved") : t("staging.noKey")}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {target.mode === "providers" && setsUpInEditor(chosen) && (
        <p className="text-muted-foreground">
          {t("staging.setupHere", { provider: providerDisplayLabel(chosen, t) })}
        </p>
      )}
      {setup}
      {credential?.inputs.map((input) => (
        <ApiKeyInput
          key={input.storeKey}
          apiKey={input.value}
          setApiKey={input.save}
          label={input.label}
        />
      ))}
      {/* R2-9: the model is chosen here, before Apply; picking one re-plans the draft and commits nothing. */}
      {target.mode === "providers" && chosen && chosen !== "custom" && models.length > 0 && (
        <div
          role="radiogroup"
          aria-label={t("staging.model")}
          className="flex flex-wrap gap-1.5"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setFocusedModel(null);
          }}
        >
          {models.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={model === option.id}
              tabIndex={index === tabStop ? 0 : -1}
              ref={(element) => {
                modelRefs.current[index] = element;
              }}
              onFocus={() => setFocusedModel(option.id)}
              onKeyDown={(event) => {
                const direction =
                  event.currentTarget.closest("[dir]")?.getAttribute("dir") ?? i18n?.dir?.();
                const next = stepLinear(
                  index,
                  event.key,
                  models.map(() => false),
                  direction === "rtl"
                );
                if (next === index) return;
                event.preventDefault();
                setFocusedModel(models[next].id);
                modelRefs.current[next]?.focus();
              }}
              onClick={() => onTarget({ mode: "providers", provider: chosen, model: option.id })}
              className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                model === option.id
                  ? "border-ring bg-background ring-1 ring-ring"
                  : "border-muted-foreground bg-background"
              }`}
            >
              {option.name}
            </button>
          ))}
        </div>
      )}
      {/* The enterprise clouds take their deployment or model id in Task 9's setup slot. */}
      {target.mode === "providers" &&
        chosen &&
        chosen !== "custom" &&
        models.length === 0 &&
        (chosen === "codex" || !setsUpInEditor(chosen)) && (
          <ModelIdDraft
            value={model}
            onUse={(next) => onTarget({ mode: "providers", provider: chosen, model: next })}
          />
        )}
      {target.mode === "providers" && chosen === "custom" && (
        <EndpointDraft
          label={t("staging.endpointUrl")}
          url={target.baseUrl ?? ""}
          urlPlaceholder="https://your-endpoint.example/v1"
          model={model}
          modelLabel={t("staging.modelId")}
          modelPlaceholder={text ? "gpt-4o-mini" : "whisper-1"}
          useLabel={t("staging.useEndpoint")}
          onUse={({ url, model: next }) =>
            onTarget({
              mode: "providers",
              provider: "custom",
              baseUrl: url,
              ...(next ? { model: next } : {}),
            })
          }
        />
      )}
      {target.mode === "self-hosted" && sharedServerUrl !== null && (
        <p className="text-muted-foreground">
          {t("staging.sharedWithDictation", { url: sharedServerUrl || "—" })}
        </p>
      )}
      {target.mode === "self-hosted" && sharedServerUrl === null && (
        <EndpointDraft
          label={t("staging.serverUrl")}
          url={target.remoteUrl}
          urlPlaceholder={
            capabilityOf(routeId) === "speech"
              ? "http://localhost:8178"
              : "http://localhost:11434/v1"
          }
          model={model}
          modelLabel={t("staging.modelId")}
          modelPlaceholder={text ? "llama3" : "whisper-large-v3-turbo"}
          useLabel={t("staging.useServer")}
          onUse={({ url, model: next }) =>
            onTarget({ mode: "self-hosted", remoteUrl: url, ...(next ? { model: next } : {}) })
          }
        />
      )}
    </section>
  );
}

export function StagedRoutePanel({ routeId }: { routeId: RouteId }) {
  const { t } = useTranslation();
  const draft = useRouteDraftStore((s) => s.draft);
  const settings = useSettingsStore();
  useResolvedRoutes(); // local facts and canonical settings keep the prospective setup live
  const { requestDraftTarget, copy } = useRouteChange();
  const target = draft ? routeDraftTarget(draft, copy, routeId) : null;
  if (!draft || !target || target.mode === "local") return null;
  const providers = providersForRoute(routeId).map((id): StagedProviderOption => {
    const spec = credentialFor(routeId, id);
    return {
      id,
      name: providerDisplayLabel(id, t),
      key:
        spec === null
          ? "none"
          : hasSavedCredential(spec, settings as SettingsState)
            ? "saved"
            : "missing",
    };
  });
  const chosen = target.mode === "providers" ? target.provider : "";
  const spec = chosen ? credentialFor(routeId, chosen) : null;
  return (
    <StagedRoutePanelView
      routeId={routeId}
      target={target}
      providers={providers}
      credential={
        spec
          ? {
              credentialId: spec.credentialId,
              inputs: spec.fields.map((field) => ({
                storeKey: field.storeKey as string,
                label: t(field.labelKey),
                value: String(settings[field.storeKey as keyof SettingsState] ?? ""),
                // I3, R2-3: the acknowledged save's promise is returned to ApiKeyInput unchanged.
                save: (value: string) => saveSecret(field.storeKey, value),
              })),
            }
          : null
      }
      models={modelsForRoute(routeId, chosen)}
      sharedServerUrl={routeId === "uploadStt" ? settings.remoteTranscriptionUrl : null}
      // Every choice re-plans: a device result applies now, anything else re-stages
      // (keeping setup typed for the same provider, Task 7).
      onTarget={(next) => void requestDraftTarget(draft.routeId, next, routeId)}
    />
  );
}
