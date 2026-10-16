import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { providerDisplayLabel } from "../../../lib/locality";
import { useResolvedRoutes } from "../../../lib/routes";
import { SETUP_AFTER_APPLY, type ApplyBlocker, type RoutePlan } from "../../../lib/routePlanner";
import { planDraft, useRouteDraftStore } from "../../../stores/routeDraftStore";
import { ensureSealedSubscribed, useSealedStore } from "../../../stores/sealedStore";
import { Button } from "../../ui/button";
import { RouteDestinationChip } from "./RouteChips";
import { useRouteChange } from "./useRouteChange";

export function StagedRouteBarView({
  plan,
  onApply,
  onDiscard,
  shortcutHint,
  placement = "modal",
}: {
  plan: RoutePlan;
  onApply: () => void;
  onDiscard: () => void;
  shortcutHint: string | null;
  placement?: "modal" | "inline";
}) {
  const { t } = useTranslation();
  const leaves = plan.changes.some(
    (c) => c.after.locality !== "device" && c.after.state.status !== "off"
  );
  const keyRoute = plan.changes.find((c) => c.after.state.status === "needsKey")?.after ?? null;
  const keyProvider = keyRoute?.providerId ? providerDisplayLabel(keyRoute.providerId, t) : "";
  // R2-9: what the blocker still needs. Codex and the enterprise clouds sign
  // in inside the staged panel; a remote model is chosen, not downloaded.
  const blockerKey = (blocker: ApplyBlocker): string => {
    if (
      blocker === "needsKey" &&
      keyRoute?.providerId &&
      SETUP_AFTER_APPLY.has(keyRoute.providerId)
    ) {
      return "staging.blocked.signIn";
    }
    if (blocker === "needsModel") {
      const modelRoute = plan.changes.find((c) => c.after.state.status === "needsModel")?.after;
      const download =
        modelRoute?.state.status === "needsModel" && modelRoute.state.sizeBytes !== undefined;
      return download ? "staging.blocked.needsModel" : "staging.blocked.chooseModel";
    }
    return `staging.blocked.${blocker}`;
  };
  return (
    <div
      role="region"
      aria-label={t("staging.region")}
      className={
        placement === "modal"
          ? "sticky bottom-0 z-20 mt-6 rounded-lg border border-border/70 bg-background/95 px-4 py-3 text-xs shadow-sm backdrop-blur-md"
          : "mt-3 rounded-lg border border-border/70 bg-background px-4 py-3 text-xs"
      }
    >
      <p className="text-sm font-semibold text-foreground">{t("staging.heading")}</p>
      <ul className="mt-2 space-y-2">
        {plan.changes.map((change) => (
          <li
            key={change.id}
            data-route={change.id}
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="font-medium text-foreground">{t(`routes.names.${change.id}`)}</span>
            {change.coupled && (
              <span className="rounded-full border border-border px-1.5 text-[11px] text-muted-foreground">
                {t("staging.coupled")}
              </span>
            )}
            <span aria-hidden="true" className="inline-block rtl:rotate-180">
              →
            </span>
            <RouteDestinationChip route={change.after} />
            {change.after.host && (
              <span dir="ltr" className="font-mono text-[11px] text-muted-foreground">
                {change.after.host}
              </span>
            )}
            <p className="basis-full text-muted-foreground">
              {change.after.state.status === "off"
                ? t("staging.offNote")
                : change.after.sends
                  ? t("staging.sends", { payload: change.after.sends })
                  : t("staging.staysOnDevice")}
            </p>
          </li>
        ))}
      </ul>
      {leaves && (
        <p className="mt-2 text-[11px] text-muted-foreground">{t("routes.payload.metadataNote")}</p>
      )}
      {/* R2-9: Apply is disabled until every changed, enabled, off-device route is ready. */}
      <p role="status" aria-live="polite" className="mt-1 font-medium text-foreground">
        {plan.blocker ? t(blockerKey(plan.blocker), { provider: keyProvider }) : ""}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onDiscard}>
          {t("staging.discard")}
        </Button>
        <Button size="sm" onClick={onApply} disabled={plan.blocker !== null}>
          {t("staging.apply")}
          {shortcutHint && (
            <kbd aria-hidden="true" dir="ltr" className="ms-1.5 font-mono text-[11px] opacity-70">
              {shortcutHint}
            </kbd>
          )}
        </Button>
      </div>
    </div>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform ?? "");

export function StagedRouteBar({
  placement = "modal",
  shortcut = true,
}: {
  placement?: "modal" | "inline";
  shortcut?: boolean;
}) {
  const draft = useRouteDraftStore((s) => s.draft);
  const discard = useRouteDraftStore((s) => s.discard);
  const sealed = useSealedStore((s) => s.sealed); // I14: the one sealed authority
  const live = useResolvedRoutes(); // re-plans when settings or facts change
  const { apply, copy } = useRouteChange();

  useEffect(() => {
    ensureSealedSubscribed();
  }, []);

  // Preview == commit: Task 7's planDraft is the plan applyDraft re-runs at click time,
  // with facts and getSealed() from currentPlanContext (I14).
  const plan = useMemo(
    () => (draft ? planDraft(draft, copy) : null),
    // live and sealed are read inside planDraft through getState()/currentPlanContext().
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, copy, live, sealed]
  );

  useEffect(() => {
    if (!shortcut || !plan || plan.kind === "noop") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      // Only inside the Settings dialog: ⌘↵ in chat or notes never applies a route.
      const target = event.target as { closest?: (selector: string) => unknown } | null;
      if (!target?.closest?.("[data-settings-dialog]")) return;
      if (plan.blocker !== null) return;
      event.preventDefault();
      void apply();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcut, plan, apply]);

  // Leaving the view that hosts the bar (Settings closing) drops the draft unapplied.
  useEffect(() => () => useRouteDraftStore.getState().discard(), []);

  if (!plan || plan.kind === "noop") return null;
  return (
    <StagedRouteBarView
      plan={plan}
      placement={placement}
      onApply={() => void apply()}
      onDiscard={discard}
      shortcutHint={shortcut ? (isMac ? "⌘↵" : "Ctrl ↵") : null}
    />
  );
}
