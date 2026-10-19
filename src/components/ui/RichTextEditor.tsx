import { useEffect, useRef, useCallback, type MutableRefObject } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { cn } from "../lib/utils";
import { createMentionExtension } from "./RichTextEditorMention";
import { useTranslation } from "react-i18next";
import type { ActionItem } from "../../types/electron";
import { exitSuggestion } from "@tiptap/suggestion";
import { createSlashCommand, SLASH_PLUGIN_KEY } from "./editor/SlashCommand";
import { slashItemsFromProp } from "./editor/slashItems";
import type { MentionPerson } from "../../utils/mentionMarkdown";

export interface RichTextEditorProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  editorRef?: MutableRefObject<Editor | null>;
  /** Enables @mention tagging with these people as suggestions. */
  mentionPeople?: MentionPerson[];
  /** Enables / at mount; current callbacks and route readiness are read through refs. */
  slash?: {
    actions: ActionItem[];
    aiAvailable: boolean;
    aiUnavailableReason?: string;
    aiNeedsSetup: boolean;
    onRunAction(actionId: number): void;
    onManageActions(): void;
    onSetupAi(): void;
    onDictateHere(): void;
  };
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  editorRef,
  mentionPeople,
  slash,
}: RichTextEditorProps) {
  const { t, i18n } = useTranslation();
  const internalValueRef = useRef(value);
  const suppressUpdateRef = useRef(false);

  // Mention support is decided at mount; the ref keeps suggestions current
  // without rebuilding the editor when the people list changes.
  const mentionPeopleRef = useRef(mentionPeople);
  useEffect(() => {
    mentionPeopleRef.current = mentionPeople;
  }, [mentionPeople]);
  const withMentions = useRef(mentionPeople != null).current;

  const slashRef = useRef(slash);
  slashRef.current = slash;
  const translationRef = useRef({ t, i18n });
  translationRef.current = { t, i18n };
  const withSlash = useRef(slash != null && !disabled).current;
  // Compare values, not callback/array identities: saves and unrelated renders
  // must not dismiss the menu. Include action edits and translated item labels.
  const slashContextKey = JSON.stringify([
    slash,
    slash ? slashItemsFromProp(slash, t) : null,
    i18n.language,
  ]);

  const editor = useEditor({
    extensions: [
      ...(withSlash
        ? [
            createSlashCommand(() => {
              const current = slashRef.current;
              const { t, i18n } = translationRef.current;
              return {
                items: current ? slashItemsFromProp(current, t) : [],
                onSetupAi: () => current?.onSetupAi(),
                onRunAction: (id) => current?.onRunAction(id),
                onManageActions: () => current?.onManageActions(),
                onDictateHere: () => current?.onDictateHere(),
                formatTimestamp: (date) =>
                  date.toLocaleString(i18n.language, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  }),
              };
            }),
          ]
        : []),
      ...(withMentions ? [createMentionExtension(() => mentionPeopleRef.current ?? [])] : []),
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: placeholder || "",
        emptyEditorClass: "is-editor-empty",
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      if (suppressUpdateRef.current) return;

      const md = (ed.storage as any).markdown.getMarkdown() as string;
      internalValueRef.current = md;
      onChange?.(md);
    },
    editorProps: {
      attributes: {
        class: "rich-text-editor-content focus-visible:ring-2 focus-visible:ring-ring",
        dir: "auto",
      },
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed || !withSlash) return;
    // Suggestion skips unchanged queries. Explicit exit cancels pending items
    // and runs popup cleanup while retaining the document, selection and owner.
    if (SLASH_PLUGIN_KEY.getState(editor.state)?.active) {
      exitSuggestion(editor.view, SLASH_PLUGIN_KEY);
    }
  }, [editor, withSlash, slashContextKey]);

  useEffect(() => {
    if (editorRef) editorRef.current = editor;
    return () => {
      if (editorRef) editorRef.current = null;
    };
  }, [editor, editorRef]);

  // Sync external value changes (e.g. dictation, programmatic updates)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value === internalValueRef.current) return;

    internalValueRef.current = value;
    suppressUpdateRef.current = true;

    const { from, to } = editor.state.selection;
    editor.commands.setContent(value);

    // Restore cursor position within bounds
    const docSize = editor.state.doc.content.size;
    const safeFrom = Math.min(from, docSize);
    const safeTo = Math.min(to, docSize);
    editor.commands.setTextSelection({ from: safeFrom, to: safeTo });

    suppressUpdateRef.current = false;
  }, [value, editor]);

  // Sync editable state
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.setEditable(!disabled, false);
    }
  }, [disabled, editor]);

  const handleClick = useCallback(() => {
    if (editor && !editor.isFocused && !disabled) {
      editor.commands.focus();
    }
  }, [editor, disabled]);

  return (
    <div className={cn("relative w-full h-full", className)} onClick={handleClick}>
      <EditorContent
        editor={editor}
        className={cn(
          "h-full overflow-y-auto",
          disabled && "pointer-events-none opacity-70",
          // Reserved by an ancestor via --floating-inset; 0 elsewhere.
          "pb-[var(--floating-inset,0px)]"
        )}
      />
    </div>
  );
}
