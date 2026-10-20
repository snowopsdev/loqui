import { CircleAlert } from "../icons";
import { Button } from "../ui/button";

export interface RecoveryAction {
  label: string;
  onClick(): void;
  variant?: "default" | "ghost" | "live";
}

export interface RecoveryCardProps {
  title: string;
  body: string;
  actions: readonly RecoveryAction[];
  tone?: "warning" | "neutral";
}

/** Shared setup recovery presentation; callers supply translated copy and actions. */
export function RecoveryCard({ title, body, actions, tone = "warning" }: RecoveryCardProps) {
  return (
    <div role="alert" className="onb-recovery" data-tone={tone}>
      <CircleAlert aria-hidden="true" className="onb-recovery__icon" />
      <div className="onb-recovery__copy">
        <p className="onb-recovery__title">{title}</p>
        <p className="onb-recovery__body">{body}</p>
        <div className="onb-recovery__actions">
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              size="sm"
              variant={action.variant ?? "default"}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
