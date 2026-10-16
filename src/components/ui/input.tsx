import * as React from "react";

import { cn } from "../lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Focus ring: drawn by the unlayered native-field rule in index.css, which wins over any utility here.
        "flex h-10 w-full min-w-0 rounded border border-input-border bg-input px-3 py-2 text-sm text-foreground shadow-none transition-colors duration-[var(--motion-fast)] outline-none",
        "placeholder:text-muted-foreground/70",
        "selection:bg-primary selection:text-primary-foreground",
        "file:text-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted",
        "dark:bg-surface-1",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
}

export { Input };
