import type { OnboardingStep } from "../../utils/onboardingState";

type Translate = (key: string, values?: Record<string, unknown>) => string;

/** Spec §5.3 notify() input, the subset setup uses. */
export interface OnboardingNotice {
  kind: "receipt" | "alert";
  title: string;
  body?: string;
  actions?: { label: string; onClick(): void }[];
  persistent?: boolean;
}

export function voiceReadyNotice(t: Translate): OnboardingNotice {
  return { kind: "receipt", title: t("setupFlow.download.readyTitle") };
}

export function voiceFailedNotice(
  t: Translate,
  message: string,
  retry: () => void
): OnboardingNotice {
  return {
    kind: "alert",
    title: t("setupFlow.download.failedTitle"),
    body: message,
    actions: [{ label: t("setupFlow.download.retry"), onClick: retry }],
    persistent: true,
  };
}

/** Voice and Say something show the download inline; other steps need a notice. */
export function shouldAnnounceOffStep(step: OnboardingStep): boolean {
  return step !== "speech" && step !== "try";
}
