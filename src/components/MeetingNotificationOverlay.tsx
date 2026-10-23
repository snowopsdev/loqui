import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import type { MeetingNotificationData } from "../types/electron";
import { MeetingNotificationCard } from "./MeetingNotificationCard";
import {
  MEETING_PROMPT_MINI_AFTER_MS,
  getMeetingNotificationPresentation,
  initializeMeetingNotificationOverlay,
  shouldDismissMeetingNotificationSwipe,
} from "./meetingNotificationModel";

interface PointerSwipe {
  pointerId: number;
  startY: number;
}

// Distance over which a dragged card fades to its minimum opacity.
const SWIPE_FADE_DISTANCE_PX = 240;
const SWIPE_MIN_OPACITY = 0.4;

export default function MeetingNotificationOverlay(): ReactElement {
  const { t } = useTranslation();
  const [data, setData] = useState<MeetingNotificationData | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  // Live vertical pointer offset while swiping; null at rest.
  const [dragY, setDragY] = useState<number | null>(null);
  const [phase, setPhase] = useState<"card" | "mini" | "accepted">("card");
  const responding = useRef(false);
  const pendingDismiss = useRef<(() => void) | null>(null);
  const pointerSwipeRef = useRef<PointerSwipe | null>(null);

  useEffect(() => {
    return initializeMeetingNotificationOverlay({
      subscribe: (callback) => window.electronAPI?.onMeetingNotificationData?.(callback),
      getPendingData: () =>
        window.electronAPI?.getMeetingNotificationData?.() ?? Promise.resolve(null),
      onData: setData,
      onVisible: () => setIsVisible(true),
      onReady: () => {
        void window.electronAPI?.meetingNotificationReady?.();
      },
    });
  }, []);

  const presentation = getMeetingNotificationPresentation(data);

  const respond = useCallback(
    async (action: string): Promise<void> => {
      if (!data || responding.current) return;
      responding.current = true;
      if (action !== "dismiss") setPhase("accepted");
      // Main retires the prompt immediately; CSS owns the visual exit cadence.
      const send = () => window.electronAPI?.meetingNotificationRespond?.(data.detectionId, action);
      if (action === "dismiss") pendingDismiss.current = send;
      else send();
      setIsVisible(false);
    },
    [data]
  );

  useEffect(() => {
    if (!isVisible || isHovered || phase !== "card") return;
    const timer = setTimeout(() => setPhase("mini"), MEETING_PROMPT_MINI_AFTER_MS);
    return () => clearTimeout(timer);
  }, [isVisible, isHovered, phase]);

  const dismiss = useCallback((): void => {
    void respond("dismiss");
  }, [respond]);

  const handleMouseEnter = useCallback((): void => {
    setIsHovered(true);
    window.electronAPI?.setNotificationInteractivity?.(true);
  }, []);

  const handleMouseLeave = useCallback((): void => {
    setIsHovered(false);
    // A captured pointer keeps dragging outside the card, so the window has to
    // stay interactive until the swipe finishes.
    if (pointerSwipeRef.current) return;
    window.electronAPI?.setNotificationInteractivity?.(false);
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (
        !presentation.dismissible ||
        !isVisible ||
        !event.isPrimary ||
        event.button !== 0 ||
        (event.target instanceof Element &&
          event.target.closest("button, .meeting-card__copy, .meeting-card__privacy"))
      ) {
        return;
      }

      pointerSwipeRef.current = { pointerId: event.pointerId, startY: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [isVisible, presentation.dismissible]
  );

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const swipe = pointerSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    setDragY(event.clientY - swipe.startY);
  }, []);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const swipe = pointerSwipeRef.current;
      if (!swipe || swipe.pointerId !== event.pointerId) return;

      pointerSwipeRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const distance = event.clientY - swipe.startY;
      // Releasing dragY re-enables the transition, so the card either springs
      // back to rest or continues upwards off-screen.
      setDragY(null);

      // The card may have been replaced mid-drag, so the dismissibility of the
      // card being released is what decides, not the one the swipe started on.
      if (shouldDismissMeetingNotificationSwipe(presentation.dismissible, distance)) {
        dismiss();
      } else if (!isHovered) {
        window.electronAPI?.setNotificationInteractivity?.(false);
      }
    },
    [dismiss, isHovered, presentation.dismissible]
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (pointerSwipeRef.current?.pointerId !== event.pointerId) return;
      pointerSwipeRef.current = null;
      setDragY(null);
      if (!isHovered) window.electronAPI?.setNotificationInteractivity?.(false);
    },
    [isHovered]
  );

  const title = presentation.title ?? t(presentation.titleKey);
  const body = t(presentation.bodyKey, presentation.bodyParams);

  const isDragging = dragY !== null;
  const motionStyle: CSSProperties = isDragging
    ? {
        transform: `translateY(${Math.min(0, dragY ?? 0)}px)`,
        opacity: Math.max(
          SWIPE_MIN_OPACITY,
          1 - (Math.abs(dragY) / SWIPE_FADE_DISTANCE_PX) * (1 - SWIPE_MIN_OPACITY)
        ),
      }
    : isVisible
      ? { opacity: 1 }
      : { transform: "translateY(-8px)", opacity: 0 };

  return (
    <div
      className="meeting-notification-window w-full h-full bg-transparent select-none"
      style={{ touchAction: presentation.dismissible ? "pan-x" : "auto" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div
        className={[
          "meeting-notification-motion",
          isDragging ? "meeting-notification-motion--dragging" : "",
        ].join(" ")}
        style={motionStyle}
        onTransitionEnd={(event) => {
          if (event.target !== event.currentTarget || event.propertyName !== "opacity") return;
          const send = pendingDismiss.current;
          pendingDismiss.current = null;
          send?.();
        }}
      >
        <MeetingNotificationCard
          title={title}
          body={body}
          startLabel={t(presentation.actionKey)}
          onStart={() => respond(presentation.action)}
          onDismiss={presentation.dismissible ? dismiss : undefined}
          phase={phase}
          privacyLine={presentation.privacyKey ? t(presentation.privacyKey) : undefined}
          hotkeyLabel={data?.acceptHotkeyLabel ?? null}
          miniLabel={t("meetingNotification.mini")}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />
      </div>
    </div>
  );
}
