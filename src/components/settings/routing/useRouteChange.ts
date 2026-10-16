import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { routeChangeMessage } from "../../../lib/routeChangeMessage";
import { useRouteCopy, type RouteId } from "../../../lib/routes";
import type { SettingsPatch } from "../../../lib/providerSwitchPlans";
import type { RouteTarget } from "../../../lib/routePlanner";
import {
  applyDraft,
  requestRouteChange,
  requestRoutePatch,
  type RouteChangeOutcome,
  type RouteRequestResult,
} from "../../../stores/routeDraftStore";
import { useToast } from "../../ui/useToast";

export function useRouteChange() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const copy = useRouteCopy();
  const reportSaveFailure = useCallback(() => {
    toast({ title: t("common.error"), variant: "destructive", duration: 5000 });
  }, [t, toast]);

  const announce = useCallback(
    (outcome: RouteChangeOutcome) => {
      if (!outcome.applied) return;
      const message = routeChangeMessage(outcome.plan, t, copy.list);
      const undo = outcome.undo;
      toast({
        title: message.title,
        description: message.description,
        variant: "success",
        duration: 7000,
        actions: undo
          ? [
              {
                label: t("routes.toast.undo"),
                dismissOnClick: true,
                onClick: async () => {
                  const undone = await undo();
                  // Undo never moves data off the device by itself: that case waits in the Apply bar.
                  if (undone === "staged") {
                    toast({
                      title: t("routes.toast.undoStaged"),
                      variant: "default",
                      duration: 5000,
                    });
                    return;
                  }
                  if (undone === "save-failed") {
                    reportSaveFailure();
                    return;
                  }
                  if (undone === "superseded") return;
                  if (undone.applied) {
                    const back = routeChangeMessage(undone.plan, t, copy.list);
                    toast({
                      title: back.title,
                      description: back.description,
                      variant: "success",
                      duration: 4000,
                    });
                  }
                },
              },
            ]
          : undefined,
      });
    },
    [t, toast, copy, reportSaveFailure]
  );

  // Save failures and stale completions never announce success. An ACK that
  // loses ownership still updates the committed store, but preserves newer draft state.
  const request = useCallback(
    async (id: RouteId, target: RouteTarget): Promise<RouteRequestResult> => {
      const result = await requestRouteChange(id, target, copy);
      if (result === "save-failed") reportSaveFailure();
      else if (result !== "staged" && result !== "superseded") announce(result);
      return result;
    },
    [copy, announce, reportSaveFailure]
  );

  // Switches, Corti options, providerSearch:<scope> and the enterprise fields of an active route (Steps 6–10, Task 9).
  const requestPatch = useCallback(
    async (id: RouteId, patch: SettingsPatch): Promise<RouteRequestResult> => {
      const result = await requestRoutePatch(id, patch, copy);
      if (result === "save-failed") reportSaveFailure();
      else if (result !== "staged" && result !== "superseded") announce(result);
      return result;
    },
    [copy, announce, reportSaveFailure]
  );

  const apply = useCallback(async (): Promise<RouteChangeOutcome | null | "save-failed"> => {
    const outcome = await applyDraft(copy);
    if (outcome === "save-failed") reportSaveFailure();
    else if (outcome) announce(outcome);
    return outcome;
  }, [copy, announce, reportSaveFailure]);

  return { request, requestPatch, apply, copy };
}

// The one commit callback every picker receives (Task 9).
export function useRouteCommit(id: RouteId): (target: RouteTarget) => Promise<RouteRequestResult> {
  const { request } = useRouteChange();
  return useCallback((target: RouteTarget) => request(id, target), [request, id]);
}
