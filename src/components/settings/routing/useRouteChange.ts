import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { routeChangeMessage } from "../../../lib/routeChangeMessage";
import { useRouteCopy, type RouteId } from "../../../lib/routes";
import type { SettingsPatch } from "../../../lib/providerSwitchPlans";
import type { RouteTarget } from "../../../lib/routePlanner";
import {
  applyDraft,
  requestRouteChange,
  requestDraftTarget as requestCoreDraftTarget,
  requestRoutePatch,
  type RouteChangeOutcome,
  type RouteRequestResult,
} from "../../../stores/routeDraftStore";
import { notify } from "../../ui/notices";

export function useRouteChange() {
  const { t } = useTranslation();
  const copy = useRouteCopy();
  const reportSaveFailure = useCallback(() => {
    notify({ kind: "alert", title: t("common.error") });
  }, [t]);

  const announce = useCallback(
    (outcome: RouteChangeOutcome) => {
      if (!outcome.applied) return;
      const message = routeChangeMessage(outcome.plan, t, copy.list);
      const undo = outcome.undo;
      notify({
        kind: "receipt",
        title: message.title,
        body: message.description,
        actions: undo
          ? [
              {
                label: t("routes.toast.undo"),
                primary: true,
                onClick: async () => {
                  const undone = await undo();
                  // Undo never moves data off the device by itself: that case waits in the Apply bar.
                  if (undone === "staged") {
                    notify({ kind: "notice", title: t("routes.toast.undoStaged") });
                    return;
                  }
                  if (undone === "save-failed") {
                    reportSaveFailure();
                    return;
                  }
                  if (undone === "superseded") return;
                  if (undone.applied) {
                    const back = routeChangeMessage(undone.plan, t, copy.list);
                    notify({ kind: "receipt", title: back.title, body: back.description });
                  }
                },
              },
            ]
          : undefined,
      });
    },
    [t, copy, reportSaveFailure]
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

  const requestDraftTarget = useCallback(
    async (
      id: RouteId,
      target: RouteTarget,
      editRouteId: RouteId = id
    ): Promise<RouteRequestResult> => {
      const result = await requestCoreDraftTarget(id, target, copy, editRouteId);
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

  return { request, requestPatch, requestDraftTarget, apply, copy };
}

// The one commit callback every picker receives (Task 9).
export function useRouteCommit(id: RouteId): (target: RouteTarget) => Promise<RouteRequestResult> {
  const { request } = useRouteChange();
  return useCallback((target: RouteTarget) => request(id, target), [request, id]);
}
