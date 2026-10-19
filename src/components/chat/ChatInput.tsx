import { useState, useRef, useCallback, useEffect, useLayoutEffect, useId } from "react";
import { Mic, Square, X } from "../icons";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import { SendIcon } from "../ui/SendIcon";
import { LevelBars } from "../ui/LevelBars";
import { GRADIENT_CIRCLE } from "../ui/gradientCircle";
import { GLASS_SURFACE } from "../ui/glass";
import { notify } from "../ui/notices";
import { formatMmSs } from "../../utils/formatDuration";
import { useVoiceDraft } from "./useVoiceDraft";
import { composerHeight, resolveComposerKey } from "./chatInputKeys";
import type { AgentState } from "./types";

interface ChatInputProps {
  agentState: AgentState;
  partialTranscript: string;
  /** False or rejection means nothing was sent; preserve the words for retry. */
  onTextSubmit?: (text: string) => void | boolean | Promise<void | boolean>;
  /** Destination identity including conversation/context and effective route. */
  queueKey?: string;
  onCancel?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  /** Overrides the default wrapper padding (compact hosts like the assistant panel). */
  className?: string;
  /** Offer a mic when the input is empty; recordings transcribe into the input. */
  voiceDraft?: boolean;
}

function RecordingIndicator() {
  return (
    <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
      <div className="absolute inset-0 rounded-full border-2 border-primary/40 animate-pulse" />
      <div className="w-2.5 h-2.5 rounded-full bg-primary" />
    </div>
  );
}

