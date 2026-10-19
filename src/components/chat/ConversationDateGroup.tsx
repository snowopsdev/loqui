import { cn } from "../lib/utils";

interface ConversationDateGroupProps {
  label: string;
}

export default function ConversationDateGroup({ label }: ConversationDateGroupProps) {
  return (
    <div
      className={cn(
        "px-3 pt-3 pb-1",
        "text-caption font-semibold text-muted-foreground uppercase tracking-wider",
        "select-none"
      )}
    >
      {label}
    </div>
  );
}
