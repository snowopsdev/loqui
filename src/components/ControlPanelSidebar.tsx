import { useTranslation } from "react-i18next";
import { useControlPanelNavItems, type ControlPanelView } from "./controlPanelNav";
import { Settings } from "./icons";
import { cn } from "./lib/utils";
export type { ControlPanelView };
interface Props {
  activeView: ControlPanelView;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: () => void;
}
export default function ControlPanelSidebar({ activeView, onViewChange, onOpenSettings }: Props) {
  const { t } = useTranslation();
  const navItems = useControlPanelNavItems();
  return (
    <div className="w-48 h-full flex flex-col bg-surface-window">
      <div className="h-12 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
      <nav className="flex flex-col gap-0.5 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn(
                "flex items-center gap-2.5 h-8 px-2.5 rounded-md text-start hover:bg-foreground/4",
                activeView === item.id && "bg-primary/8 text-primary"
              )}
            >
              <Icon size={16} />
              <span className="text-[13px]">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="flex-1" />
      <button
        onClick={onOpenSettings}
        className="flex items-center gap-2.5 mx-2 mb-3 h-8 px-2.5 rounded-md text-[13px] hover:bg-foreground/4"
      >
        <Settings size={16} />
        {t("sidebar.settings")}
      </button>
      <div className="px-4 pb-4 text-xs text-muted-foreground">Loqui</div>
    </div>
  );
}
