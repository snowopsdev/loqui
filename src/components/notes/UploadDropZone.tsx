import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import "./UploadDropZone.css";

export interface UploadDropZoneProps {
  disabled: boolean;
  isDragOver: boolean;
  onDrop(e: React.DragEvent): void;
  onDragOver(e: React.DragEvent): void;
  onDragLeave(e: React.DragEvent): void;
  onBrowse(): void;
  onKeyDown(e: React.KeyboardEvent): void;
  onChooseModel(): void;
  children: React.ReactNode;
  unavailableContent?: React.ReactNode;
}

// Keep the upload's purpose visible while its route is being confirmed or fixed.
export function UploadDropZone({
  disabled,
  isDragOver,
  onDrop,
  onDragOver,
  onDragLeave,
  onBrowse,
  onKeyDown,
  onChooseModel,
  children,
  unavailableContent,
}: UploadDropZoneProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label={t("notes.upload.dropOrBrowse")}
        onDrop={disabled ? (e) => e.preventDefault() : onDrop}
        onDragOver={disabled ? (e) => e.preventDefault() : onDragOver}
        onDragLeave={disabled ? undefined : onDragLeave}
        onClick={disabled ? undefined : onBrowse}
        onKeyDown={
          disabled
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") e.preventDefault();
              }
            : onKeyDown
        }
        className={cn(
          "upload-drop-zone relative w-full rounded-lg p-8 text-center border border-foreground/10 bg-surface-1/40 dark:bg-white/[0.03]",
          "transition-[background-color,border-color,transform] duration-(--motion-base) ease-(--motion-ease-std)",
          disabled
            ? "cursor-not-allowed"
            : "cursor-pointer hover:bg-surface-1/60 hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !disabled &&
            isDragOver &&
            "upload-drop-zone-active border-foreground/30 bg-foreground/[0.04]"
        )}
      >
        {children}
      </div>
      {disabled &&
        (unavailableContent !== undefined ? (
          unavailableContent
        ) : (
          <p className="text-xs text-muted-foreground text-center">
            {t("notes.upload.needsModel")}{" "}
            <button
              type="button"
              onClick={onChooseModel}
              className="rounded-sm text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("notes.upload.chooseModel")}
            </button>
          </p>
        ))}
    </div>
  );
}
