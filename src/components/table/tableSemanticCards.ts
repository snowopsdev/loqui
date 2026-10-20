import type { TFunction } from "i18next";
import type { TableCardModel } from "./tableModel";
import type { TableMeasurements } from "./tableMeasurements";
import { tableCardContent } from "./tableCardContent";

// One owner of semantic card children; React owns the surrounding canvas.
// User strings enter textContent/attributes only, never parsed HTML.
export function createTableSemanticCards(
  observe: TableMeasurements["observe"],
  register: (key: string, node: HTMLDivElement | null, overflow: (fixed?: boolean) => void) => void,
  measure: (key: string, height: number) => void
) {
  type Entry = {
    node: HTMLDivElement;
    content: HTMLDivElement;
    body: HTMLDivElement;
    overflow: (fixed?: boolean) => void;
    stop: () => void;
    entity?: TableCardModel["entity"];
    expanded?: boolean;
    t?: TFunction;
    fixed: boolean;
  };
  const entries = new Map<string, Entry>();
  const overflowEntries = new Map<(fixed?: boolean) => void, Entry>();
  const prepareOverflow = (overflow: (fixed?: boolean) => void, fixed?: boolean) => {
    const entry = overflowEntries.get(overflow);
    if (!entry) return () => overflow(fixed);
    if (fixed !== undefined) entry.fixed = fixed;
    const overflowing = entry.fixed && entry.content.scrollHeight > entry.content.clientHeight;
    return () => {
      if (overflowEntries.get(overflow) !== entry) return;
      if (overflowing) entry.content.setAttribute("data-overflowing", "true");
      else entry.content.removeAttribute("data-overflowing");
    };
  };
  const drop = (key: string, entry: Entry) => {
    entry.node.style.visibility = "hidden";
    entry.node.setAttribute("aria-hidden", "true");
    entry.node.setAttribute("tabindex", "-1");
    entry.stop();
    register(key, null, entry.overflow);
    entry.node.parentNode?.removeChild(entry.node);
    entries.delete(key);
    overflowEntries.delete(entry.overflow);
  };
  return {
    prepareOverflow,
    reconcile(
      container: HTMLDivElement,
      cards: TableCardModel[],
      retained: Set<string>,
      expanded: string | null,
      t: TFunction,
      icons: ReadonlyMap<string, SVGSVGElement>
    ) {
      const overflowUpdates = new Map<(fixed?: boolean) => void, boolean>();
      const present = new Set(cards.map((card) => card.key));
      for (const key of retained) if (!present.has(key)) retained.delete(key);
      for (const [key, entry] of entries) if (!present.has(key)) drop(key, entry);
      const doc = container.ownerDocument;
      const element = <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        className: string,
        text?: string
      ) => {
        const node = doc.createElement(tag);
        node.setAttribute("class", className);
        if (text !== undefined) node.textContent = text;
        return node;
      };
      for (const card of cards) {
        if (!retained.has(card.key)) continue;
        let entry = entries.get(card.key);
        if (!entry) {
          const node = element("div", "table-card"),
            content = element("div", "table-card__content"),
            body = element("div", "table-card__body");
          content.appendChild(body);
          node.appendChild(content);
          const handle = element("span", "table-card__resize");
          handle.setAttribute("data-resize-handle", "");
          handle.setAttribute("aria-hidden", "true");
          node.appendChild(handle);
          node.setAttribute("role", "option");
          node.setAttribute("data-card-key", card.key);
          node.setAttribute("data-kind", card.entity.kind);
          node.style.left = `${card.rect.x}px`;
          node.style.top = `${card.rect.y}px`;
          node.style.width = `${card.rect.w}px`;
          node.style.zIndex = String(card.z);
          if (card.fixedH != null) {
            node.style.height = `${card.fixedH}px`;
            node.style.overflow = "hidden";
            node.setAttribute("data-sized", "true");
          }
          const created: Entry = {
            node,
            content,
            body,
            fixed: card.fixedH != null,
            stop: () => {},
            overflow: (fixed) => prepareOverflow(created.overflow, fixed)(),
          };
          overflowEntries.set(created.overflow, created);
          let active = true;
          const stop = observe(node, body, () => {
            if (active) {
              measure(card.key, node.offsetHeight);
              return prepareOverflow(created.overflow);
            }
          });
          created.stop = () => {
            active = false;
            stop();
          };
          entry = created;
          entries.set(card.key, entry);
          register(card.key, node, entry.overflow);
        }
        const isExpanded = expanded === card.key;
        if (entry.entity !== card.entity || entry.expanded !== isExpanded || entry.t !== t) {
          const entity = card.entity;
          const { kindLabel, title, excerpt, label, duration, participants } = tableCardContent(
            card,
            isExpanded,
            t
          );
          entry.body.textContent = "";
          const kindNode = element("div", "table-card__kind");
          // Clone the app's mounted glyph, retaining its exact accessible SVG
          // attributes without a per-card React tree or SVG-use shadow tree.
          const svg = icons.get(entity.kind)!.cloneNode(true);
          kindNode.appendChild(svg);
          kindNode.appendChild(element("span", "", kindLabel));
          entry.body.appendChild(kindNode);
          if (title) entry.body.appendChild(element("h3", "table-card__title", title));
          if (excerpt) entry.body.appendChild(element("p", "table-card__excerpt", excerpt));
          if (entity.durationMs != null || entity.participants.length) {
            const meta = element("div", "table-card__meta");
            if (entity.participants.length) {
              const people = element("span", "table-card__people");
              people.setAttribute("aria-hidden", "true");
              for (const name of participants)
                people.appendChild(element("span", "table-card__avatar", name));
              meta.appendChild(people);
            }
            if (entity.durationMs != null) meta.appendChild(element("span", "", duration ?? ""));
            entry.body.appendChild(meta);
          }
          entry.node.setAttribute("aria-label", label);
          entry.node.setAttribute("data-kind", entity.kind);
          entry.entity = entity;
          entry.expanded = isExpanded;
          entry.t = t;
          overflowUpdates.set(entry.overflow, card.fixedH != null);
        }
      }
      let next: HTMLDivElement | null = null;
      for (let i = cards.length - 1; i >= 0; i--) {
        const entry = entries.get(cards[i].key);
        if (!entry) continue;
        if (entry.node.parentNode !== container || entry.node.nextSibling !== next)
          container.insertBefore(entry.node, next);
        next = entry.node;
      }
      return overflowUpdates;
    },
    dispose() {
      for (const [key, entry] of entries) drop(key, entry);
    },
  };
}
