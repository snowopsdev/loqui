import { useCallback } from "react";
import { useToast, type ToastProps } from "../ui/useToast";
import type { OnboardingNotice } from "./onboardingNotices";

// Spec §5.3: until Plan 04 lands, notices go through the toast API. Plan 04
// replaces this file's body with `export const useOnboardingNotifier = () => notify;`
// and deletes toastFromNotice and its test.
export function toastFromNotice(notice: OnboardingNotice): Omit<ToastProps, "id"> {
  if (notice.kind === "receipt") return { title: notice.title, variant: "success" };
  return {
    title: notice.title,
    description: notice.body,
    variant: "destructive",
    duration: notice.persistent ? 0 : undefined,
    actions: notice.actions?.map((action) => ({
      label: action.label,
      icon: "retry" as const,
      onClick: action.onClick,
    })),
  };
}

export function useOnboardingNotifier(): (notice: OnboardingNotice) => void {
  const { toast } = useToast();
  return useCallback((notice) => void toast(toastFromNotice(notice)), [toast]);
}
