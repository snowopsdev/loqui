import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, CornerDownLeft, Pencil, Plus, Sparkles, Upload, X } from "./icons";
import { DictionaryHeaderActions } from "./DictionaryHeaderActions";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { PAGE_CONTENT_WIDTH_CLASS } from "./ui/pageWidth";
import { cn } from "./lib/utils";
import { ConfirmDialog } from "./ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { notify } from "./ui/notices";
import SnippetsView from "./SnippetsView";
import { useSettings } from "../hooks/useSettings";
import { getAgentName } from "../utils/agentName";
import { parseDictionaryImportText } from "../helpers/dictionaryImport";
import { getDictionaryHintWords } from "../utils/snippets";
import { WHISPER_DECODER_PROMPT_CHARS } from "../utils/dictionaryPromptCap";

export default function DictionaryView() {
  const { t } = useTranslation();
  const {
    customDictionary,
    updateCustomDictionary,
    snippets,
    autoLearnCorrections,
    setAutoLearnCorrections,
  } = useSettings();
  const agentName = getAgentName();

  const [newWord, setNewWord] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editingWord, setEditingWord] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  const pendingImportCount = useMemo(() => parseDictionaryImportText(bulkText).length, [bulkText]);

  // Length of the prompt string the STT request builds (words + snippet
  // triggers, comma-joined), so the warning fires on real request size. A
  // Chinese script bias adds ~21 chars on top for zh-CN / zh-TW users.
  const promptChars = useMemo(
    () => getDictionaryHintWords({ customDictionary, snippets }).join(", ").length,
    [customDictionary, snippets]
  );

  // Same membership rule as agentNameDictionaryChanges: a stored spelling that
  // differs only by case is still the agent name's entry, so keep it hidden.
  const userWords = useMemo(() => {
    const agentWord = agentName.trim().toLowerCase();
    return customDictionary.filter((w) => w.trim().toLowerCase() !== agentWord);
  }, [customDictionary, agentName]);

  const searchQuery = newWord.trim().toLowerCase();
  const visibleWords = useMemo(
    () =>
      searchQuery ? userWords.filter((w) => w.toLowerCase().includes(searchQuery)) : userWords,
    [userWords, searchQuery]
  );

  const addWords = useCallback(
    (text: string): number => {
      const existing = new Set(customDictionary.map((w) => w.toLowerCase()));
      const words = parseDictionaryImportText(text).filter((w) => {
        if (existing.has(w.toLowerCase())) return false;
        existing.add(w.toLowerCase());
        return true;
      });
      if (words.length > 0) {
        updateCustomDictionary({ add: words });
      }
      return words.length;
    },
    [customDictionary, updateCustomDictionary]
  );

  const handleAdd = useCallback(() => {
    if (addWords(newWord) > 0) setNewWord("");
  }, [addWords, newWord]);

  const handleImport = useCallback(() => {
    addWords(bulkText);
    setBulkText("");
    setShowBulkImport(false);
  }, [addWords, bulkText]);

  const handleRemove = useCallback(
    (word: string) => {
      updateCustomDictionary({ remove: [word] });
    },
    [updateCustomDictionary]
  );

  const startEdit = useCallback((word: string) => {
    setEditingWord(word);
    setEditValue(word);
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingWord) return;
    const trimmed = editValue.trim();
    const isDuplicate = customDictionary.some(
      (w) => w !== editingWord && w.toLowerCase() === trimmed.toLowerCase()
    );
    if (trimmed && trimmed !== editingWord && !isDuplicate) {
      updateCustomDictionary({ add: [trimmed], remove: [editingWord] });
    }
    setEditingWord(null);
  }, [editingWord, editValue, customDictionary, updateCustomDictionary]);

  const handleExport = useCallback(async () => {
    const result = await window.electronAPI?.exportDictionary?.(customDictionary);
    if (result?.error) {
      notify({ kind: "alert", title: t("dictionary.exportFailed"), body: result.error });
    }
  }, [customDictionary, t]);

  const emptyState = (
    <div className="flex flex-col items-center text-center py-8">
      <div className="w-10 h-10 rounded-[10px] bg-foreground/5 border border-border flex items-center justify-center mb-3.5">
        <BookOpen size={17} strokeWidth={1.5} className="text-link dark:text-link" />
      </div>
      <h4 className="text-xs font-semibold text-foreground mb-1">{t("dictionary.emptyTitle")}</h4>
      <p className="text-caption text-muted-foreground leading-relaxed max-w-[240px] mb-4">
        {t("dictionary.emptyDescription", { agentName })}
      </p>
      <Button variant="secondary" size="sm" onClick={() => addInputRef.current?.focus()}>
        <Plus size={12} />
        {t("dictionary.addFirstWord")}
      </Button>
      <button
        onClick={() => setShowBulkImport(true)}
        className="focus-visible:ring-2 focus-visible:ring-ring mt-3 flex items-center gap-1.5 text-caption text-muted-foreground hover:text-muted-foreground transition-colors"
      >
        <Upload size={11} />
        {t("dictionary.importList")}
      </button>
    </div>
  );

  return (
    <Tabs defaultValue="dictionary" className="flex flex-col h-full">
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t("dictionary.clearTitle")}
        description={t("dictionary.clearDescription")}
        onConfirm={() => updateCustomDictionary({ remove: userWords })}
        variant="destructive"
      />

      <div className={cn(PAGE_CONTENT_WIDTH_CLASS, "px-6 pt-4")}>
        <TabsList className="h-7 p-0.5 rounded-[7px]">
          <TabsTrigger value="dictionary" className="h-6 px-2.5 text-xs rounded-[5px]">
            {t("dictionary.tabDictionary")}
          </TabsTrigger>
          <TabsTrigger value="snippets" className="h-6 px-2.5 text-xs rounded-[5px]">
            {t("dictionary.tabSnippets")}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="dictionary" className="flex-1 min-h-0 mt-0 overflow-y-auto">
        <div className={cn(PAGE_CONTENT_WIDTH_CLASS, "px-6 py-4 flex flex-col gap-3")}>
          {/* ─── Add word ─── */}
          <div>
            <div className="flex min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring">
              <Input
                dir="auto"
                ref={addInputRef}
                placeholder={t("dictionary.addPlaceholder")}
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                className="focus-visible:ring-2 focus-visible:ring-ring min-w-0 flex-1 h-8 border-0 px-0 shadow-none text-caption placeholder:text-muted-foreground disabled:opacity-100"
              />
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={handleAdd}
                  disabled={!newWord.trim()}
                  aria-label={t("dictionary.addWord")}
                  className="focus-visible:ring-2 focus-visible:ring-ring flex items-center gap-1 text-caption text-muted-foreground enabled:hover:text-link disabled:text-muted-foreground transition-colors"
                >
                  {t("dictionary.add")}
                  <CornerDownLeft size={10} />
                </button>
                <div className="w-px h-3.5 bg-foreground/10 dark:bg-white/8" />
                <button
                  onClick={() => setShowBulkImport(true)}
                  type="button"
                  title={t("dictionary.importWords")}
                  aria-label={t("dictionary.importWords")}
                  className="focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground hover:text-muted-foreground transition-colors"
                >
                  <Upload size={11} />
                </button>
              </div>
            </div>
          </div>

          {/* ─── Bulk import ─── */}
          {showBulkImport && (
            <div className="rounded-md border border-primary/30 dark:border-primary/40 px-3 pt-2.5 pb-2">
              <Textarea
                dir="auto"
                autoFocus
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={t("dictionary.importPlaceholder")}
                rows={4}
                className="focus-visible:ring-2 focus-visible:ring-ring min-h-[72px] resize-none border-0 shadow-none rounded-none bg-transparent p-0 text-caption text-foreground placeholder:text-muted-foreground disabled:opacity-100 hover:border-0 focus:border-0"
              />
              <div className="flex items-center justify-between pt-1.5">
                <p className="text-caption text-muted-foreground">
                  {t("dictionary.separateWithCommas")}
                  {pendingImportCount > 0 && (
                    <span className="text-foreground">
                      {" • "}
                      {t("dictionary.wordsReady", { count: pendingImportCount })}
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBulkText("");
                      setShowBulkImport(false);
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button size="sm" onClick={handleImport} disabled={pendingImportCount === 0}>
                    {t("dictionary.import")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Agent name (always recognized) ─── */}
          <div className="rounded-md border border-border dark:border-border bg-foreground/5 dark:bg-foreground/5 px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles size={11} className="text-ai shrink-0" />
              <span dir="auto" className="text-caption font-medium text-ai-text truncate">
                {agentName}
              </span>
            </div>
            <span className="text-caption text-muted-foreground shrink-0">
              {t("dictionary.agentDefault")}
            </span>
          </div>

          {/* ─── Dictionary list ─── */}
          <div className="rounded-md border border-foreground/8 dark:border-white/10 bg-foreground/[0.02] dark:bg-white/[0.03] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-muted-foreground">
                {t("dictionary.yourDictionary")}
              </h3>
              <DictionaryHeaderActions
                onClearAll={() => setConfirmClear(true)}
                onExport={handleExport}
                onImport={() => setShowBulkImport(true)}
                autoLearn={autoLearnCorrections}
                onAutoLearnChange={setAutoLearnCorrections}
              />
            </div>
            <div className="mt-2.5 border-t border-dashed border-foreground/10 dark:border-white/10" />

            {userWords.length === 0 ? (
              emptyState
            ) : visibleWords.length === 0 ? (
              <p className="py-6 text-caption text-muted-foreground text-center">
                {t("dictionary.noMatches", { word: newWord.trim() })}
              </p>
            ) : (
              <ul>
                {visibleWords.map((word) => {
                  const isEditing = editingWord === word;
                  return (
                    <li
                      key={word}
                      className="group flex items-center gap-2 h-9 border-b border-foreground/4 dark:border-white/10 last:border-b-0"
                    >
                      {isEditing ? (
                        <Input
                          dir="auto"
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditingWord(null);
                          }}
                          onBlur={commitEdit}
                          className="focus-visible:ring-2 focus-visible:ring-ring h-7 text-caption flex-1"
                        />
                      ) : (
                        <span
                          dir="auto"
                          className="flex-1 text-caption truncate text-muted-foreground"
                        >
                          {word}
                        </span>
                      )}
                      {!isEditing && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                          <button
                            onClick={() => startEdit(word)}
                            aria-label={t("dictionary.editWord", { word })}
                            className="focus-visible:ring-2 focus-visible:ring-ring p-1 text-muted-foreground hover:text-muted-foreground transition-colors"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            onClick={() => handleRemove(word)}
                            aria-label={t("dictionary.removeWord", { word })}
                            className="focus-visible:ring-2 focus-visible:ring-ring p-1 text-muted-foreground hover:text-destructive/70 transition-colors"
                          >
                            <X size={11} strokeWidth={2} />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* ─── Provider prompt-limit notice ─── */}
          {promptChars > WHISPER_DECODER_PROMPT_CHARS && (
            <p className="text-caption text-muted-foreground leading-relaxed">
              {t("dictionary.promptLimitNotice", { chars: promptChars })}
            </p>
          )}
        </div>
      </TabsContent>

      <TabsContent value="snippets" className="flex-1 min-h-0 mt-0 overflow-y-auto">
        <SnippetsView />
      </TabsContent>
    </Tabs>
  );
}
