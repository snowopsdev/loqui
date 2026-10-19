import { useTranslation } from "react-i18next";
import { AlertTriangle } from "../icons";
import { cn } from "../lib/utils";

// WS-Q10: one notice for history that is not being kept, shared by Home and Insights.
export function DataRetentionNotice({
  messageKey,
  className,
}: {
  messageKey: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-3.5 py-2.5",
        className
      )}
    >
      <AlertTriangle size={14} aria-hidden className="shrink-0 text-warning" />
      <span className="text-ui text-foreground">{t(messageKey)}</span>
    </div>
  );
}
