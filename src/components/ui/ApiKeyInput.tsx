import type { CredentialSlot } from "../../lib/credentialSlots";
import type { SecretSaveResult } from "../../stores/settingsStore";
export type { SecretSaveResult };
// This stateless re-export is the shared save contract for optional credential fields.
// eslint-disable-next-line react-refresh/only-export-components
export { unavailableSecretSave } from "../../lib/credentialSlots";
export type AcknowledgedSecretSave = (value: string) => Promise<SecretSaveResult>;
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import logger from "../../utils/logger";
import { Check, KeyRound, X } from "../icons";
import { Input } from "./input";

interface ApiKeyInputProps {
  apiKey: string;
  setApiKey: AcknowledgedSecretSave;
  credentialId?: CredentialSlot;
  className?: string;
  placeholder?: string;
  label?: string;
  ariaLabel?: string;
  helpText?: React.ReactNode;
  variant?: "default" | "purple";
  masked?: boolean;
}

export default function ApiKeyInput({
  apiKey,
  setApiKey,
  className = "",
  placeholder,
  label,
  ariaLabel,
  helpText,
  variant = "default",
  masked = true,
}: ApiKeyInputProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("apiKeyInput.placeholder");
  const resolvedLabel = label ?? t("apiKeyInput.label");
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftTouched, setDraftTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<"save" | "remove" | null>(null);
  const savingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasKey = apiKey.length > 0;
  const variantClasses = variant === "purple" ? "border-primary focus:border-primary" : "";

  useEffect(() => {
    if (isEditing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing]);

  const enterEdit = () => {
    setDraft("");
    setDraftTouched(false);
    setFailure(null);
    setIsEditing(true);
  };

  const commit = useCallback(
    async (value: string): Promise<boolean> => {
      try {
        const result = await setApiKey(value);
        return result?.ok === true;
      } catch (err) {
        logger.warn("Failed to save API key", { error: (err as Error).message }, "settings");
        return false;
      }
    },
    [setApiKey]
  );

  // The editor stays open until main acknowledges the key; a refused save
  // keeps the draft so nothing the user pasted is lost.
  const save = useCallback(async () => {
    if (savingRef.current) return;
    if (!draftTouched) {
      setIsEditing(false);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFailure(null);
    const ok = await commit(draft.trim());
    savingRef.current = false;
    setSaving(false);
    if (!ok) {
      setFailure("save");
      return;
    }
    setDraft("");
    setDraftTouched(false);
    setIsEditing(false);
  }, [draft, draftTouched, commit]);

  // Today's Remove (an empty save), unchanged in this task. Task 12 replaces
  // it with main's undoable token removal and deletes this path (R2-5).
  const remove = async () => {
    setFailure(null);
    if (!(await commit(""))) setFailure("remove");
  };

  const cancel = () => {
    if (savingRef.current) return;
    setDraft("");
    setFailure(null);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  // Commit the draft instead of discarding it — users paste a key and click
  // the next field expecting it to stick (Escape or ✕ still cancels).
  useEffect(() => {
    if (!isEditing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      void save();
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isEditing, save]);

  return (
    <div className={className}>
      {resolvedLabel && (
        <label className="block text-xs font-medium text-foreground mb-1">{resolvedLabel}</label>
      )}

      <div ref={containerRef} className="relative">
        {isEditing ? (
          <div dir="ltr" className="relative">
            <Input
              dir="ltr"
              ref={inputRef}
              type={masked ? "password" : "text"}
              placeholder={resolvedPlaceholder}
              value={draft}
              disabled={saving}
              onChange={(e) => {
                setDraft(e.target.value);
                setDraftTouched(true);
              }}
              onKeyDown={handleKeyDown}
              aria-label={ariaLabel || resolvedLabel || t("apiKeyInput.label")}
              className={`h-8 text-sm font-mono pr-16 ${variantClasses}`}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="h-6 w-6 flex items-center justify-center rounded text-success hover:bg-success/10 active:scale-95 transition-all"
                aria-label={t("apiKeyInput.save")}
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={saving}
                className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted/50 active:scale-95 transition-all"
                aria-label={t("apiKeyInput.cancelEdit")}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={enterEdit}
            className={`w-full h-8 flex items-center px-3 rounded border text-sm transition-all cursor-pointer group ${
              hasKey
                ? "border-border/70 bg-input hover:border-border-hover dark:bg-surface-1 dark:border-border-subtle/60 dark:hover:border-border-hover"
                : "border-dashed border-border/70 bg-transparent hover:border-border/70 hover:bg-muted/30"
            }`}
            aria-label={hasKey ? t("apiKeyInput.edit") : t("apiKeyInput.add")}
          >
            {hasKey ? (
              <span
                dir="ltr"
                className="flex items-center gap-1.5 text-foreground/70 font-mono text-xs tracking-wide"
              >
                <KeyRound className="w-3 h-3 text-muted-foreground/70 shrink-0" />
                {t("personal.keyConfigured")}
              </span>
            ) : (
              <span className="text-muted-foreground/70 text-xs">{resolvedPlaceholder}</span>
            )}
            <span className="ms-auto text-muted-foreground/70 text-xs group-hover:text-muted-foreground/70 transition-colors">
              {hasKey ? t("apiKeyInput.editButton") : t("apiKeyInput.addButton")}
            </span>
          </button>
        )}
      </div>

      {hasKey && !isEditing && (
        <button
          type="button"
          className="mt-1 text-xs text-muted-foreground hover:text-destructive"
          onClick={remove}
        >
          {t("personal.removeKey")}
        </button>
      )}
      {failure && (
        <p role="alert" className="mt-1 text-xs font-medium text-foreground">
          {t(failure === "save" ? "apiKeyInput.saveFailed" : "apiKeyInput.removeFailed")}
        </p>
      )}
      {helpText && <p className="text-xs text-muted-foreground/70 mt-1">{helpText}</p>}
    </div>
  );
}
