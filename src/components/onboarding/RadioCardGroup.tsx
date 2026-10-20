import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/utils";
import { nextRadioIndex, rovingTabIndex } from "./radioNavigation";

export interface RadioCardOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  disabledReason?: string;
}

export interface RadioCardGroupProps<T extends string> {
  label: string;
  idPrefix: string;
  options: readonly RadioCardOption<T>[];
  value: T | null;
  onChange(value: T): void;
  variant?: "cards" | "segmented";
  className?: string;
}

/** One accessible single-choice group for voices and cleanup (ONB-Q12). */
export function RadioCardGroup<T extends string>({
  label,
  idPrefix,
  options,
  value,
  onChange,
  variant = "cards",
  className,
}: RadioCardGroupProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const disabled = options.map((option) => Boolean(option.disabledReason));
  const selected = options.findIndex((option) => option.value === value);

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const dir = globalThis.document?.documentElement?.dir === "rtl" ? "rtl" : "ltr";
    const next = nextRadioIndex(index, event.key, disabled, dir);
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-variant={variant}
      className={cn("onb-radio-group", className)}
    >
      {options.map((option, index) => {
        const reasonId = option.disabledReason ? `${idPrefix}-${option.value}-reason` : undefined;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            aria-disabled={option.disabledReason ? true : undefined}
            aria-describedby={reasonId}
            tabIndex={rovingTabIndex(index, selected, disabled)}
            data-value={option.value}
            className="onb-radio"
            onClick={() => {
              if (!option.disabledReason) onChange(option.value);
            }}
            onKeyDown={onKeyDown(index)}
          >
            <span className="onb-radio__label">
              <span>{option.label}</span>
              {option.badge}
            </span>
            {option.description ? (
              <span className="onb-radio__description">{option.description}</span>
            ) : null}
            {option.meta ? <span className="onb-radio__meta">{option.meta}</span> : null}
            {reasonId ? (
              <span id={reasonId} className="onb-radio__reason">
                {option.disabledReason}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
