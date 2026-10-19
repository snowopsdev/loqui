import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { Check, ChevronUp } from "../icons";
import { cn } from "../lib/utils";
import { LevelBars } from "../ui/LevelBars";
import { LOGO_BAR_SHAPE } from "../ui/levelBarsMath";
import { LocalityRing } from "../ui/LocalityRing";
import { VoiceIdentityIcon } from "./VoiceIdentityIcon";
import type { PillLocality } from "./pillLocality";
import {
  VOICE_PILL_FOOTPRINT,
  VOICE_PILL_GROW_TRANSITION,
} from "../../helpers/voicePillPresentation";

export type VoicePillState =
  | "idle"
  | "hover"
  | "recording"
  | "processing"
  | "thinking"
  | "unavailable"
  | "transcribing"
  | "cleaning"
  | "pasted"
  | "failed"
  | "cancelled"
  | "meeting"
  | "sealedPaused";

interface VoicePillProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  variant: "floating" | "panel";
  state: VoicePillState;
  getAudioLevel: () => number | null;
  expanded?: boolean;
  collapseToLogo?: boolean;
  waveformVisible?: boolean;
  waveformOnlyWhileRecording?: boolean;
  integratedWithPanel?: boolean;
  /** The cancel button's liquid skin owns the fused surface; go headless. */
  liquidFused?: boolean;
  agentMode?: boolean;
  showExpandChevron?: boolean;
  isDragging?: boolean;
  horizontalDirection?: "left" | "right";
  /** Stage text for labelled states (transcribing, cleaning, pasted, cancelled). */
  label?: ReactNode;
  /** Where dictation goes; drawn as the ring around the identity (D4). */
  locality?: PillLocality | null;
  /** Undo window underline for the cancelled state (D3). */
  countdown?: { durationMs: number; paused: boolean; generation?: number } | null;
}

const COMPACT_CONTENT_GAP_PX = 6;
const IDENTITY_RING_PX = 30;
const LABELLED = new Set<VoicePillState>([
  "transcribing",
  "cleaning",
  "pasted",
  "cancelled",
  "sealedPaused",
]);
const GLOWING = new Set<VoicePillState>(["thinking", "transcribing", "cleaning"]);
const REST_HEIGHTS = LOGO_BAR_SHAPE.map((scale) => Math.round(scale * 20));

// Mirrored by .liquid-cancel-skin[data-pill-state] in dictation-panel.css,
// which redraws this chrome while the cancel skin owns the fused surface —
// change together.
const STATE_APPEARANCE: Record<VoicePillState, string> = {
  idle: "border-border-hover bg-surface-1 text-muted-foreground dark:border-border/50",
  hover: "border-border-hover bg-surface-3 text-foreground",
  recording: "border-border-hover bg-surface-1 text-foreground",
  processing: "border-border/60 bg-surface-1 text-foreground/70",
  thinking: "border-border/60 bg-surface-1 text-foreground",
  unavailable: "border-border/60 bg-surface-1 text-muted-foreground",
  transcribing: "border-border/60 bg-surface-1 text-foreground",
  cleaning: "border-border/60 bg-surface-1 text-foreground",
  pasted: "bg-surface-1 text-foreground",
  failed: "bg-surface-1 text-foreground",
  cancelled: "border-border-hover bg-surface-1 text-foreground",
  meeting: "border-border-hover bg-surface-1 text-foreground",
  sealedPaused: "border-border-hover bg-surface-1 text-foreground",
};

