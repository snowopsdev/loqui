import { useTranslation } from "react-i18next";
import { useRouteDraftStore } from "../../../stores/routeDraftStore";
import { SectionHeader } from "../../ui/SettingsSection";
import { KeyringPanel } from "./KeyringPanel";
import { Patchbay } from "./Patchbay";
import { StagedRoutePanel } from "./StagedRoutePanel";

export function RoutingSection({
  onNavigateToPath,
}: {
  onNavigateToPath?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const draft = useRouteDraftStore((s) => s.draft);
  return (
    <div className="space-y-6">
      <div>
        <SectionHeader description={t("patchbay.description")} />
        <Patchbay onNavigateToPath={onNavigateToPath} />
        {/* A staged pick needs its provider, key or address right here; the Apply bar alone is a dead end. */}
        {draft && (
          <div className="mt-3">
            <StagedRoutePanel routeId={draft.routeId} />
          </div>
        )}
      </div>
      <KeyringPanel />
    </div>
  );
}
