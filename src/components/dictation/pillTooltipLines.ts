type T = (key: string, options?: Record<string, unknown>) => string;

export function buildPillTooltipLines({
  micState,
  activationMode,
  hotkeyLabel,
  routeLine,
  t,
}: {
  micState: "idle" | "hover" | "recording" | "processing" | "unavailable";
  activationMode: "tap" | "push";
  hotkeyLabel: string;
  routeLine: string;
  t: T;
}): string[] {
  const first =
    micState === "recording"
      ? t("app.mic.recording")
      : micState === "unavailable"
        ? t("app.mic.waitingForMicrophone")
        : micState === "processing"
          ? t("app.mic.processing")
          : t(activationMode === "push" ? "pill.tooltip.hold" : "pill.tooltip.press", {
              hotkey: hotkeyLabel,
            });
  return routeLine ? [first, routeLine] : [first];
}
