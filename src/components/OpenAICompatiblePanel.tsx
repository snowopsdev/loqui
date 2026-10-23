import type { ModelDiscoveryDescription } from "../services/ai/personalInferenceTypes";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { normalizeBaseUrl } from "../config/constants";
import { credentialSlotForRef } from "../lib/credentialSlots";
import { providerDisplayLabel } from "../lib/locality";
import { SCOPE_ROUTE, type LlmRouteScope } from "../lib/routes";
import { useSealedStore } from "../stores/sealedStore";
import { isSecureHttpEndpoint } from "../utils/urlUtils";
import { EndpointDraft } from "./settings/routing/EndpointDraft";
import ApiKeyInput, { type AcknowledgedSecretSave } from "./ui/ApiKeyInput";
import { BIDI_VALUE_TOKEN, BidiInterpolatedText } from "./ui/BidiInterpolatedText";
import { Button } from "./ui/button";
import { GetApiKeyLink } from "./ui/GetApiKeyLink";
import ModelCardList from "./ui/ModelCardList";
import SearchableModelList, { MODEL_SEARCH_THRESHOLD } from "./ui/SearchableModelList";

interface ModelOption {
  value: string;
  label: string;
  description?: string;
  ownedBy?: string;
}

interface OpenAICompatiblePanelProps {
  /** Saved slot main sends with List models: "openrouter" or "custom:<scope>". */
  credentialRef?: string;
  /** The committed endpoint. Edits stay a draft until "Use this endpoint". */
  baseUrl: string;
  onUseEndpoint?: (url: string) => void;
  /** Main-confirmed presence sentinel, never a raw key. */
  apiKey: string;
  /** R2-3: Task 2's exact acknowledged-save type, handed to ApiKeyInput unchanged. */
  saveApiKey: AcknowledgedSecretSave;
  model: string;
  onSelectModel: (model: string) => void;
  defaultBaseUrl?: string;
  baseUrlPlaceholder?: string;
  helpExamples?: ReactNode;
  // Hide the endpoint editor when the URL is fixed by the caller (e.g. OpenRouter).
  lockedBaseUrl?: boolean;
  // Providers whose /models is public but whose inference needs a key.
  apiKeyRequired?: boolean;
  getKeyUrl?: string;
}

type Listing = { base: string; identity: string } & (
  { kind: "loading" } | { kind: "done"; models: ModelOption[] } | { kind: "error"; message: string }
);

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function credentialSlotLabel(credentialRef: string, t: TranslateFn): string {
  if (credentialRef.startsWith("custom:")) {
    const scope = credentialRef.slice(7) as LlmRouteScope;
    const route = SCOPE_ROUTE[scope];
    return t("reasoning.custom.slotCustom", { task: route ? t(`routes.names.${route}`) : scope });
  }
  return t("reasoning.custom.slotProvider", { provider: providerDisplayLabel(credentialRef, t) });
}

// Non-conformant endpoints may return numeric ids or object descriptions.
function toModelOptions(data: unknown, t: TranslateFn): ModelOption[] {
  const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  return rows
    .map((item) => {
      const rawValue = item?.id ?? item?.name;
      if (rawValue === undefined || rawValue === null || rawValue === "") return null;
      const value = String(rawValue);
      const ownedBy = typeof item?.owned_by === "string" ? item.owned_by : undefined;
      const description =
        typeof item?.description === "string" && item.description
          ? item.description
          : ownedBy
            ? t("reasoning.custom.ownerLabel", { owner: ownedBy })
            : undefined;
      return { value, label: value, description, ownedBy } as ModelOption;
    })
    .filter(Boolean) as ModelOption[];
}

