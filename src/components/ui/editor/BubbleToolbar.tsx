import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { BubbleMenu } from "@tiptap/react/menus";
import { useEditorState, type Editor } from "@tiptap/react";
import { Bold, Italic, Link2, Sparkles } from "lucide-react";
import { cn } from "../../lib/utils";
import { sanitizeLinkHref } from "../../../lib/linkHref";

import type { ComposerSeed } from "../../chat/chatRequest";

const MAX_DRAFT = 280;

// eslint-disable-next-line react-refresh/only-export-components -- Task 16 publishes this pure helper beside its toolbar.
export function buildAskAiDraft(selection: string): string {
  const quote = selection.replace(/\s+/g, " ").trim();
  if (!quote) return "";
  const clipped = quote.length > MAX_DRAFT - 3 ? `${quote.slice(0, MAX_DRAFT - 4)}…` : quote;
  return `“${clipped}” `;
}

let lastSeedNonce = 0;

type ChatMode = "hidden" | "floating" | "sidebar";

/** Ask AI opens a visible composer: a hidden chat floats in, a docked one
 *  stays. The quote is seeded with resetQueue, never sent (review I05). */
// eslint-disable-next-line react-refresh/only-export-components -- Task 16 publishes this pure transition beside its toolbar.
export function askAiTransition(
  mode: ChatMode,
  selection: string
): { mode: Exclude<ChatMode, "hidden">; seed: ComposerSeed } | null {
  const text = buildAskAiDraft(selection);
  if (!text) return null;
  lastSeedNonce = Math.max(Date.now(), lastSeedNonce + 1);
  return {
    mode: mode === "hidden" ? "floating" : mode,
    seed: { nonce: lastSeedNonce, text, resetQueue: true },
  };
}

export interface BubbleToolbarButtonsProps {
  active: { bold: boolean; italic: boolean; link: boolean };
  onBold(): void;
  onItalic(): void;
  onLink(href: string | null): void;
  onAskAi(): void;
  initialHref?: string;
}

const BUTTON =
  "flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-ui text-foreground hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring";

export function BubbleToolbarButtons({
  active,
  onBold,
  onItalic,
  onLink,
  onAskAi,
  initialHref = "",
}: BubbleToolbarButtonsProps) {
  const { t } = useTranslation();
  const [editingLink, setEditingLink] = useState(false);
  const [href, setHref] = useState(initialHref);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();

  if (editingLink) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (href.trim()) {
            const safe = sanitizeLinkHref(href);
            if (!safe) return setInvalid(true);
            onLink(safe);
          } else {
            onLink(null);
          }
          setEditingLink(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditingLink(false);
        }}
      >
        <input
          autoFocus
          dir="ltr"
          value={href}
          onChange={(e) => {
            setHref(e.target.value);
            setInvalid(false);
          }}
          aria-label={t("notes.bubble.linkUrl")}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          placeholder="https://"
          className="h-6 w-56 rounded-md bg-background px-2 text-caption outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {invalid && (
          <span id={errorId} role="alert" className="text-caption text-destructive">
            {t("notes.bubble.linkInvalid")}
          </span>
        )}
      </form>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        aria-label={t("notes.bubble.bold")}
        aria-pressed={active.bold}
        onClick={onBold}
        className={cn(BUTTON, active.bold && "bg-foreground/8")}
      >
        <Bold size={14} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t("notes.bubble.italic")}
        aria-pressed={active.italic}
        onClick={onItalic}
        className={cn(BUTTON, active.italic && "bg-foreground/8")}
      >
        <Italic size={14} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t("notes.bubble.link")}
        aria-pressed={active.link}
        onClick={() => {
          setHref(initialHref);
          setInvalid(false);
          setEditingLink(true);
        }}
        className={cn(BUTTON, active.link && "bg-foreground/8")}
      >
        <Link2 size={14} aria-hidden />
      </button>
      <span aria-hidden className="mx-1 h-4 w-px bg-border" />
      {/* Fuchsia: this asks a model to write. It opens a draft; it never sends. */}
      <button
        type="button"
        onClick={onAskAi}
        className={cn(BUTTON, "gap-1 font-semibold text-ai-text")}
      >
        <Sparkles size={13} aria-hidden />
        {t("notes.bubble.askAi")}
      </button>
    </div>
  );
}

export function BubbleToolbar({
  editor,
  onAskAi,
}: {
  editor: Editor;
  onAskAi: (selection: string) => void;
}) {
  // Tiptap 3 does not re-render on every transaction; subscribe to exactly
  // the marks the toolbar shows so the pressed states stay current.
  const marks = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 6 }}
      shouldShow={({ editor: e, from, to }) =>
        e.isEditable &&
        from !== to &&
        !e.isActive("codeBlock") &&
        e.state.doc.textBetween(from, to, " ").trim().length > 0
      }
      data-editor-chrome=""
      // Buttons keep the editor selection; the URL field still takes focus normally.
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      className="bubble-toolbar focus-visible:ring-2 focus-visible:ring-ring flex h-8 items-center rounded-lg border border-border bg-popover px-1 shadow-(--shadow-glass) dark:shadow-(--shadow-elevated)"
    >
      <BubbleToolbarButtons
        active={{ bold: marks.bold, italic: marks.italic, link: marks.link }}
        initialHref={marks.href}
        onBold={() => editor.chain().focus().toggleBold().run()}
        onItalic={() => editor.chain().focus().toggleItalic().run()}
        onLink={(href) =>
          href
            ? editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
            : editor.chain().focus().extendMarkRange("link").unsetLink().run()
        }
        onAskAi={() => {
          const { from, to } = editor.state.selection;
          onAskAi(editor.state.doc.textBetween(from, to, " "));
        }}
      />
    </BubbleMenu>
  );
}
