import { useId, type ComponentType } from "react";
import { cn } from "../lib/utils";

export interface MetricCardProps {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  detail: string;
  largeValue?: boolean;
  onSelect?: () => void;
  selectLabel?: string;
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  largeValue = false,
  onSelect,
  selectLabel,
}: MetricCardProps) {
  const id = useId();
  const body = (
    <>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon size={14} />
        <span id={`${id}-label`} className="text-caption">
          {label}
        </span>
      </div>
      <p
        id={`${id}-value`}
        className={cn(
          "mt-3 font-semibold tracking-tight text-foreground",
          largeValue ? "text-3xl" : "text-2xl"
        )}
      >
        {value}
      </p>
      <p id={`${id}-detail`} className="mt-1 text-caption text-muted-foreground">
        {detail}
      </p>
    </>
  );
  const frame = "rounded-xl border border-border/70 bg-card/70 p-4 text-start dark:border-white/10";
  return onSelect ? (
    <button
      type="button"
      aria-labelledby={`${id}-label ${id}-value`}
      aria-describedby={`${id}-detail${selectLabel ? ` ${id}-destination` : ""}`}
      onClick={onSelect}
      className={cn(
        frame,
        "hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      {body}
      {selectLabel && (
        <span id={`${id}-destination`} className="sr-only">
          {selectLabel}
        </span>
      )}
    </button>
  ) : (
    <div className={frame}>{body}</div>
  );
}
