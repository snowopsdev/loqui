import type { RouteSwitchKey, SettingsPatch } from "../../../lib/providerSwitchPlans";
import type { RouteId } from "../../../lib/routes";
import { useSettingsStore } from "../../../stores/settingsStore";
import { Toggle } from "../../ui/toggle";
import { useRouteChange } from "./useRouteChange";

export interface RouteSwitchProps {
  routeId: RouteId;
  settingKey: RouteSwitchKey;
  disabled?: boolean;
  /** Runs after the change is committed, never while it waits for Apply. */
  onApplied?: (enabled: boolean) => void;
}

// A switch that turns a route on or off. The planner decides (Task 6):
// off, or on for a route that stays on this device, applies at once with
// Undo; on for a route that leaves the device waits in the Apply bar. The
// switch shows the live value, so a staged "on" stays off until Apply.
export function RouteSwitch({ routeId, settingKey, disabled, onApplied }: RouteSwitchProps) {
  const checked = useSettingsStore((s) => s[settingKey]);
  const { requestPatch } = useRouteChange();
  return (
    <Toggle
      checked={checked}
      disabled={disabled}
      onChange={async (next) => {
        const outcome = await requestPatch(routeId, { [settingKey]: next } as SettingsPatch);
        if (
          outcome !== "staged" &&
          outcome !== "superseded" &&
          outcome !== "save-failed" &&
          outcome.applied
        )
          onApplied?.(next);
      }}
    />
  );
}
