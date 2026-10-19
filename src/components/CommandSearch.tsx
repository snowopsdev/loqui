import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { useUiLocale } from "../hooks/useUiLocale";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search, FileText, Mic, Folder, MessageSquare, ChevronDown, Sparkles } from "./icons";
import { cn } from "./lib/utils";
import { useDismissGuard } from "./ui/useDismissGuard";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import type { NoteItem, FolderItem, SpaceItem, TranscriptionItem } from "../types/electron.js";
import { formatRelativeTime } from "../utils/dateFormatting";
import { defaultFolderDisplayName } from "./notes/shared";

import { useWorkspaceNavigation } from "./workspaceNavigation";
import { WORKSPACE_COMMANDS, type CommandDeps } from "./commandSearch/commands";
import {
  buildPaletteSections,
  resolvePaletteSelection,
  type PaletteRow,
} from "./commandSearch/paletteSections";
import { highlightSegments, type MatchRange } from "../lib/fuzzyMatch";
import { shortcutHint } from "../lib/workspaceShortcuts";
import { showHomeQuery } from "../stores/homeViewStore";
import { useSettingsStore } from "../stores/settingsStore";
import { resolveRoute, routeSnapshotFromSettings } from "../lib/routes";
import { useHotkey } from "../hooks/useHotkey";
import { formatHotkeyLabel, parseHotkeyList } from "../utils/hotkeys";

interface ConversationResult {
  id: number;
  title: string;
  last_message?: string;
  updated_at: string;
}

interface JumpTarget {
  key: string;
  spaceId: number;
  folderId: number | null;
  label: string;
  space: SpaceItem | undefined;
}

export interface CommandSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "all" | "conversations";
  transcriptions?: TranscriptionItem[];
  onNoteSelect?: (noteId: number, folderId: number | null, spaceId?: number) => void;
  onContainerSelect?: (spaceId: number, folderId: number | null) => void;
  onTranscriptSelect?: (transcriptId: number) => void;
  onConversationSelect?: (conversationId: number) => void;
}

