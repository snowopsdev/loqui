import { mergeAttributes } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import { ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { createSuggestionPopup } from "./editor/suggestionPopup";
import MentionChip from "./MentionChip";
import MentionSuggestions, {
  type MentionSuggestionItem,
  type MentionSuggestionsProps,
} from "./MentionSuggestions";
import {
  MENTION_HREF_PREFIX,
  buildMentionMarkdown,
  parseMentionEmail,
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
      };
    },
    parseHTML() {
      return [
        {
          tag: `a[href^="${MENTION_HREF_PREFIX}"]`,
          priority: 100,
          getAttrs: (element) => {
            const label = (element.textContent || "").replace(/^@/, "").trim();
            if (!label) return false;
            return { label, email: parseMentionEmail(element.getAttribute("href")) };
          },
        },
      ];
    },
    renderHTML({ node, HTMLAttributes }) {
      const label = node.attrs.label as string;
      const email = node.attrs.email as string | null;
      return [
        "a",
        mergeAttributes(HTMLAttributes, {
          href: `${MENTION_HREF_PREFIX}${encodeURIComponent(email || label)}`,
          "data-mention": "",
        }),
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
              buildMentionMarkdown({
                name: node.attrs.label as string,
                email: node.attrs.email as string | null,
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
