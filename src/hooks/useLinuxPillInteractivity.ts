import { useLayoutEffect, useRef, type RefObject } from "react";

interface LinuxPillInteractivityOptions {
  pillRef: RefObject<HTMLElement | null>;
  captionRef?: RefObject<HTMLElement | null>;
  captureWindow: boolean;
  pillInteractive: boolean;
}

// Native input shaping leaves hover delivery to the compositor, including
// when the pointer crosses between XWayland and native Wayland applications.
export function useLinuxPillInteractivity({
  pillRef,
  captionRef,
  captureWindow,
  pillInteractive,
}: LinuxPillInteractivityOptions): void {
  const nativeVisibleRef = useRef(true);
  useLayoutEffect(() => {
    const api = window.electronAPI;
    if (api?.getPlatform?.() !== "linux") return;
    let disposed = false;
    let generation = 0;
    let pending = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = (): void => {
      generation += 1;
      clearInterval(timer);
      timer = undefined;
    };
    const applyRegion = async (
      region: Parameters<typeof api.setMainWindowInputRegion>[0]
    ): Promise<void> => {
      const requestGeneration = generation;
      try {
        const visible = await api.setMainWindowInputRegion(region);
        if (disposed || requestGeneration !== generation) return;
        if (!visible) {
          nativeVisibleRef.current = false;
          stop();
        }
      } catch {
        // The native writer restores full input when shaping is unavailable.
        // A failure from an older effect must not stop its replacement.
        if (!disposed && requestGeneration === generation) stop();
      }
    };
    const sample = async (): Promise<void> => {
      if (disposed || pending || !nativeVisibleRef.current || document.hidden) return;
      pending = true;
      try {
        const pill = pillInteractive ? pillRef.current?.getBoundingClientRect() : null;
        const caption = pill && captionRef?.current?.getBoundingClientRect();
        // The caption is absolute and outside the pill's DOM bounding box.
        // Include its scroll/focus surface only while that pill owns input.
        const rect =
          pill && caption
            ? {
                x: Math.min(pill.x, caption.x),
                y: Math.min(pill.y, caption.y),
                width:
                  Math.max(pill.x + pill.width, caption.x + caption.width) -
                  Math.min(pill.x, caption.x),
                height:
                  Math.max(pill.y + pill.height, caption.y + caption.height) -
                  Math.min(pill.y, caption.y),
              }
            : pill;
        await applyRegion({
          x: rect?.x ?? 0,
          y: rect?.y ?? 0,
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
      } finally {
        pending = false;
      }
    };
    const start = (): void => {
      stop();
      if (!nativeVisibleRef.current) return;
      if (captureWindow) {
        // Full input joins the same native FIFO immediately, even while an
        // older narrow-region update is still awaiting acknowledgement.
        void applyRegion(null);
        return;
      }
      // Reapply even unchanged geometry: native resizes can reset input shape.
      timer = setInterval(() => void sample(), 50);
      void sample();
    };
    const unsubscribe = api.onMainWindowVisibilityChanged((visible) => {
      nativeVisibleRef.current = visible;
      if (visible) start();
      else stop();
    });
    start();
    return () => {
      disposed = true;
      stop();
      unsubscribe();
      // The native writer orders this after any pending narrow-region update.
      void api.setMainWindowInputRegion(null).catch(() => {});
    };
  }, [captureWindow, pillInteractive, pillRef, captionRef]);
}
