import Mention from "@tiptap/extension-mention";
import { ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { createSuggestionPopup } from "./editor/suggestionPopup";
import MentionChip from "./MentionChip";
import MentionSuggestions, {
  type MentionSuggestionItem,
  type MentionSuggestionsProps,
} from "./MentionSuggestions";
import {
  buildEntityMentionMarkdown,
  mentionHref,
  parseMentionHref,
  type MentionPerson,
} from "../../utils/mentionMarkdown";

const SUGGESTION_WIDTH = 240;

const suggestionRender = createSuggestionPopup<MentionSuggestionItem, MentionSuggestionsProps>(
  MentionSuggestions,
  {
    width: SUGGESTION_WIDTH,
    toProps: (props) => ({ items: props.items, command: props.command }),
  }
);

const toSuggestionItems = (people: MentionPerson[], query: string): MentionSuggestionItem[] => {
  const q = query.toLowerCase();
  return people
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q))
    .slice(0, 6)
    .map((p) => ({ id: p.email ?? p.name, label: p.name, email: p.email }));
};

/**
 * Mention extension that round-trips through tiptap-markdown as a
 * `[@Name](mention:email)` link — see buildMentionMarkdown. `getPeople` is
 * read lazily so suggestions always reflect the latest known people without
 * rebuilding the editor.
 */
export function createMentionExtension(getPeople: () => MentionPerson[]) {
  return Mention.extend({
    addAttributes() {
      return {
        label: { default: "" },
        email: { default: null },
        kind: { default: "person" },
        entityId: { default: null },
      };
    },
    parseHTML() {
      return ["mention:", "note:", "meeting:", "dictation:", "folder:"].map((prefix) => ({
        tag: `a[href^="${prefix}"]`,
        priority: 100,
        getAttrs: (element: HTMLElement) => {
          const parsed = parseMentionHref(element.getAttribute("href"));
          if (!parsed) return false;
          const label = (element.textContent ?? "").replace(/^@/, "");
          return { label, email: parsed.email, kind: parsed.kind, entityId: parsed.entityId };
        },
      }));
    },
    renderHTML({ node }) {
      const { label, email, kind, entityId } = node.attrs;
      return [
        "a",
        {
          href: mentionHref({ kind, label, email, entityId }),
          "data-mention": "",
          "data-mention-kind": kind,
        },
        `@${label}`,
      ];
    },
    renderText({ node }) {
      return `@${node.attrs.label}`;
    },
    addNodeView() {
      return ReactNodeViewRenderer(MentionChip);
    },
    addStorage() {
      return {
        markdown: {
          serialize(state: { write: (content: string) => void }, node: NodeViewProps["node"]) {
            state.write(
              buildEntityMentionMarkdown({
                kind: node.attrs.kind,
                label: node.attrs.label,
                entityId: node.attrs.entityId,
                email: node.attrs.email,
              })
            );
          },
          parse: {},
        },
      };
    },
  }).configure({
    suggestion: {
      items: ({ query }) => toSuggestionItems(getPeople(), query),
      command: ({ editor, range, props }) => {
        const item = props as MentionSuggestionItem;
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: "mention", attrs: { label: item.label, email: item.email } },
            { type: "text", text: " " },
          ])
          .run();
      },
      render: suggestionRender,
    },
  });
}
