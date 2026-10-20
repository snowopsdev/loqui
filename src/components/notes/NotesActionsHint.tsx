import { useTranslation } from "react-i18next";
import { X } from "../icons";
import { cn } from "../lib/utils";
import { providerDisplayLabel } from "../../lib/locality";
import type { ResolvedRoute } from "../../lib/routes";
import { notesActionsHint } from "./notesActionsHint";

export function NotesActionsHint({
  route,
  dismissed,
  onOpenSettings,
  onDismiss,
  className,
}: {
  route: Pick<ResolvedRoute, "state" | "providerId" | "settingsPath">;
  dismissed: boolean;
  onOpenSettings?: (settingsPath: string) => void;
  onDismiss: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const hint = notesActionsHint(route.state, dismissed);
  if (!hint) return null;
  const provider = providerDisplayLabel(route.providerId, t);
  return (
    <div
      role="note"
      data-route-state={route.state.status}
      className={cn(
        "rounded-md border border-border bg-muted/40 px-3 py-2 text-caption text-muted-foreground",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <span className="flex-1 text-foreground">{t(hint.titleKey, { provider })}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("common.close")}
          className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      {onOpenSettings && (
        <button
          type="button"
          data-settings-path={route.settingsPath}
          onClick={() => onOpenSettings(route.settingsPath)}
          className="mt-0.5 rounded-sm text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t(hint.actionKey)}
        </button>
      )}
    </div>
  );
}