export default function CommandSearch({
  open,
  onOpenChange,
  mode = "all",
  transcriptions = [],
  onNoteSelect,
  onContainerSelect,
  onTranscriptSelect,
  onConversationSelect,
}: CommandSearchProps) {
  const { t } = useTranslation();
  const locale = useUiLocale();
  const navigation = useWorkspaceNavigation();
  const setTheme = useSettingsStore((state) => state.setTheme);
  const { hotkey } = useHotkey();
  const platform = window.electronAPI?.getPlatform?.() ?? "linux";
  const deps: CommandDeps = {
    toggleDictation: () => void window.electronAPI?.toggleDictationFromControlPanel?.(),
    toggleTheme: () =>
      setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"),
    speechSettingsPath: () =>
      resolveRoute(routeSnapshotFromSettings(useSettingsStore.getState()), "dictationStt")
        .settingsPath,
  };
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [spaces, setSpaces] = useState<SpaceItem[]>([]);
  const [scopeSpaceId, setScopeSpaceId] = useState<number | null>(null);
  const [paletteChats, setPaletteChats] = useState<ConversationResult[]>([]);
  const [conversations, setConversations] = useState<ConversationResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchVersionRef = useRef(0);
  const isConversationsMode = mode === "conversations";
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevNotes, setPrevNotes] = useState(notes);
  const [prevQuery, setPrevQuery] = useState(query);

  useEffect(() => {
    if (isConversationsMode) return;
    window.electronAPI
      .getFolders()
      .then(setFolders)
      .catch(() => {});
    window.electronAPI
      .getSpaces?.()
      .then((items) => setSpaces(items ?? []))
      .catch(() => {});
  }, [isConversationsMode]);

  if (open && !prevOpen) {
    setPrevOpen(open);
    setQuery("");
    setScopeSpaceId(null);
    setSelectedIndex(0);
  } else if (open !== prevOpen) {
    setPrevOpen(open);
  }

  useEffect(() => {
    if (!open) return;
    if (isConversationsMode) {
      window.electronAPI?.getAgentConversationsWithPreview?.(20, 0, false).then((r) => {
        if (r)
          setConversations(
            r.map((c) => ({
              id: c.id,
              title: c.title || "Untitled",
              last_message: c.last_message,
              updated_at: c.updated_at,
            }))
          );
      });
    }
  }, [open, isConversationsMode]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const version = ++searchVersionRef.current;

    if (isConversationsMode) {
      if (!query.trim()) {
        window.electronAPI?.getAgentConversationsWithPreview?.(20, 0, false).then((r) => {
          if (searchVersionRef.current === version && r) {
            setConversations(
              r.map((c) => ({
                id: c.id,
                title: c.title || "Untitled",
                last_message: c.last_message,
                updated_at: c.updated_at,
              }))
            );
          }
        });
        return;
      }
      searchTimerRef.current = setTimeout(async () => {
        try {
          const r = await window.electronAPI?.semanticSearchConversations?.(query, 20);
          if (searchVersionRef.current === version && r) {
            setConversations(
              r.map((c) => ({
                id: c.id,
                title: c.title || "Untitled",
                last_message: c.last_message,
                updated_at: c.updated_at,
              }))
            );
          }
        } catch {
          /* keep current */
        }
      }, 200);
    }

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [query, isConversationsMode, scopeSpaceId]);

  useEffect(() => {
    if (isConversationsMode || !open) return;
    let current = true;
    const load = () => {
      const notesRequest = query.trim()
        ? window.electronAPI.searchNotes(query, undefined, scopeSpaceId)
        : window.electronAPI.getNotes();
      const chatsRequest = query.trim()
        ? window.electronAPI.semanticSearchConversations?.(query, 4)
        : window.electronAPI.getAgentConversationsWithPreview?.(5, 0, false);
      void notesRequest
        .then((items) => {
          if (current) setNotes(items);
        })
        .catch(() => {
          /* DB failure preserves admitted visible data. */
        });
      void chatsRequest
        ?.then((items) => {
          if (current && items)
            setPaletteChats(
              items.map((c) => ({
                id: c.id,
                title: c.title || t("chat.untitled"),
                updated_at: c.updated_at,
              }))
            );
        })
        .catch(() => {
          /* DB failure preserves admitted visible data. */
        });
    };
    const timer = query.trim() ? setTimeout(load, 200) : undefined;
    if (!query.trim()) load();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, isConversationsMode, query, scopeSpaceId, t]);

  if (notes !== prevNotes || query !== prevQuery) {
    setPrevNotes(notes);
    setPrevQuery(query);
    setSelectedIndex(0);
  }

  const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const spaceMap = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const scopeSpace = scopeSpaceId != null ? spaceMap.get(scopeSpaceId) : undefined;

  // Scoping re-filters the visible list immediately, so the keyboard
  // highlight must restart from the top.
  const selectScope = useCallback((spaceId: number | null) => {
    setScopeSpaceId(spaceId);
    setSelectedIndex(0);
  }, []);

  // The search leg scopes at the DB; this also covers browsed (empty-query)
  // results and stale in-flight results after a scope switch.
  const scopedNotes = useMemo(
    () => (scopeSpaceId == null ? notes : notes.filter((n) => n.space_id === scopeSpaceId)),
    [notes, scopeSpaceId]
  );

  const spaceLabel = useCallback(
    (space: SpaceItem) =>
      space.kind === "private"
        ? t("notes.spaces.personal")
        : `${space.emoji ? `${space.emoji} ` : ""}${space.name}`,
    [t]
  );

  const noteBreadcrumb = useCallback(
    (note: NoteItem) => {
      const space = spaceMap.get(note.space_id);
      const folder = note.folder_id != null ? folderMap.get(note.folder_id) : undefined;
      const folderLabel = folder ? defaultFolderDisplayName(folder, t) : "";
      if (!space) return folderLabel;
      return folder ? `${spaceLabel(space)} / ${folderLabel}` : spaceLabel(space);
    },
    [spaceMap, folderMap, spaceLabel, t]
  );

  // All containers reach the matcher. Literal prefiltering here would hide
  // subsequence hits before paletteSections can rank/cap them.
  const jumpTargets = useMemo<JumpTarget[]>(() => {
    if (isConversationsMode) return [];
    return [
      ...spaces
        .filter((space) => scopeSpaceId == null || space.id === scopeSpaceId)
        .map((space) => ({
          key: `s:${space.id}`,
          spaceId: space.id,
          folderId: null,
          label: spaceLabel(space),
          space,
        })),
      ...folders
        .filter((folder) => scopeSpaceId == null || folder.space_id === scopeSpaceId)
        .map((folder) => ({
          key: `f:${folder.id}`,
          spaceId: folder.space_id,
          folderId: folder.id,
          label: defaultFolderDisplayName(folder, t),
          space: spaceMap.get(folder.space_id),
        })),
    ];
  }, [spaces, folders, spaceMap, spaceLabel, scopeSpaceId, isConversationsMode, t]);

  const sections = useMemo(
    () =>
      isConversationsMode
        ? []
        : buildPaletteSections({
            query,
            commands: WORKSPACE_COMMANDS.map((command) => ({
              command,
              label: t(command.labelKey),
            })),
            notes: scopedNotes,
            transcripts: transcriptions,
            conversations: paletteChats,
            containers: jumpTargets,
          }),
    [isConversationsMode, query, scopedNotes, transcriptions, paletteChats, jumpTargets, t]
  );
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  const rowCount = isConversationsMode ? conversations.length : rows.length;
  const activeIndex = Math.max(0, Math.min(selectedIndex, rowCount - 1));
  // Keep the stored index valid as independently resolved sections grow/shrink.
  if (!isConversationsMode && selectedIndex !== activeIndex) setSelectedIndex(activeIndex);

  const selectRow = (row: PaletteRow) => {
    const selection = resolvePaletteSelection(row, query);
    onOpenChange(false);
    switch (selection.type) {
      case "command":
        return selection.command.run(navigation, deps);
      case "note":
        return onNoteSelect?.(selection.noteId, selection.folderId, selection.spaceId);
      case "transcript":
        return onTranscriptSelect?.(selection.transcriptId);
      case "conversation":
        return onConversationSelect?.(selection.conversationId);
      case "container":
        return onContainerSelect?.(selection.spaceId, selection.folderId);
      case "showAllTranscripts":
        showHomeQuery(selection.query);
        return navigation.openView("home");
      case "askDraft":
        return navigation.startChat({ draft: selection.draft });
    }
  };
  const selectConversation = (conversation: ConversationResult) => {
    onConversationSelect?.(conversation.id);
    onOpenChange(false);
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(0, Math.min(i + 1, rowCount - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isConversationsMode) {
        const item = conversations[selectedIndex];
        if (item) selectConversation(item);
      } else if (rows[activeIndex]) selectRow(rows[activeIndex]);
    } else if (!isConversationsMode && e.key === "Tab" && spaces.length > 1) {
      e.preventDefault();
      const order = [null, ...spaces.map((space) => space.id)];
      const current = order.indexOf(scopeSpaceId);
      selectScope(order[(current + (e.shiftKey ? order.length - 1 : 1)) % order.length]);
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, rows]);

  const hasResults = rowCount > 0;
  const { registerContent, shouldBlockDismiss } = useDismissGuard<HTMLDivElement>();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm duration-(--motion-base) motion-reduce:animate-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          ref={registerContent}
          onInteractOutside={(e) => {
            // The filter dropdown makes this panel inert while it is open, so
            // the click that closes it lands on the overlay — see useDismissGuard.
            if (shouldBlockDismiss(e)) e.preventDefault();
          }}
          className={cn(
            "fixed left-[50%] top-[18%] z-50 w-full max-w-xl translate-x-[-50%]",
            "rounded-xl border border-border/70 bg-card shadow-2xl overflow-hidden",
            "dark:bg-surface-2 dark:border-border dark:shadow-modal",
            isConversationsMode
              ? "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-[44%] data-[state=closed]:slide-out-to-top-[44%] data-[state=open]:slide-in-from-left-1/2 data-[state=closed]:slide-out-to-left-1/2"
              : "animate-in fade-in-0 duration-(--motion-base) motion-reduce:animate-none"
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {t("commandSearch.title")}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t("commandSearch.description")}
          </DialogPrimitive.Description>

          {/* Search input */}
          <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-border/70">
            <Search size={14} className="shrink-0 text-muted-foreground" />
            {!isConversationsMode && spaces.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1 shrink-0 rounded-md border border-border/70 bg-muted/40",
                      "px-1.5 py-0.5 text-ui transition-colors duration-(--motion-fast) outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      scopeSpace ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span className="truncate max-w-32">
                      {scopeSpace ? (
                        <span dir="auto">{spaceLabel(scopeSpace)}</span>
                      ) : (
                        t("commandSearch.allSpaces")
                      )}
                    </span>
                    <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="duration-(--motion-base) motion-reduce:animate-none"
                  align="start"
                  onCloseAutoFocus={(e) => {
                    e.preventDefault();
                    inputRef.current?.focus();
                  }}
                >
                  <DropdownMenuItem
                    className="text-ui duration-(--motion-fast) focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                    onSelect={() => selectScope(null)}
                  >
                    {t("commandSearch.allSpaces")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {spaces.map((space) => (
                    <DropdownMenuItem
                      className="text-ui duration-(--motion-fast) focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                      key={space.id}
                      onSelect={() => selectScope(space.id)}
                    >
                      <span dir="auto">{spaceLabel(space)}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <input
              dir="auto"
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isConversationsMode ? t("chat.search") : t("commandSearch.placeholderAll")
              }
              autoFocus
              className="min-w-0 flex-1 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                padding: 0,
              }}
            />
            {query && (
              <button
                type="button"
                aria-label={t("commandSearch.clear")}
                onClick={() => setQuery("")}
                className="rounded text-ui text-muted-foreground hover:text-foreground transition-colors duration-(--motion-fast) outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                ✕
              </button>
            )}
          </div>

          {/* Results list */}
          <div ref={listRef} className="overflow-y-auto max-h-[340px] p-1.5">
            {!hasResults ? (
              <div className="flex items-center justify-center py-10">
                <p className="text-xs text-muted-foreground/70">
                  {query.trim()
                    ? t("commandSearch.noResults")
                    : isConversationsMode
                      ? t("chat.noConversations")
                      : t("commandSearch.emptyState")}
                </p>
              </div>
            ) : isConversationsMode ? (
              conversations.map((conv, idx) => (
                <button
                  key={conv.id}
                  type="button"
                  data-idx={idx}
                  onClick={() => selectConversation(conv)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    "flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-start transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selectedIndex === idx
                      ? "bg-primary/8 dark:bg-primary/10"
                      : "hover:bg-foreground/4 dark:hover:bg-white/4"
                  )}
                >
                  <MessageSquare
                    size={13}
                    className={cn(
                      "shrink-0 mt-px transition-colors",
                      selectedIndex === idx ? "text-primary" : "text-muted-foreground/70"
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p dir="auto" className="text-xs font-medium text-foreground truncate">
                      {conv.title}
                    </p>
                    {conv.last_message && (
                      <p dir="auto" className="text-[11px] text-muted-foreground/55 truncate mt-px">
                        {conv.last_message.slice(0, 90)}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground/70 tabular-nums shrink-0">
                    {formatRelativeTime(conv.updated_at, t, locale)}
                  </span>
                </button>
              ))
            ) : (
              sections.map((section) => (
                <div key={section.id}>
                  {section.id === "nothing" ? (
                    <p className="px-3 pt-3 text-ui text-muted-foreground">
                      {t("commandSearch.nothingMatches", { query: query.trim() })}
                    </p>
                  ) : (
                    <SectionHeader label={t(`commandSearch.sections.${section.id}`)} />
                  )}
                  {section.rows.map((row) => {
                    const idx = rows.indexOf(row);
                    const title =
                      row.kind === "command"
                        ? row.label
                        : row.kind === "note" || row.kind === "meeting"
                          ? row.note.title || t("notes.list.untitled")
                          : row.kind === "transcript"
                            ? row.transcript.text
                            : row.kind === "conversation"
                              ? row.conversation.title
                              : row.kind === "container"
                                ? row.target.label
                                : row.kind === "seeAllTranscripts"
                                  ? t("commandSearch.seeAllTranscripts", { count: row.total })
                                  : row.kind === "ask"
                                    ? t("commandSearch.askAssistant", { query: row.query })
                                    : "";
                    const Icon =
                      row.kind === "command"
                        ? row.command.icon
                        : row.kind === "transcript" || row.kind === "seeAllTranscripts"
                          ? Mic
                          : row.kind === "conversation"
                            ? MessageSquare
                            : row.kind === "container"
                              ? Folder
                              : row.kind === "ask"
                                ? Sparkles
                                : FileText;
                    const meta =
                      row.kind === "meeting"
                        ? t("commandSearch.meta.meeting")
                        : row.kind === "note"
                          ? noteBreadcrumb(row.note)
                          : row.kind === "conversation"
                            ? t("commandSearch.meta.chat")
                            : row.kind === "transcript"
                              ? formatRelativeTime(row.transcript.created_at, t, locale)
                              : "";
                    const hint =
                      row.kind === "command"
                        ? row.command.shortcut
                          ? shortcutHint(row.command.shortcut, platform)
                          : row.command.usesHotkey
                            ? formatHotkeyLabel(parseHotkeyList(hotkey)[0])
                            : ""
                        : row.kind === "ask"
                          ? "↵"
                          : "";
                    return (
                      <button
                        type="button"
                        key={row.key}
                        data-idx={idx}
                        onClick={() => selectRow(row)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={cn(
                          "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-(--motion-fast) motion-reduce:transition-none",
                          activeIndex === idx
                            ? "bg-muted ring-1 ring-inset ring-muted-foreground"
                            : "hover:bg-muted/60"
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-[18px] shrink-0 items-center justify-center text-muted-foreground",
                            row.kind === "ask" && "text-ai-text"
                          )}
                        >
                          <Icon size={16} />
                        </span>
                        <span className="min-w-0 flex-1 text-ui text-foreground">
                          <Highlighted text={title} ranges={"ranges" in row ? row.ranges : []} />
                          {meta && (
                            <span
                              dir="auto"
                              className="block truncate text-caption text-muted-foreground"
                            >
                              {meta}
                            </span>
                          )}
                        </span>
                        {hint && (
                          <kbd
                            dir="ltr"
                            className="shrink-0 rounded border border-border bg-muted px-1 py-px font-mono text-micro leading-tight text-muted-foreground"
                          >
                            {hint}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2 border-t border-border/70 bg-muted/15">
            <FooterHint keys={["↑", "↓"]} label={t("commandSearch.footer.navigate")} />
            <FooterHint keys={["↵"]} label={t("commandSearch.footer.open")} />
            {!isConversationsMode && spaces.length > 1 && (
              <FooterHint keys={["Tab"]} label={t("commandSearch.footer.scope")} />
            )}
            <FooterHint
              keys={["Esc"]}
              label={t(
                isConversationsMode ? "commandSearch.footer.dismiss" : "commandSearch.footer.close"
              )}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-2.5 pb-1 pt-2 text-caption font-semibold text-muted-foreground">{label}</div>
  );
}

function Highlighted({ text, ranges }: { text: string; ranges: MatchRange[] }) {
  return (
    <span dir="auto" className="block truncate">
      {highlightSegments(text, ranges).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="rounded-sm bg-link/12 font-semibold text-foreground">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        )
      )}
    </span>
  );
}

function FooterHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span dir="ltr" className="inline-flex items-center gap-1">
        {keys.map((k) => (
          <kbd
            key={k}
            className="text-micro px-1 py-px rounded border border-border bg-muted text-muted-foreground font-mono leading-tight"
          >
            {k}
          </kbd>
        ))}
      </span>
      <span className="text-ui text-muted-foreground ms-0.5">{label}</span>
    </div>
  );
}
