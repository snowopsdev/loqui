import { useTranslation } from "react-i18next";
import type { ResolvedRoute } from "../../lib/routes";
import { RouteDestinationChip, RouteStateChip } from "../settings/routing/RouteChips";
import { Button } from "../ui/button";
import { SELECTION_AI_LIMIT } from "./tableModel";

export interface TableSelectionBarProps {
  count: number;
  busy: boolean;
  route: Pick<ResolvedRoute, "locality" | "providerId" | "model" | "state">;
  onSummarise: () => void;
  onAsk: () => void;
  onGroup: () => void;
  onRemove: () => void;
}

// CCR-5: nothing here deletes content. Summarise and Ask go through the
// Space's own chat; the destination (LocalityRing + provider) is on the bar
// before anything is sent. Anything but "ready" (including §5.1's "unknown"
// and §5.4's sealed state) shows RouteStateChip and disables them.
export function TableSelectionBar({
  count,
  busy,
  route,
  onSummarise,
  onAsk,
  onGroup,
  onRemove,
}: TableSelectionBarProps) {
  const { t } = useTranslation();
  const tooMany = count > SELECTION_AI_LIMIT;
  const routeReady = route.state.status === "ready";
  const aiDisabled = busy || tooMany || !routeReady;
  return (
    <div role="toolbar" aria-label={t("table.selection.count", { count })} className="table-selbar">
      <span className="table-selbar__count">{t("table.selection.count", { count })}</span>
      {routeReady ? <RouteDestinationChip route={route} /> : <RouteStateChip state={route.state} />}
      <Button
        size="sm"
        variant="ghost"
        className="table-selbar__machine"
        disabled={aiDisabled}
        onClick={onSummarise}
      >
        {t("table.selection.summarise")}
      </Button>
      <Button size="sm" variant="ghost" disabled={aiDisabled} onClick={onAsk}>
        {t("table.selection.ask")}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onGroup}>
        {t("table.selection.group")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onRemove}>
        {t("table.selection.remove")}
      </Button>
      {busy && <span className="table-selbar__note">{t("table.selection.busy")}</span>}
      {tooMany && (
        <span className="table-selbar__note">
          {t("table.selection.limit", { limit: SELECTION_AI_LIMIT })}
        </span>
      )}
    </div>
  );
}
