import { useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import PersonAvatar from "./PersonAvatar";
import { MentionMarker } from "./MentionSuggestions";
import { MentionPreview, type MentionPreviewState } from "./MentionHoverCard";
import { useHoverCard } from "./useHoverCard";
import { useMentionHoverPosition } from "./useMentionHoverPosition";
import { useWorkspaceNavigation } from "../workspaceNavigation";
import { getFoldersValue } from "../../stores/noteStore";
import { quoteExcerpt } from "../../lib/mentionSearch";
import { formatRelativeTime } from "../../utils/dateFormatting";
import type { NoteItem, TranscriptionItem } from "../../types/electron";
import type { MentionKind } from "../../utils/mentionMarkdown";

/** A document-owned node view; requests and actions never outlive this target/editor. */
export default function MentionChip({ node, editor, getPos }: NodeViewProps) {
  const { t, i18n } = useTranslation();
  const navigation = useWorkspaceNavigation();
  const {
    label,
    email,
    kind = "person",
    entityId,
  } = node.attrs as {
    label: string;
    email: string | null;
    kind: MentionKind;
    entityId: string | null;
  };
  const chipRef = useRef<HTMLButtonElement>(null);
  const { open, boundary } = useHoverCard(chipRef);
  const cardRef = useRef<HTMLSpanElement>(null);
  useMentionHoverPosition(
    chipRef,
    cardRef,
    open && kind !== "person" && kind !== "folder",
    i18n.language
  );
  const [attempt, setAttempt] = useState(0);
  // Task17 stores exact positive-integer strings. Numeric IPC must never round one.
  const numericId = entityId && /^[1-9]\d*$/.test(entityId) ? Number(entityId) : NaN;
  const id = Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null;
  const owner = useMemo(
    () => ({ editor, kind, entityId, label, open, attempt, t, language: i18n.language }),
    [editor, kind, entityId, label, open, attempt, t, i18n.language]
  );
  const currentOwner = useRef<object | null>(owner);
  currentOwner.current = owner;
  const [loaded, setLoaded] = useState<{ owner: object; state: MentionPreviewState } | null>(null);
  const preview: MentionPreviewState =
    id == null
      ? { status: "error" }
      : loaded?.owner === owner
        ? loaded.state
        : { status: "loading" };

  useEffect(() => {
    currentOwner.current = owner;
    return () => {
      if (currentOwner.current === owner) currentOwner.current = null;
    };
  }, [owner]);

  useEffect(() => {
    if (!open || id == null || kind === "person" || kind === "folder") return;
    let alive = true;
    const accept = (state: MentionPreviewState) => {
      if (alive && currentOwner.current === owner && !editor.isDestroyed)
        setLoaded({ owner, state });
    };
    // Promise boundary also treats synchronous preload failures as unavailable.
    void Promise.resolve()
      .then(async (): Promise<NoteItem | TranscriptionItem | null> =>
        kind === "dictation"
          ? window.electronAPI.getTranscriptionById(id)
          : window.electronAPI.getNote(id)
      )
      .then((item) => {
        if (!item || item.deleted_at) return accept({ status: "missing" });
        const text = "text" in item ? item.text : item.enhanced_content || item.content || "";
        accept({
          status: "ready",
          title: "text" in item ? label : item.title || t("notes.list.untitledNote"),
          meta: formatRelativeTime(item.created_at, t, i18n.language),
          excerpt: quoteExcerpt(text, 240),
        });
      })
      .catch(() => accept({ status: "error" }));
    return () => {
      alive = false;
    };
  }, [open, id, kind, label, owner, editor, t, i18n.language]);

  const ownsNode = () => {
    if (currentOwner.current !== owner || editor.isDestroyed || typeof getPos !== "function")
      return false;
    const pos = getPos();
    return pos != null && editor.state.doc.nodeAt(pos) === node;
  };
  const openTarget = () => {
    if (id == null || !ownsNode()) return;
    if (kind === "note" || kind === "meeting") void navigation.openNote(id);
    else if (kind === "dictation") navigation.openTranscript(id);
    else if (kind === "folder") {
      const folder = getFoldersValue().find((f) => f.id === id && !f.deleted_at);
      if (folder) navigation.openFolder(folder.space_id, folder.id);
    }
  };
  const insertQuote = () => {
    if (
      !open ||
      !ownsNode() ||
      !editor.isEditable ||
      (kind !== "meeting" && kind !== "dictation") ||
      preview.status !== "ready" ||
      !preview.excerpt.trim()
    )
      return;
    const pos = getPos();
    if (pos == null) return;
    // Insert after the containing text block, preserving its prefix and suffix.
    const after = editor.state.doc.resolve(pos).after();
    editor
      .chain()
      .focus()
      .insertContentAt(after, {
        type: "blockquote",
        content: [{ type: "paragraph", content: [{ type: "text", text: preview.excerpt }] }],
      })
      .run();
    chipRef.current?.focus();
  };

  if (kind === "person")
    return (
      <NodeViewWrapper as="span" className="mx-px inline-flex items-baseline align-baseline">
        <span
          data-mention
          data-mention-kind="person"
          title={email ?? undefined}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border/70 bg-foreground/4 px-1 py-px text-[0.85em] font-medium leading-tight text-foreground dark:bg-white/6"
        >
          <PersonAvatar
            email={email}
            displayName={label}
            size={18}
            initialFontSize={11}
            className="text-primary-foreground"
          />
          {label}
        </span>
      </NodeViewWrapper>
    );
  return (
    <NodeViewWrapper as="span" className="mx-px inline-flex items-baseline align-baseline">
      <span
        {...boundary}
        data-editor-chrome=""
        contentEditable={false}
        className="relative inline-flex"
      >
        <button
          ref={chipRef}
          type="button"
          data-mention
          data-mention-kind={kind}
          onClick={openTarget}
          className="inline-flex min-h-5 items-center gap-1 rounded-md bg-foreground/6 px-1.5 text-[0.85em] font-medium text-foreground hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MentionMarker kind={kind} email={email} label={label} />
          {label}
        </button>
        {open && kind !== "folder" && (
          <span
            ref={cardRef}
            data-editor-chrome=""
            data-mention-hover-card=""
            className="fixed z-50 w-60 overflow-y-auto pt-1"
            style={{ visibility: "hidden" }}
          >
            <MentionPreview
              kind={kind}
              state={preview}
              onOpen={openTarget}
              onInsertQuote={editor.isEditable ? insertQuote : undefined}
              onRetry={
                preview.status === "error" && id != null
                  ? () => {
                      if (currentOwner.current === owner && open) setAttempt((n) => n + 1);
                    }
                  : undefined
              }
            />
          </span>
        )}
      </span>
    </NodeViewWrapper>
  );
}
