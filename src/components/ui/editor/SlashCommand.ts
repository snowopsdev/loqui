import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { SlashMenu, type SlashMenuProps } from "./SlashMenu";
import { applySlashItem, filterSlashItems, type SlashContext, type SlashItem } from "./slashItems";
import { createSuggestionPopup } from "./suggestionPopup";

export const SLASH_PLUGIN_KEY = new PluginKey("slashCommand");

export function createSlashCommand(getContext: () => SlashContext) {
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          pluginKey: SLASH_PLUGIN_KEY,
          char: "/",
          startOfLine: false,
          // Inert in code blocks and inline code: "/" is literal there.
          allow: ({ state, range }) => {
            const $from = state.doc.resolve(range.from);
            return (
              !$from.parent.type.spec.code &&
              !$from.marks().some((mark) => mark.type.name === "code")
            );
          },
          items: ({ query }) => filterSlashItems(getContext().items, query),
          command: ({ editor, range, props: item }) => {
            // A route/action change can overtake a visible suggestion. Check
            // the latest owner before deleting text or invoking work.
            const context = getContext();
            const current = context.items.find((candidate) => candidate.id === item.id);
            if (!editor.isEditable || !current || current.disabledReason) return;
            applySlashItem(current, editor.chain().focus().deleteRange(range), context);
          },
          render: createSuggestionPopup<SlashItem, SlashMenuProps>(SlashMenu, {
            width: 280,
            toProps: (props) => ({ items: props.items, command: props.command }),
          }),
        }),
      ];
    },
  });
}
