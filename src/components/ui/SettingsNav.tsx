import React from "react";

export interface SidebarItem<T extends string> {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: string;
  description?: string;
  badge?: string;
  badgeVariant?: "default" | "new" | "update" | "dot";
  shortcut?: string;
}

interface SettingsNavProps<T extends string> {
  items: SidebarItem<T>[];
  activeSection: T;
  onSectionChange: (section: T) => void;
  isCompact: boolean;
  ariaLabel: string;
}

function renderBadge<T extends string>(item: SidebarItem<T>) {
  if (!item.badge && item.badgeVariant !== "dot") return null;
  if (item.badgeVariant === "dot")
    return <span className="ms-auto h-1.5 w-1.5 rounded-full bg-primary shrink-0" />;
  return (
    <span
      className={`ms-auto text-xs font-semibold uppercase tracking-wider px-1.5 py-px rounded-sm shrink-0 ${item.badgeVariant === "new" ? "bg-primary/10 text-primary dark:bg-primary/15" : item.badgeVariant === "update" ? "bg-foreground/10 text-foreground" : "bg-muted text-muted-foreground"}`}
    >
      {item.badge}
    </span>
  );
}

export function SettingsNav<T extends string>({
  items,
  activeSection,
  onSectionChange,
  isCompact,
  ariaLabel,
}: SettingsNavProps<T>) {
  const groupedItems = React.useMemo(() => {
    const groups: { label: string | null; items: SidebarItem<T>[] }[] = [];
    let currentGroup: string | null | undefined;
    for (const item of items) {
      const group = item.group ?? null;
      if (group !== currentGroup) {
        groups.push({ label: group, items: [item] });
        currentGroup = group;
      } else groups[groups.length - 1].items.push(item);
    }
    return groups;
  }, [items]);

  return (
    <nav
      aria-label={ariaLabel}
      className={`relative flex-1 pb-2 overflow-y-auto ${isCompact ? "px-1.5 pt-4" : "px-2 pt-3"}`}
    >
      {groupedItems.map((group, groupIndex) => (
        <div key={groupIndex} className={groupIndex > 0 ? "mt-4" : ""}>
          {!isCompact && group.label && (
            <div className="px-2 pb-1">
              <span className="text-[11px] font-medium text-muted-foreground/70 dark:text-muted-foreground/65">
                {group.label}
              </span>
            </div>
          )}
          <div className="space-y-px">
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-section-id={item.id}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={isCompact ? item.label : undefined}
                  onClick={() => onSectionChange(item.id)}
                  title={
                    item.description
                      ? `${item.label} — ${item.description}`
                      : isCompact
                        ? item.label
                        : undefined
                  }
                  className={`group relative w-full flex items-center text-start text-xs rounded-md transition-colors duration-[var(--motion-fast)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${isCompact ? "justify-center px-0 py-2" : "gap-2 px-2 py-1.5"} ${isActive ? "text-foreground bg-muted dark:bg-surface-raised" : "text-muted-foreground dark:text-foreground/75 hover:text-foreground hover:bg-muted/50 dark:hover:bg-surface-2"}`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 transition-colors duration-[var(--motion-fast)] ${isActive ? "text-primary" : "text-muted-foreground/70 dark:text-foreground/55 group-hover:text-foreground/80"}`}
                  />
                  {!isCompact && (
                    <>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate leading-tight ${isActive ? "font-medium" : "font-normal"}`}
                        >
                          {item.label}
                        </span>
                        {item.description && (
                          <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                            {item.description}
                          </span>
                        )}
                      </span>
                      {renderBadge(item)}
                      {item.shortcut && !item.badge && (
                        <kbd
                          dir="ltr"
                          className="ms-auto text-xs text-muted-foreground/70 font-mono shrink-0"
                        >
                          {item.shortcut}
                        </kbd>
                      )}
                    </>
                  )}
                  {isCompact && item.badgeVariant === "dot" && (
                    <span className="absolute top-1.5 end-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
