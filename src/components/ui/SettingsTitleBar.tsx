import type { ReactNode } from "react";

export function SettingsTitleBar({
  title,
  close,
  compact = false,
}: {
  title: string;
  close: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`sticky top-0 z-20 mb-4 flex items-center justify-between gap-3 border-b border-border/60 bg-background/90 py-3 backdrop-blur-md dark:border-border-subtle dark:bg-surface-1/90 ${compact ? "px-4" : "px-6"}`}
    >
      <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">{title}</h2>
      {close}
    </div>
  );
}