export default function OpenAICompatiblePanel({
  credentialRef = "custom:dictationCleanup",
  baseUrl,
  onUseEndpoint,
  apiKey,
  saveApiKey,
  model,
  onSelectModel,
  defaultBaseUrl,
  baseUrlPlaceholder = "https://api.openai.com/v1",
  helpExamples,
  lockedBaseUrl = false,
  apiKeyRequired = false,
  getKeyUrl,
}: OpenAICompatiblePanelProps) {
  const { t } = useTranslation();
  const sealed = useSealedStore((s) => s.sealed);
  const [listing, setListing] = useState<Listing | null>(null);
  const committedBase = normalizeBaseUrl(baseUrl);
  const identity = JSON.stringify([committedBase, credentialRef]);
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const epoch = useRef(0);
  const reviewed = useRef<ModelDiscoveryDescription | null>(null);
  const [description, setDescription] = useState<{
    identity: string;
    target: ModelDiscoveryDescription;
  } | null>(null);
  const requestInput = useCallback(
    () => ({
      provider: credentialRef === "openrouter" ? "openrouter" : "custom",
      baseUrl: committedBase,
      credentialRef,
      inferenceScope: credentialRef.startsWith("custom:") ? credentialRef.slice(7) : undefined,
    }),
    [committedBase, credentialRef]
  );
  const describe = useCallback(async () => {
    const seq = ++epoch.current;
    reviewed.current = null;
    setDescription(null);
    setListing(null);
    try {
      const target = await window.electronAPI.personalInference.describeModels(requestInput());
      if (seq === epoch.current && latestIdentity.current === identity) {
        reviewed.current = target;
        setDescription({ identity, target });
      }
    } catch {
      /* Unknown authority keeps discovery disabled. */
    }
  }, [identity, requestInput]);
  const invalidate = useCallback(() => {
    ++epoch.current;
    reviewed.current = null;
  }, []);
  useEffect(() => {
    void describe(); // local main metadata only, never discovery
    const unsubscribe = window.electronAPI.credentials?.onChanged(() => {
      void describe();
    });
    return () => {
      invalidate();
      unsubscribe?.();
    };
  }, [describe, invalidate]);
  const target = description?.identity === identity ? description.target : null;
  const host = target?.host ?? null;
  const hasKey = target?.present === true;
  const slot = credentialSlotLabel(credentialRef, t);
  // A list belongs to the endpoint it came from; a committed change hides it, without refetching.
  const current = listing && listing.identity === identity ? listing : null;
  const models = current?.kind === "done" ? current.models : [];

  // C1: the only discovery path. It runs on this click, against the committed
  // host, with the slot the button names (main resolves it, personalInference.js:286-301).
  const listModels = async () => {
    const base = committedBase;
    if (!target || reviewed.current !== target || latestIdentity.current !== identity) return;
    const seq = epoch.current;
    if (!base.includes("://")) {
      setListing({
        base,
        identity,
        kind: "error",
        message: t("reasoning.custom.endpointWithProtocol"),
      });
      return;
    }
    if (!isSecureHttpEndpoint(base)) {
      setListing({ base, identity, kind: "error", message: t("reasoning.custom.httpsRequired") });
      return;
    }
    setListing({ base, identity, kind: "loading" });
    try {
      const payload = await window.electronAPI.personalInference.models({
        ...requestInput(),
        recipientToken: target.recipientToken,
      });
      if (seq !== epoch.current || latestIdentity.current !== identity) return;
      setListing({ base, identity, kind: "done", models: toModelOptions(payload?.data, t) });
    } catch (error) {
      if (seq !== epoch.current || latestIdentity.current !== identity) return;
      void describe(); // refresh disclosure only; a new explicit click is required
      const message = (error as Error).message || t("reasoning.custom.unableToLoadModels");
      const unauthorized = /\b(401|403)\b/.test(message);
      setListing({
        base,
        identity,
        kind: "error",
        message: unauthorized && !hasKey ? t("reasoning.custom.endpointUnauthorized") : message,
      });
    }
  };

  const disclosure =
    !host || !target
      ? t("reasoning.custom.listModelsNeedsEndpoint")
      : hasKey
        ? t("reasoning.custom.listModelsSendsKey", { host, slot })
        : t("reasoning.custom.listModelsNoKey", { host });

  return (
    <>
      {!lockedBaseUrl && (
        <EndpointDraft
          label={t("reasoning.custom.endpointTitle")}
          url={baseUrl}
          urlPlaceholder={baseUrlPlaceholder}
          useLabel={t("staging.useEndpoint")}
          onUse={({ url }) => onUseEndpoint?.(normalizeBaseUrl(url))}
          help={
            helpExamples ?? (
              <p className="text-xs text-muted-foreground">
                {t("reasoning.custom.endpointExamples")}{" "}
                <code dir="ltr" className="text-primary">
                  https://openrouter.ai/api/v1
                </code>{" "}
                (OpenRouter),{" "}
                <code dir="ltr" className="text-primary">
                  https://api.together.xyz/v1
                </code>{" "}
                (Together).
              </p>
            )
          }
          actions={() =>
            defaultBaseUrl !== undefined && normalizeBaseUrl(defaultBaseUrl) !== committedBase ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => onUseEndpoint?.(defaultBaseUrl)}
              >
                {t("reasoning.custom.useDefault")}
              </Button>
            ) : null
          }
        />
      )}

      <div className="space-y-2 pt-3">
        <div className="flex items-baseline justify-between">
          <h4 className="font-medium text-foreground">
            {t(apiKeyRequired ? "common.apiKey" : "reasoning.custom.apiKeyOptional")}
          </h4>
          {getKeyUrl && <GetApiKeyLink url={getKeyUrl} />}
        </div>
        {/* R2-5: the slot identity ("openrouter" or "custom:<scope>") reaches ApiKeyInput; Task 12 makes its Remove undoable. */}
        <ApiKeyInput
          apiKey={apiKey}
          credentialId={credentialSlotForRef(credentialRef)}
          setApiKey={saveApiKey}
          label=""
          helpText={apiKeyRequired ? "" : t("reasoning.custom.apiKeyHelp")}
        />
        {apiKeyRequired && target && !hasKey && (
          <p className="text-xs text-muted-foreground">{t("reasoning.custom.keyRequiredHint")}</p>
        )}
      </div>

      <div className="space-y-2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium text-foreground">{t("reasoning.availableModels")}</h4>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-xs"
            data-action="list-models"
            title={disclosure}
            disabled={!host || !target || sealed || current?.kind === "loading"}
            onClick={() => void listModels()}
          >
            {current?.kind === "loading" ? (
              t("common.loading")
            ) : host ? (
              <BidiInterpolatedText
                text={t("reasoning.custom.listModels", { host: BIDI_VALUE_TOKEN })}
                value={host}
              />
            ) : (
              t("reasoning.custom.listModelsNeedsEndpoint")
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {host ? (
            <BidiInterpolatedText
              text={
                hasKey
                  ? t("reasoning.custom.listModelsSendsKey", { host: BIDI_VALUE_TOKEN, slot })
                  : t("reasoning.custom.listModelsNoKey", { host: BIDI_VALUE_TOKEN })
              }
              value={host}
            />
          ) : (
            disclosure
          )}
        </p>
        {sealed && (
          <p className="text-xs text-muted-foreground">{t("reasoning.custom.listModelsSealed")}</p>
        )}
        {current?.kind === "error" && (
          <p role="alert" className="text-xs text-destructive">
            {current.message}
          </p>
        )}
        {current?.kind === "done" && models.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("reasoning.custom.noModels")}</p>
        )}
        {!current && model && (
          <p className="text-xs text-muted-foreground">
            <BidiInterpolatedText
              text={t("reasoning.custom.currentModel", { model: BIDI_VALUE_TOKEN })}
              value={model}
            />
          </p>
        )}
        {models.length > MODEL_SEARCH_THRESHOLD ? (
          <SearchableModelList
            models={models}
            selectedModel={model}
            onModelSelect={onSelectModel}
          />
        ) : (
          <ModelCardList
            models={models}
            selectedModel={model}
            onModelSelect={onSelectModel}
            truncateDescription
          />
        )}
      </div>
    </>
  );
}
