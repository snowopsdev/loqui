import { useLayoutEffect, useRef, type ReactNode } from "react";
import { WorkspaceActivity } from "../hooks/useWorkspaceActive";

export default function WorkspacePresentation({
  active,
  children,
  className,
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const wasActive = useRef(active);
  useLayoutEffect(() => {
    if (active && !wasActive.current) {
      const target = lastFocus.current;
      if (target?.isConnected) target.focus();
      else host.current?.focus();
    }
    wasActive.current = active;
  }, [active]);
  return (
    <WorkspaceActivity.Provider value={active}>
      <div
        className={className}
        ref={host}
        hidden={!active}
        inert={!active}
        aria-hidden={!active || undefined}
        // Keep the hidden attribute authoritative even if descendant layout uses flex.
        style={!active ? { display: "none" } : undefined}
        tabIndex={-1}
        data-workspace-active={active}
        onFocusCapture={(event) => {
          if (active) lastFocus.current = event.target as HTMLElement;
        }}
      >
        {children}
      </div>
    </WorkspaceActivity.Provider>
  );
}