function ProcessingIndicator() {
  return (
    <div className="flex items-center justify-center w-5 h-5 shrink-0">
      <div className="flex items-center gap-0.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-0.5 bg-accent rounded-full"
            style={{
              height: "8px",
              animation: `waveform-bar 0.6s ease-in-out ${i * 0.1}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function ChatInput({
  agentState,
  partialTranscript,
  onTextSubmit,
  queueKey,
  onCancel,
  autoFocus = false,
  placeholder,
  className,
  voiceDraft = false,
}: ChatInputProps) {
  const { t } = useTranslation();

  const [inputText, setInputText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // A draft may leave the queue only for the destination that admitted it.
  const [queuedFor, setQueuedFor] = useState<string | null>(null);
  const [queueDropped, setQueueDropped] = useState(false);
  const [unsent, setUnsent] = useState<string | null>(null);
  const queued = queuedFor !== null;
  const queuedHintId = useId();
  const inputTextRef = useRef(inputText);
  const writeDraft = useCallback((value: string) => {
    inputTextRef.current = value;
    setInputText(value);
  }, []);
  useLayoutEffect(() => {
    inputTextRef.current = inputText;
  }, [inputText]);

  const voice = useVoiceDraft({
    onTranscript: (text) => {
      setInputText((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    onError: (message) => {
      notify({
        kind: "alert",
        title: t("notes.upload.transcriptionFailed"),
        body: message || undefined,
      });
    },
  });
  const isVoiceRecording = voice.status === "recording";
  const isVoiceTranscribing = voice.status === "transcribing";

  const isIdle = agentState === "idle";
  const isListening = agentState === "listening";
  const isTranscribing = agentState === "transcribing";
  const isBusy =
    agentState === "thinking" || agentState === "streaming" || agentState === "tool-executing";

  const handleSubmit = useCallback(async () => {
    const text = inputTextRef.current.trim();
    if (!text || !onTextSubmit) return;
    setQueuedFor(null);
    setQueueDropped(false);
    writeDraft("");
    requestAnimationFrame(() => inputRef.current?.focus());
    let sent: void | boolean = true;
    try {
      sent = await onTextSubmit(text);
    } catch {
      sent = false;
    }
    if (sent !== false) return;
    if (!inputTextRef.current.trim()) writeDraft(text);
    else setUnsent((held) => (held ? `${held}\n\n${text}` : text));
  }, [onTextSubmit, writeDraft]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const action = resolveComposerKey({
        key: e.key,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
        keyCode: e.nativeEvent.keyCode,
        isBusy,
        isQueued: queued,
        hasText: Boolean(inputText.trim()),
      });
      if (action === "none") return;
      if (action === "queue" && !queueKey) return;
      e.preventDefault();
      if (action === "submit") void handleSubmit();
      else if (action === "queue") {
        setQueuedFor(queueKey ?? null);
        setQueueDropped(false);
      } else setQueuedFor(null);
    },
    [handleSubmit, inputText, isBusy, queued, queueKey]
  );

  // Grow with the text up to the cap, then scroll inside the box.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const { height, overflowY } = composerHeight(el.scrollHeight);
    el.style.height = `${height}px`;
    el.style.overflowY = overflowY;
  }, [inputText, isIdle, isBusy, isVoiceRecording, isVoiceTranscribing]);

  // Destination changes leave the words for a deliberate send in the new location.
  useEffect(() => {
    if (queuedFor !== null && queuedFor !== queueKey) {
      setQueuedFor(null);
      setQueueDropped(true);
    }
  }, [queuedFor, queueKey]);
  useEffect(() => {
    if (isIdle && queuedFor !== null && queuedFor === queueKey) {
      setQueuedFor(null);
      void handleSubmit();
    }
  }, [isIdle, queuedFor, queueKey, handleSubmit]);

  useEffect(() => {
    if (isIdle) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isIdle]);

  return (
    <div className={cn("shrink-0", className ?? "px-3 pb-3 pt-1")}>
      <div
        className={cn(
          "flex items-end gap-2 min-h-11 ps-4 pe-1.5 py-1.5 rounded-[22px]",
          GLASS_SURFACE,
          "border border-black/10 dark:border-white/14",
          "transition-all duration-200",
          (isIdle || isBusy) && "focus-within:ring-2 focus-within:ring-ring"
        )}
      >
        {isListening && (
          <>
            <RecordingIndicator />
            <span className="text-[12px] text-foreground/80 truncate flex-1">
              {/* A live transcript's informative part is its tail — show the
                  latest words once the line fills instead of a frozen start. */}
              {partialTranscript.length > 60
                ? `…${partialTranscript.slice(-60)}`
                : partialTranscript || t("agentMode.input.listening")}
            </span>
          </>
        )}

        {isTranscribing && (
          <>
            <ProcessingIndicator />
            <span className="text-[12px] text-muted-foreground select-none">
              {t("agentMode.input.transcribing")}
            </span>
          </>
        )}

        {isVoiceRecording && (
          <div className="flex items-center gap-2.5 w-full py-1.5 animate-[fade-in-content_var(--motion-base)_var(--motion-ease-enter)_backwards]">
            <LevelBars
              readLevel={voice.readLevel}
              height={16}
              className="flex-1 justify-center overflow-hidden"
            />
            <span className="text-[13px] font-semibold tabular-nums tracking-[0.08em] text-foreground/85 shrink-0">
              {formatMmSs(voice.elapsed)}
            </span>
            <button
              onClick={voice.cancel}
              aria-label={t("common.cancel")}
              title={t("common.cancel")}
              className={cn(
                "flex items-center justify-center w-7 h-7 rounded-full shrink-0",
                "text-muted-foreground/70 hover:text-foreground hover:bg-foreground/8",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "transition-colors duration-100"
              )}
            >
              <X size={14} />
            </button>
            <button
              onClick={voice.stop}
              aria-label={t("notes.editor.stop")}
              title={t("notes.editor.stop")}
              className={cn(
                "flex items-center justify-center w-7 h-7 rounded-full shrink-0",
                "animate-[scale-in_0.15s_ease-out_backwards]",
                GRADIENT_CIRCLE,
                "hover:brightness-110 active:scale-95",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "transition-all duration-100"
              )}
            >
              <Square size={10} fill="currentColor" />
            </button>
          </div>
        )}

        {isVoiceTranscribing && (
          <>
            <ProcessingIndicator />
            <span className="text-[12px] text-muted-foreground select-none">
              {t("agentMode.input.transcribing")}
            </span>
          </>
        )}

        {(isIdle || isBusy) && !isVoiceRecording && !isVoiceTranscribing && (
          <div className="flex items-end gap-2 w-full">
            <textarea
              dir="auto"
              ref={inputRef}
              rows={1}
              value={inputText}
              onChange={(e) => {
                writeDraft(e.target.value);
                setQueueDropped(false);
                if (!e.target.value.trim()) setQueuedFor(null);
              }}
              aria-describedby={queued ? queuedHintId : undefined}
              onKeyDown={handleKeyDown}
              autoFocus={autoFocus}
              placeholder={placeholder ?? t("agentMode.input.typeMessage")}
              className={cn(
                "input-inline flex-1 resize-none outline-none bg-transparent caret-primary",
                "text-[13px] leading-5 text-foreground placeholder:text-muted-foreground/70",
                "min-w-0 py-1.5 px-0"
              )}
            />
            {isBusy && onCancel ? (
              <button
                type="button"
                onClick={() => {
                  setQueuedFor(null);
                  onCancel?.();
                }}
                aria-label={t("common.cancel")}
                title={t("common.cancel")}
                className={cn(
                  "flex items-center justify-center w-7 h-7 rounded-full shrink-0",
                  "text-muted-foreground/70 hover:text-foreground hover:bg-foreground/8",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "transition-colors duration-100"
                )}
              >
                <Square size={12} className="fill-current" />
              </button>
            ) : isIdle && (inputText.trim() || !voiceDraft) ? (
              <button
                onClick={() => void handleSubmit()}
                disabled={!inputText.trim()}
                aria-label={t("agentMode.input.send")}
                className={cn(
                  "rounded-full shrink-0",
                  voiceDraft && "animate-[scale-in_0.15s_ease-out_backwards]",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "transition-all duration-100",
                  inputText.trim()
                    ? "hover:brightness-110 active:scale-95"
                    : "opacity-30 saturate-0 cursor-default"
                )}
              >
                <SendIcon size={28} className="block rtl:scale-x-[-1]" />
              </button>
            ) : isIdle ? (
              <button
                onClick={voice.start}
                disabled={voice.streamingOnlyProvider}
                aria-label={t("notes.editor.transcribe")}
                title={
                  voice.streamingOnlyProvider
                    ? t("agentMode.input.voiceDraftStreamingOnly")
                    : t("notes.editor.transcribe")
                }
                className={cn(
                  "flex items-center justify-center w-7 h-7 rounded-full shrink-0",
                  GRADIENT_CIRCLE,
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "transition-all duration-100",
                  voice.streamingOnlyProvider
                    ? "opacity-30 saturate-0 cursor-default"
                    : "hover:brightness-110 active:scale-95"
                )}
              >
                <Mic size={14} />
              </button>
            ) : null}
          </div>
        )}
      </div>
      {queued && (
        <p
          id={queuedHintId}
          className="mt-1 flex items-center gap-2 ps-4 text-[11px] text-muted-foreground"
        >
          {t("agentMode.input.queued")}
          <button
            type="button"
            onClick={() => setQueuedFor(null)}
            className="rounded-sm underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("agentMode.input.unqueue")}
          </button>
        </p>
      )}
      {queueDropped && (
        <p role="status" className="mt-1 ps-4 text-[11px] text-muted-foreground">
          {t("agentMode.input.queueDropped")}
        </p>
      )}
      {unsent !== null && (
        <div
          role="alert"
          className="mt-1 flex flex-wrap items-center gap-2 ps-4 text-[11px] text-muted-foreground"
        >
          {t("agentMode.input.unsent")}
          <button
            type="button"
            onClick={() => {
              const held = unsent;
              const current = inputTextRef.current;
              writeDraft(current.trim() ? `${held}\n\n${current}` : held);
              setUnsent(null);
            }}
            className="rounded-sm underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("agentMode.input.restoreUnsent")}
          </button>
          <button
            type="button"
            onClick={() => setUnsent(null)}
            className="rounded-sm underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("agentMode.input.discardUnsent")}
          </button>
        </div>
      )}
    </div>
  );
}
