import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isSecureHttpEndpoint } from "../../../utils/urlUtils";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";

export type EndpointHint = "empty" | "invalid" | "insecure" | "http" | "ok";
export interface EndpointDraftValue {
  url: string;
  model: string;
}

// eslint-disable-next-line react-refresh/only-export-components -- public pure URL hint helper is part of the shared EndpointDraft API
export function endpointHint(url: string): EndpointHint {
  const value = url.trim();
  if (!value) return "empty";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "invalid";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "invalid";
  if (!isSecureHttpEndpoint(value)) return "insecure";
  return parsed.protocol === "http:" ? "http" : "ok";
}

interface EndpointDraftProps {
  label: string;
  url: string;
  urlPlaceholder: string;
  model?: string;
  modelLabel?: string;
  modelPlaceholder?: string;
  useLabel: string;
  onUse: (value: EndpointDraftValue) => void;
  help?: ReactNode;
  actions?: (draft: EndpointDraftValue) => ReactNode;
}

// An address being typed is only a draft. Nothing is written, discovered or
// sent on change or blur; "Use …" hands the pair to the route planner.
export function EndpointDraft({
  label,
  url,
  urlPlaceholder,
  model,
  modelLabel,
  modelPlaceholder,
  useLabel,
  onUse,
  help,
  actions,
}: EndpointDraftProps) {
  const { t } = useTranslation();
  const urlId = useId();
  const modelId = useId();
  const hintId = useId();
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftModel, setDraftModel] = useState(model ?? "");

  // A committed change (Apply, Undo, another editor) replaces the draft.
  useEffect(() => {
    setDraftUrl(url);
  }, [url]);
  useEffect(() => {
    setDraftModel(model ?? "");
  }, [model]);

  const hint = endpointHint(draftUrl);
  const draft: EndpointDraftValue = { url: draftUrl.trim(), model: draftModel.trim() };
  const dirty = draft.url !== url.trim() || (model !== undefined && draft.model !== model.trim());
  const usable = hint === "http" || hint === "ok";

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <label htmlFor={urlId} className="block text-xs font-medium text-foreground">
          {label}
        </label>
        <Input
          id={urlId}
          dir="ltr"
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.target.value)}
          placeholder={urlPlaceholder}
          aria-describedby={hintId}
          className="h-8 text-sm"
        />
        <p
          id={hintId}
          className={`text-xs ${hint === "invalid" || hint === "insecure" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {t(`staging.url.${hint}`)}
        </p>
        {help}
      </div>
      {model !== undefined && (
        <div className="space-y-1.5">
          <label htmlFor={modelId} className="block text-xs font-medium text-foreground">
            {modelLabel}
          </label>
          <Input
            id={modelId}
            dir="ltr"
            value={draftModel}
            onChange={(event) => setDraftModel(event.target.value)}
            placeholder={modelPlaceholder}
            className="h-8 text-sm"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-action="use-endpoint"
          disabled={!dirty || !usable}
          onClick={() => onUse(draft)}
        >
          {useLabel}
        </Button>
        {actions?.(draft)}
      </div>
    </div>
  );
}