/** One persistent control that morphs between the pill's legible states. */
export const VoicePill = forwardRef<HTMLDivElement, VoicePillProps>(function VoicePill(
  {
    variant,
    state,
    getAudioLevel,
    expanded = false,
    collapseToLogo = false,
    waveformVisible = true,
    waveformOnlyWhileRecording = false,
    integratedWithPanel = false,
    liquidFused = false,
    agentMode = false,
    showExpandChevron = false,
    isDragging = false,
    horizontalDirection = "right",
    label,
    locality = null,
    countdown = null,
    className,
    style,
    ...props
  },
  ref
) {
  const isRecording = state === "recording";
  const isThinking = state === "thinking";
  const isUnavailable = state === "unavailable";
  const hasLabel = LABELLED.has(state) && label != null;
  const showSignalGlow = GLOWING.has(state);
  const isPanel = variant === "panel";
  const collapseToIdentity = collapseToLogo || isThinking || state === "failed";
  const showCompactPill =
    !collapseToIdentity &&
    (isRecording || hasLabel || expanded || (isPanel && !waveformOnlyWhileRecording));
  const showWaveformSlot = showCompactPill && !hasLabel;
  const footprint = hasLabel
    ? VOICE_PILL_FOOTPRINT[
        state as "transcribing" | "cleaning" | "pasted" | "cancelled" | "sealedPaused"
      ]
    : showCompactPill
      ? VOICE_PILL_FOOTPRINT.recording
      : VOICE_PILL_FOOTPRINT.idle;
  const floatingHover = !isPanel && state === "hover";
  // LevelBars holds readLevel in a ref and treats non-finite or sub-floor
  // input as silence (Plan 01 172f9df), so an inline adapter is enough.
  const readLevel = () => getAudioLevel() ?? 0;
  const identitySize = locality ? Math.round(IDENTITY_RING_PX * 0.7) : 22;
  const busy = state === "transcribing" || state === "cleaning" || isRecording;

  const icon =
    state === "pasted" ? (
      <Check
        className="pill-success-check"
        size={identitySize - 4}
        strokeWidth={2.5}
        aria-hidden="true"
      />
    ) : (
      <VoiceIdentityIcon
        size={identitySize}
        agentMode={agentMode}
        className={cn(
          "voice-pill-identity-icon",
          state === "idle" && "text-foreground",
          (isUnavailable || state === "processing") && "animate-pulse"
        )}
      />
    );

  const pill = (
    <div
      ref={ref}
      className={cn(
        "voice-pill-control relative flex items-center justify-center overflow-hidden rounded-full border",
        showCompactPill && "pe-1.5",
        hasLabel && "ps-1 pe-3",
        "voice-pill-shadow",
        STATE_APPEARANCE[state],
        className
      )}
      style={{
        width: footprint.width,
        height: footprint.height,
        cursor:
          state === "processing" || isThinking || state === "transcribing" || state === "cleaning"
            ? "not-allowed"
            : isDragging
              ? "grabbing"
              : "pointer",
        boxShadow:
          floatingHover && !liquidFused
            ? "var(--shadow-card-hover-subtle, 0 2px 8px -2px rgb(0 0 0 / 0.1))"
            : undefined,
        transition: `width ${VOICE_PILL_GROW_TRANSITION}, height ${VOICE_PILL_GROW_TRANSITION}, padding-left ${VOICE_PILL_GROW_TRANSITION}, padding-right ${VOICE_PILL_GROW_TRANSITION}, background-color var(--motion-fast) var(--motion-ease-std), border-color var(--motion-fast) var(--motion-ease-std), box-shadow var(--motion-fast) var(--motion-ease-std)`,
        ...style,
      }}
      data-pill-state={state}
      data-horizontal-direction={horizontalDirection}
      data-integrated-with-panel={integratedWithPanel || undefined}
      data-liquid-fused={liquidFused || undefined}
      data-agent-mode={agentMode || undefined}
      data-agent-beam-active={(agentMode && isThinking) || undefined}
      data-expand-chevron={showExpandChevron || undefined}
      {...props}
    >
      {/* Transitions live in dictation-panel.css on the motion tokens (R2-M1). */}
      <div
        className="voice-pill-sheen pointer-events-none absolute inset-0 bg-gradient-to-br from-foreground/10 to-transparent"
        style={{ opacity: state === "hover" ? 0.72 : 0 }}
      />

      <span
        className="voice-pill-identity-slot relative inline-grid shrink-0 place-items-center"
        style={{
          width: locality ? IDENTITY_RING_PX : 22,
          height: locality ? IDENTITY_RING_PX : 22,
        }}
        aria-hidden={locality ? undefined : "true"}
      >
        <span
          className={cn(
            "voice-pill-identity-logo absolute inset-0 grid place-items-center",
            showExpandChevron ? "translate-y-1 scale-75 opacity-0" : "scale-100 opacity-100"
          )}
        >
          {locality ? (
            <LocalityRing
              locality={locality.locality}
              provider={locality.provider}
              label={locality.label}
              active={busy && locality.locality === "remote"}
              size={IDENTITY_RING_PX}
              className={cn(locality.blocked && "locality-ring--blocked")}
            >
              {icon}
            </LocalityRing>
          ) : (
            icon
          )}
        </span>
        <ChevronUp
          className={cn(
            "voice-pill-expand-chevron absolute inset-0 m-auto size-5",
            showExpandChevron ? "scale-100 opacity-100" : "translate-y-1 scale-75 opacity-0"
          )}
          strokeWidth={2}
        />
      </span>

      {hasLabel ? (
        <span className="pill-stage-label ms-1.5">{label}</span>
      ) : (
        <div
          className="voice-pill-waveform relative grid shrink-0 place-items-center overflow-hidden"
          style={{
            width: showWaveformSlot ? 44 : 0,
            height: showWaveformSlot ? 24 : 32,
            marginInlineStart: showWaveformSlot ? COMPACT_CONTENT_GAP_PX : 0,
            transition: `width ${VOICE_PILL_GROW_TRANSITION}, height ${VOICE_PILL_GROW_TRANSITION}`,
          }}
        >
          {isRecording ? (
            // Mounted only while listening, so its sampling interval runs only
            // in the active state (loops are gated, DESIGN.md "Motion").
            <LevelBars
              readLevel={readLevel}
              height={20}
              className={cn(
                "voice-pill-levels",
                showCompactPill && waveformVisible ? "opacity-100" : "opacity-0"
              )}
            />
          ) : showWaveformSlot && waveformVisible ? (
            <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
              {REST_HEIGHTS.map((h, i) => (
                <span
                  key={i}
                  data-level-bar-rest=""
                  className="block w-1 rounded-full bg-current opacity-60"
                  style={{ height: h }}
                />
              ))}
            </span>
          ) : null}
        </div>
      )}

      {countdown ? (
        <span
          key={countdown.generation}
          className="pill-countdown"
          style={
            {
              animationDuration: `${countdown.durationMs}ms`,
              "--undo-ms": `${countdown.durationMs}ms`,
            } as CSSProperties
          }
          data-paused={countdown.paused ? "true" : undefined}
          aria-hidden="true"
        />
      ) : null}

      {isUnavailable && (
        <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-foreground/30 animate-pulse" />
      )}
    </div>
  );

  return (
    <span className="voice-pill-glow-anchor">
      <span
        aria-hidden="true"
        className="processing-signal-glow"
        data-active={showSignalGlow ? "true" : undefined}
        data-stage={state === "transcribing" || state === "cleaning" ? state : undefined}
        data-agent={agentMode || undefined}
      >
        <span className="processing-signal-ring" />
      </span>
      {pill}
    </span>
  );
});
