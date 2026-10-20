import { CalendarDays, MessageSquare, Mic, NotebookPen } from "../icons";

const icons = { note: NotebookPen, meeting: CalendarDays, dictation: Mic, chat: MessageSquare };

/** React mounts the actual app glyphs before the canvas's layout effects run. */
export function TableCardSymbols({ templates }: { templates: Map<string, SVGSVGElement> }) {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
      <defs>
        {Object.entries(icons).map(([kind, Icon]) => (
          <Icon
            key={kind}
            size={12}
            aria-hidden="true"
            ref={(node) => {
              if (node) templates.set(kind, node);
              else templates.delete(kind);
            }}
          />
        ))}
      </defs>
    </svg>
  );
}
