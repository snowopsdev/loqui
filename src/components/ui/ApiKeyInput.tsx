import { MULTI_FIELD_CREDENTIALS, type CredentialSlot } from "../../lib/credentialSlots";
import type { SecretSaveResult } from "../../stores/settingsStore";
export type { SecretSaveResult };
// This stateless re-export is the shared save contract for optional credential fields.
// eslint-disable-next-line react-refresh/only-export-components
export { unavailableSecretSave } from "../../lib/credentialSlots";
export type AcknowledgedSecretSave = (value: string) => Promise<SecretSaveResult>;
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { UNDO_FAILURE_KEY, useUndoableRemoval } from "./useUndoableRemoval";
import { Check, KeyRound, X } from "../icons";
import { Input } from "./input";

interface ApiKeyInputProps {
  apiKey: string;
  setApiKey: AcknowledgedSecretSave;
  /** Main's whole credential slot. Remove is unavailable without this and main's undo API. */
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
  credentialId,
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
  const removal = useUndoableRemoval(credentialId);
  const clearRemoval = removal.clear;
  const notice = removal.notice;
  const mounted = useRef(true);
  const revision = useRef(0);
  const owner = useRef({ id: credentialId });
  if (owner.current.id !== credentialId) owner.current = { id: credentialId };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    // Compatible panels can be reused for another task/slot. Its editor is a
    // different lifetime; an old pending ACK cannot own this draft or busy flag.
    revision.current++;
    savingRef.current = false;
    setSaving(false);
    setDraft("");
    setDraftTouched(false);
    setFailure(null);
    setIsEditing(false);
  }, [credentialId]);
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
    if (removal.busy) return;
    revision.current++;
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
      } catch {
        return false;
      }
    },
    [setApiKey]
  );

  // The editor stays open until main acknowledges the key; a refused save
  // keeps the draft so nothing the user pasted is lost.
  const save = useCallback(async () => {
    if (savingRef.current || owner.current.id !== credentialId) return;
    if (!draftTouched) {
      setIsEditing(false);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFailure(null);
    const ownRevision = revision.current;
    const ownOwner = owner.current;
    const ok = await commit(draft.trim());
    if (!mounted.current || owner.current !== ownOwner) return;
    savingRef.current = false;
    setSaving(false);
    if (!ok) {
      setFailure("save");
      return;
    }
    if (revision.current !== ownRevision) return;
    setDraft("");
    setDraftTouched(false);
    setIsEditing(false);
    clearRemoval();
  }, [draft, draftTouched, commit, credentialId, clearRemoval]);

  // Whole-slot removal only: an empty save has no Undo capability.
  const remove = async () => {
    if (savingRef.current || isEditing) return;
    setFailure(null);
    await removal.remove();
  };

  const cancel = () => {
    if (savingRef.current) return;
    revision.current++;
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
                revision.current++;
                setDraft(e.target.value);
                setDraftTouched(true);
              }}
              onKeyDown={handleKeyDown}
              aria-label={ariaLabel || resolvedLabel || t("apiKeyInput.label")}
              className={`h-8 text-sm font-mono pe-16 ${variantClasses}`}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="absolute end-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
              <button
                type="button"
                data-action="save-key"
                onClick={save}
                disabled={saving}
                className="h-6 w-6 flex items-center justify-center rounded text-foreground hover:bg-muted active:scale-95 transition-all duration-[var(--motion-fast)]"
                aria-label={t("apiKeyInput.save")}
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={saving}
                className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-muted-foreground hover:bg-muted/50 active:scale-95 transition-all duration-[var(--motion-fast)]"
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
            disabled={removal.busy}
            className={`w-full h-8 flex items-center px-3 rounded border text-sm transition-all duration-[var(--motion-fast)] focus-visible:outline-2 focus-visible:outline-ring cursor-pointer group ${
              hasKey
                ? "border-input-border bg-input hover:border-input-border dark:bg-surface-1 dark:border-input-border dark:hover:border-input-border"
                : "border-dashed border-input-border bg-transparent hover:border-input-border hover:bg-muted/30"
            }`}
            aria-label={hasKey ? t("apiKeyInput.edit") : t("apiKeyInput.add")}
          >
            {hasKey ? (
              <span
                dir="ltr"
                className="flex items-center gap-1.5 text-foreground font-mono text-xs tracking-wide"
              >
                <KeyRound className="w-3 h-3 text-muted-foreground shrink-0" />
                {t("personal.keyConfigured")}
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">{resolvedPlaceholder}</span>
            )}
            <span className="ms-auto text-muted-foreground text-xs group-hover:text-muted-foreground transition-colors duration-[var(--motion-fast)]">
              {hasKey ? t("apiKeyInput.editButton") : t("apiKeyInput.addButton")}
            </span>
          </button>
        )}
      </div>

      {hasKey && !isEditing && removal.available && notice?.kind !== "removed" && (
        <button
          type="button"
          data-action="remove-key"
          disabled={removal.busy}
          className="mt-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={remove}
        >
          {t(
            credentialId && MULTI_FIELD_CREDENTIALS.has(credentialId)
              ? "apiKeyInput.removeCredential"
              : "personal.removeKey"
          )}
        </button>
      )}
      <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {notice?.kind === "removed" && (
          <p className="mt-1 flex items-center gap-1.5">
            <span>
              {t(
                notice.restoreFailed
                  ? "apiKeyInput.undoRetry"
                  : credentialId && MULTI_FIELD_CREDENTIALS.has(credentialId)
                    ? "apiKeyInput.removedCredential"
                    : "apiKeyInput.removed"
              )}
            </span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              data-action="undo-remove"
              disabled={removal.busy}
              aria-label={t("apiKeyInput.undoLabel")}
              className="font-medium text-foreground underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => void removal.undo()}
            >
              {t("apiKeyInput.undo")}
            </button>
          </p>
        )}
        {notice?.kind === "undoFailed" && (
          <p className="mt-1">{t(UNDO_FAILURE_KEY[notice.reason])}</p>
        )}
      </div>
      {(failure || notice?.kind === "error") && (
        <p role="alert" className="mt-1 text-xs font-medium text-foreground">
          {t(failure === "save" ? "apiKeyInput.saveFailed" : "apiKeyInput.removeFailed")}
        </p>
      )}
      {helpText && <p className="text-xs text-muted-foreground mt-1">{helpText}</p>}
    </div>
  );
}
