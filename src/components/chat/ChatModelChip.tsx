import { useTranslation } from "react-i18next";
import { RouteDestinationChip, RouteStateChip } from "../settings/routing/RouteChips";
import type { ResolvedRoute } from "../../lib/routes";
import type { MessageRoute } from "./types";

export interface ChatModelChipProps {
  route: Pick<ResolvedRoute, "locality" | "providerId" | "model" | "state" | "settingsPath">;
  onOpenSettings: (settingsPath: string) => void;
}

// eslint-disable-next-line react-refresh/only-export-components -- published pure conversion lives in messageRoute
export { toMessageRoute } from "./messageRoute";

// The shared ring’s decorative provider badge has an unlayered 8px rule;
// override it only on these disclosures to keep their full 12px floor.
// Read-only disclosure for the next message. Settings owns route changes.
export function ChatModelChip({ route, onOpenSettings }: ChatModelChipProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-settings-path={route.settingsPath}
      onClick={() => onOpenSettings(route.settingsPath)}
      className="inline-flex min-h-7 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full border border-border px-2.5 py-1 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/10"
    >
      <RouteDestinationChip
        route={route}
        className="h-auto min-w-0 text-caption [&_.locality-ring>span]:text-[12px]!"
      />
      {route.state.status !== "ready" && (
        <RouteStateChip state={route.state} className="h-auto shrink-0 px-0 text-caption" />
      )}
      <span className="sr-only">{t("chat.model.changeHint")}</span>
    </button>
  );
}

export function RouteTag({ route }: { route: MessageRoute }) {
  return (
    <RouteDestinationChip
      route={route}
      className="h-auto text-caption text-muted-foreground [&_.locality-ring>span]:text-[12px]!"
    />
  );
}
