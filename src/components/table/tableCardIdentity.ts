import type { TableMeasurements } from "./tableMeasurements";
import type { TableCardModel } from "./tableModel";

export interface TableCardProps {
  card: TableCardModel;
  selected: boolean;
  focusable: boolean;
  dragging: boolean;
  snapping: boolean;
  expanded: boolean;
  onMeasure: (key: string, h: number) => void;
  observe?: TableMeasurements["observe"];
  onNode?: (key: string, node: HTMLDivElement | null, overflow: (fixed?: boolean) => void) => void;
}

export function sameTableCard(previous: TableCardProps, next: TableCardProps) {
  const a = previous.card;
  const b = next.card;
  return (
    a.key === b.key &&
    a.entity === b.entity &&
    a.z === b.z &&
    a.fixedH === b.fixedH &&
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.w === b.rect.w &&
    a.rect.h === b.rect.h &&
    previous.selected === next.selected &&
    previous.focusable === next.focusable &&
    previous.dragging === next.dragging &&
    previous.snapping === next.snapping &&
    previous.expanded === next.expanded &&
    previous.onMeasure === next.onMeasure &&
    previous.onNode === next.onNode &&
    previous.observe === next.observe
  );
}
