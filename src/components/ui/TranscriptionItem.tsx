import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { Tooltip } from "./tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import {
  Copy,
  Trash2,
  FileText,
  FolderOpen,
  RotateCcw,
  Loader2,
  AlertCircle,
  ArchiveRestore,
  MoreVertical,
} from "../icons";
import type {
  TranscriptionItem as TranscriptionItemType,
  TranscriptionErrorCode,
} from "../../types/electron";
import { cn } from "../lib/utils";
import { getCachedPlatform } from "../../utils/platform";
import { formatElapsed } from "../../lib/captureStatus";
import { parseDbTimestamp, transcriptionLocality } from "../../lib/homeFeed";
import { providerDisplayLabel } from "../../lib/locality";
import { LocalityRing } from "./LocalityRing";
import { formatMmSs } from "../../utils/formatDuration";

const platform = getCachedPlatform();

const ACTION_BUTTON_CLASS =
  "h-7 w-7 rounded-full text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground hover:bg-foreground/8 dark:hover:bg-foreground/8 data-[state=open]:bg-foreground/8 dark:data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground dark:data-[state=open]:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

function getShowInFolderKey(): string {
  if (platform === "win32") return "controlPanel.history.showInFolderWindows";
  if (platform === "linux") return "controlPanel.history.showInFolderLinux";
  return "controlPanel.history.showInFolder";
}

