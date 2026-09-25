import { useTranslation } from "react-i18next";
import { useControlPanelNavItems, type ControlPanelView } from "./controlPanelNav";
import { Mic, Settings } from "./icons";
import { cn } from "./lib/utils";
import { getCachedPlatform } from "../utils/platform";
export type { ControlPanelView };
interface Props {
  activeView: ControlPanelView;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: () => void;
}
export default function ControlPanelSidebar({ activeView, onViewChange, onOpenSettings }: Props) {
  const { t } = useTranslation();
  const navItems = useControlPanelNavItems();
  const isMac = getCachedPlatform() === "darwin";
  const sections = [
    { id: "workspace", label: t("sidebar.sections.workspace", { defaultValue: "Workspace" }) },
    { id: "library", label: t("sidebar.sections.library", { defaultValue: "Library" }) },
  ] as const;

  return (
    <div className="w-52 h-full flex flex-col bg-surface-window">
      <div
        className={cn(
          "shrink-0 flex items-end gap-2 px-3 pb-2.5",
          // Native macOS controls occupy the first 34px, including during sidebar peek.
          isMac ? "h-20" : "h-12"
        )}
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <span
          className="flex h-5 w-5 items-center justify-center rounded-md bg-foreground/8 text-foreground/65"
          aria-hidden="true"
        >
          <Mic size={12} strokeWidth={2.2} />
        </span>
        <span className="text-[12px] font-medium tracking-tight text-foreground/70">Loqui</span>
      </div>
      <nav
        aria-label={t("sidebar.navigation", { defaultValue: "Main navigation" })}
        className="flex flex-col gap-4 px-2"
      >
        {sections.map((section) => (
          <div key={section.id}>
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
              {section.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {navItems
                .filter((item) => item.section === section.id)
                .map((item) => {
                  const Icon = item.icon;
                  const isActive = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onViewChange(item.id)}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-start text-[13px] outline-none transition-colors duration-150",
                        "text-foreground/75 hover:bg-foreground/5 hover:text-foreground dark:hover:bg-white/6",
                        "focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-surface-window",
                        isActive && "bg-foreground/7 font-medium text-foreground dark:bg-white/8"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute start-0 top-2 bottom-2 w-0.5 rounded-full bg-primary opacity-0 transition-opacity duration-150",
                          isActive && "opacity-100"
                        )}
                      />
                      <Icon
                        size={16}
                        className={cn(
                          "shrink-0 transition-colors duration-150",
                          isActive
                            ? "text-primary"
                            : "text-foreground/55 group-hover:text-foreground/80"
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </nav>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onOpenSettings}
        className="mx-2 mb-2 flex h-9 items-center gap-2.5 rounded-md border-t border-border/60 px-2.5 pt-2 text-[13px] text-foreground/75 outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-surface-window dark:border-white/10"
      >
        <Settings size={16} />
        {t("sidebar.settings")}
      </button>
    </div>
  );
}
