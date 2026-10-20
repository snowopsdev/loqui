import { Archive, Check, MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export interface HistoryMenuProps {
  showDiscarded: boolean;
  onToggleDiscarded: () => void;
  onClearAll: () => void;
  hasHistory: boolean;
}

// WS-Q13 / WS-15: visible, labelled, and away from the date label.
// Clear all keeps ControlPanel's existing confirm dialog.
export function HistoryMenu({
  showDiscarded,
  onToggleDiscarded,
  onClearAll,
  hasHistory,
}: HistoryMenuProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("home.history.menu")}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/6 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal size={16} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={showDiscarded}
          onSelect={onToggleDiscarded}
          className="gap-2 text-ui focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showDiscarded ? <Check size={14} aria-hidden /> : <Archive size={14} aria-hidden />}
          {t("home.history.showDiscarded")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!hasHistory}
          onSelect={onClearAll}
          className="gap-2 text-ui text-destructive focus:bg-background focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 size={14} aria-hidden />
          {t("home.history.clearAll")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
