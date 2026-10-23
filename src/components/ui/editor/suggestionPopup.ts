import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import type { ForwardRefExoticComponent, PropsWithoutRef, RefAttributes } from "react";

export interface SuggestionHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/** A forwardRef popup whose ref exposes onKeyDown. */
export type SuggestionPopupComponent<P> = ForwardRefExoticComponent<
  PropsWithoutRef<P> & RefAttributes<SuggestionHandle>
>;

// TipTap's ReactRenderer requires props assignable to Record<string, any>.
// Interfaces have no implicit index signature, so the popup props are widened
// at this one boundary; callers keep their exact prop types.
type RendererProps = Record<string, any>;

const GAP = 6;
const MARGIN = 8;

export function popupPosition(
  rect: { left: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  size: { width: number; height: number }
): { left: number; top: number } {
  const left = Math.max(MARGIN, Math.min(rect.left, viewport.width - size.width - MARGIN));
  const below = rect.bottom + GAP;
  const fitsBelow = below + size.height <= viewport.height - MARGIN;
  return { left, top: fitsBelow ? below : Math.max(MARGIN, rect.top - GAP - size.height) };
}

export function createSuggestionPopup<Item, P extends object>(
  component: SuggestionPopupComponent<P>,
  options: { width: number; toProps: (props: SuggestionProps<Item>) => P }
): NonNullable<SuggestionOptions<Item>["render"]> {
  return () => {
    let renderer: ReactRenderer<SuggestionHandle, RendererProps> | null = null;
    let currentProps: SuggestionProps<Item> | null = null;
    let observer: ResizeObserver | null = null;
    const place = (props: SuggestionProps<Item>) => {
      const rect = props.clientRect?.();
      const el = renderer?.element;
      if (!rect || !el) return;
      const position = popupPosition(
        rect,
        { width: window.innerWidth, height: window.innerHeight },
        { width: options.width, height: el.offsetHeight || 240 }
      );
      Object.assign(el.style, {
        position: "fixed",
        zIndex: "9999",
        left: `${position.left}px`,
        top: `${position.top}px`,
      });
    };
    return {
      onStart: (props) => {
        currentProps = props;
        renderer = new ReactRenderer<SuggestionHandle, RendererProps>(
          component as unknown as SuggestionPopupComponent<RendererProps>,
          { editor: props.editor, props: options.toProps(props) as RendererProps }
        );
        renderer.element.setAttribute("data-editor-chrome", "");
        document.body.appendChild(renderer.element);
        place(props);
        // Portal updates commit after updateProps. Measure the committed size,
        // including the initial async items, before deciding below vs above.
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(() => {
            if (currentProps) place(currentProps);
          });
          observer.observe(renderer.element);
        }
      },
      onUpdate: (props) => {
        currentProps = props;
        renderer?.updateProps(options.toProps(props) as RendererProps);
        renderer?.element.style.removeProperty("display");
        place(props);
      },
      onKeyDown: ({ event }) => {
        if (event.key === "Escape") {
          renderer?.element.style.setProperty("display", "none");
          return true;
        }
        return renderer?.ref?.onKeyDown(event) ?? false;
      },
      onExit: () => {
        observer?.disconnect();
        observer = null;
        currentProps = null;
        renderer?.element.remove();
        renderer?.destroy();
        renderer = null;
      },
    };
  };
}