interface MenuAction {
  key: string;
  icon: typeof Copy;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

interface TranscriptionItemProps {
  item: TranscriptionItemType;
  onCopy: (text: string) => void;
  onDelete: (id: number) => void;
  onShowAudioInFolder?: (id: number) => void;
  onRetryTranscription?: (id: number, options?: { isRecover?: boolean }) => Promise<void>;
  onOpenSettings?: () => void;
  words?: number;
  focused?: boolean;
  nested?: boolean;
}

export default function TranscriptionItem({
  item,
  onCopy,
  onDelete,
  onShowAudioInFolder,
  onRetryTranscription,
  onOpenSettings,
  words,
  focused,
  nested,
}: TranscriptionItemProps) {
  const { t, i18n } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const timestampDate = new Date(parseDbTimestamp(item.timestamp));
  const formattedTime = Number.isNaN(timestampDate.getTime())
    ? ""
    : timestampDate.toLocaleTimeString(i18n.language, {
        hour: "numeric",
        minute: "2-digit",
      });

  const locality = transcriptionLocality(item.provider);
  const providerLabel =
    locality?.locality === "remote" ? providerDisplayLabel(locality.providerId, t) : null;
  // Mouse convenience; the visible Copy button is the keyboard/AT path.
  // Selecting text never copies the whole row.
  const copyUnlessSelecting = () => {
    if (window.getSelection()?.toString()) return;
    onCopy(item.text);
  };

  const handleRetry = async () => {
    if (isRetrying || !onRetryTranscription) return;
    setIsRetrying(true);
    try {
      await onRetryTranscription(item.id, { isRecover: item.status === "discarded" });
    } finally {
      setIsRetrying(false);
    }
  };

  const isFailed = item.status === "failed";
  const isDiscarded = item.status === "discarded";
  const isTranscribed = !isFailed && !isDiscarded;
  const discardedDuration =
    item.audio_duration_ms && item.audio_duration_ms > 0
      ? formatMmSs(Math.round(item.audio_duration_ms / 1000))
      : null;
  const rawText = item.raw_text;
  const hasAudio = item.has_audio === 1;

  const errorCode = item.error_code as TranscriptionErrorCode;
  const isConfigError =
    errorCode === "API_KEY_MISSING" ||
    errorCode === "INVALID_KEY" ||
    errorCode === "MODEL_NOT_AVAILABLE" ||
    errorCode === "CUSTOM_ENDPOINT_INVALID";
  const isLimitError = errorCode === "LIMIT_REACHED";
  const isOfflineError = errorCode === "OFFLINE";

  const retryLabel = t(
    item.route_kind === "translation"
      ? "controlPanel.history.retryTranslationMode"
      : "controlPanel.history.retryTranscription"
  );

  // Copy stays visible as the one-tap action; everything else lives in the menu.
  const candidateActions: (MenuAction | false)[] = [
    isDiscarded &&
      hasAudio && {
        key: "recover",
        icon: ArchiveRestore,
        label: t("controlPanel.history.discarded.recover"),
        onSelect: handleRetry,
      },
    !isDiscarded &&
      hasAudio && { key: "retry", icon: RotateCcw, label: retryLabel, onSelect: handleRetry },
    isTranscribed &&
      rawText !== null && {
        key: "raw",
        icon: FileText,
        label: t("controlPanel.history.viewRawTranscript"),
        onSelect: () => setIsExpanded((expanded) => !expanded),
      },
    hasAudio && {
      key: "folder",
      icon: FolderOpen,
      label: t(getShowInFolderKey()),
      onSelect: () => onShowAudioInFolder?.(item.id),
    },
    {
      key: "delete",
      icon: Trash2,
      label: t("controlPanel.history.deleteItem"),
      onSelect: () => onDelete(item.id),
      destructive: true,
    },
  ];
  const menuActions = candidateActions.filter((action): action is MenuAction => action !== false);

  return (
    <div
      data-transcript-id={item.id}
      data-focused={focused ? "true" : undefined}
      className={cn(
        "group/row grid grid-cols-[64px_1fr_auto] items-start gap-x-3 px-4 py-3 transition-colors duration-(--motion-fast) ease-(--motion-ease-std)",
        isFailed
          ? "bg-destructive/5"
          : isDiscarded
            ? "bg-muted/20"
            : "hover:bg-muted/20 dark:hover:bg-white/2",
        nested && "ps-6",
        // Translation rows get a 2px primary accent; ps-[14px] keeps text aligned with the other rows.
        item.route_kind === "translation" && "border-s-2 border-s-primary/70 ps-[14px]"
      )}
    >
      <div className="contents">
        <span className="pt-1 text-caption tabular-nums text-muted-foreground">
          {formattedTime}
        </span>
        <div className="col-start-3 row-start-1 flex flex-col items-end gap-1">
          <div
            data-row-actions="true"
            className="-me-1.5 flex items-center gap-1 text-muted-foreground"
          >
            {isTranscribed && (
              <Tooltip content={t("controlPanel.history.copyText")}>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("controlPanel.history.copyText")}
                  onClick={() => onCopy(item.text)}
                  className={ACTION_BUTTON_CLASS}
                >
                  <Copy size={13} />
                </Button>
              </Tooltip>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={isRetrying}
                  aria-label={t("controlPanel.history.moreActions")}
                  className={ACTION_BUTTON_CLASS}
                >
                  {isRetrying ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <MoreVertical size={13} />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {menuActions.map(({ key, icon: Icon, label, onSelect, destructive }) => (
                  <DropdownMenuItem
                    key={key}
                    onSelect={onSelect}
                    className={cn(
                      "gap-2.5 focus-visible:ring-2 focus-visible:ring-ring",
                      destructive && "text-destructive focus:bg-background focus:text-destructive"
                    )}
                  >
                    <Icon size={14} className="shrink-0" />
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <span className="flex flex-wrap justify-end items-center gap-1.5 text-caption tabular-nums text-muted-foreground">
            {item.audio_duration_ms != null && <span>{formatElapsed(item.audio_duration_ms)}</span>}
            {words != null && <span>· {t("home.history.words", { count: words })}</span>}
            {locality && (
              <span className="inline-flex shrink-0 ps-2 pe-2 pb-1" data-history-locality>
                <LocalityRing
                  size={20}
                  locality={locality.locality}
                  provider={providerLabel}
                  label={t(`locality.${locality.locality}`, { provider: providerLabel ?? "" })}
                />
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="col-start-2 row-start-1 min-w-0">
        {isFailed ? (
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t("controlPanel.history.transcriptionFailed")}
              </p>
              {item.error_message && (
                <p className="mt-0.5 text-xs leading-relaxed wrap-break-word text-muted-foreground">
                  {item.error_message}
                </p>
              )}
              {isConfigError && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {hasAudio ? (
                    <>
                      <button
                        onClick={() => onOpenSettings?.()}
                        className="cursor-pointer text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {t("controlPanel.history.failedCtaSettings")}
                      </button>{" "}
                      {t("controlPanel.history.failedCtaAndRetry")}
                    </>
                  ) : (
                    <button
                      onClick={() => onOpenSettings?.()}
                      className="cursor-pointer text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t("controlPanel.history.failedCtaSettingsOnly")}
                    </button>
                  )}
                </p>
              )}
              {isLimitError && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("controlPanel.history.failedLimitReached")}
                </p>
              )}
              {isOfflineError && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("controlPanel.history.failedOffline")}
                </p>
              )}
            </div>
          </div>
        ) : isDiscarded ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-muted-foreground">
              {t("controlPanel.history.discarded.badge")}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {discardedDuration
                ? t("controlPanel.history.discarded.recordingWithDuration", {
                    duration: discardedDuration,
                  })
                : t("controlPanel.history.discarded.recording")}
            </span>
          </div>
        ) : (
          <p
            dir="auto"
            className="text-body line-clamp-4 wrap-break-word whitespace-pre-wrap text-foreground"
            onClick={copyUnlessSelecting}
          >
            {item.text}
          </p>
        )}
      </div>

      {isTranscribed && rawText !== null && (
        <div
          inert={!isExpanded}
          className={cn(
            "col-start-2 col-span-2 grid transition-[grid-template-rows] duration-(--motion-base) ease-(--motion-ease-std) motion-reduce:transition-none",
            isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="mt-2 border-t border-border/70 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-caption font-medium uppercase tracking-wider text-muted-foreground">
                  {t("controlPanel.history.rawTranscript")}
                </span>
                <Tooltip content={t("controlPanel.history.copyRawTranscript")}>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("controlPanel.history.copyRawTranscript")}
                    onClick={() => onCopy(rawText)}
                    className={cn(ACTION_BUTTON_CLASS, "h-5 w-5 rounded-sm")}
                  >
                    <Copy size={10} />
                  </Button>
                </Tooltip>
              </div>
              <p dir="auto" className="mt-1 text-caption leading-relaxed text-muted-foreground">
                {rawText}
              </p>
              {rawText === item.text && (
                <p className="mt-1 text-caption italic text-muted-foreground">
                  {t("controlPanel.history.noAiProcessing")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
