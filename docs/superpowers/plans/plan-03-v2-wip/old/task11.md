### Task 11: Storage list with counted confirms and a typed reset (SET-R7 A)

Privacy & Data gains one **Storage** list that counts before it deletes:

```
Dictation audio      214 files · 1.2 GB    [Delete…]
Downloaded models    3 models · 9.8 GB     [Open] [Delete…]
Transcript history   1,482 items           [Delete…]
── Danger zone ──
Reset Loqui          Deletes settings, history, audio, models and keys.   [Reset…]
```

Every "Delete…" opens a confirm that repeats the count, the size and the folder (monospace, `dir="ltr"`), and its button repeats the count: "Delete 214 recordings". A partial failure keeps the dialog open with `role="alert"` stating what was and wasn't deleted. Reset requires typing the localized word "reset".

Model-cache clearing and reset move here from System. The old "Clear All Audio" one-click button is removed, which supersedes Plan 02's SET-Q5 confirm with this counted version. Row triggers are outline buttons with destructive text. Solid destructive appears only inside a dialog.

**Files:**
- Create: `src/components/settings/storageMath.ts` (pure)
- Create: `src/components/settings/StorageList.tsx`
- Modify: `src/helpers/audioStorage.js:189-205`. Return `directory: this.audioDir` as well.
- Modify: `src/helpers/database.js`. Add `countTranscriptions()` next to `clearTranscriptions` (`:551`).
- Modify: `src/helpers/ipcHandlers.js`. Add `db-count-transcriptions` next to `db-clear-transcriptions` (`:1287`).
- Modify: `preload.js`. Add `countTranscriptions` next to `clearTranscriptions` (`:180`).
- Modify: `src/types/electron.ts`. Change `getAudioStorageUsage` (`:857`) to return `{ fileCount; totalBytes; directory?: string }`, and add `countTranscriptions?: () => Promise<number>`.
- Modify: `src/components/SettingsPage.tsx`:
  - in `privacyData`, replace the storage-usage and Clear All Audio block (inside `:2763-2830`; keep the audio-retention select) with `<StorageList />` after the transcript-retention block (`:2866`);
  - delete `handleClearAllAudio` (`:1145-1155`);
  - move the body of `handleRemoveModels` (`:1448-1494`) into `StorageList`;
  - delete the System "Data management" block (`:2975-3069`: model cache Open/Clear and Reset);
  - remove now-unused state such as `audioStorageUsage` and `isRemovingModels`.
- Modify: `src/locales/*/translation.json`
- Test: `test/components/storageMath.test.js`, `test/components/storageList.test.js`, `test/helpers/transcriptionCount.test.js`

**Interfaces:**
- Consumes:
  - `getAudioStorageUsage`, `deleteAllAudio() → { deleted }`, `listWhisperModels`, `listParakeetModels` and `modelGetAll`;
  - `deleteAllWhisperModels`, `deleteAllParakeetModels` and `modelDeleteAll`;
  - `openWhisperModelsFolder`, `getModelCacheRoot`;
  - `clearTranscriptions() → { cleared, success }`, `cleanupApp()` and `relaunchApp()`;
  - `clearMissingLocalModelSelections` (`settingsStore.ts:2714`);
  - `refreshRouteFacts` (Task 2);
  - `formatDecimalBytes` (Task 3);
  - `Dialog*` and `ConfirmDialog` from `src/components/ui/dialog.tsx` (`ConfirmDialogProps` at `:108-121`, including `children` and `confirmDisabled`).
- Produces:

  ```ts
  // storageMath.ts
  export interface ModelLists {
    whisper?: { models?: { downloaded: boolean; size_bytes?: number; size_mb?: number }[] };
    parakeet?: { models?: { downloaded: boolean; size_bytes?: number; size_mb?: number }[] };
    llm?: { isDownloaded?: boolean; sizeBytes?: number; downloadedSize?: number }[];
  }
  export function summarizeModels(lists: ModelLists): { count: number; bytes: number };
  export function deletionOutcome(before: number, after: number): { deleted: number; left: number };
  export function resetConfirmed(typed: string, word: string): boolean;
  // StorageList.tsx
  export interface StorageRowState { count: number | null; bytes: number | null; directory: string | null }
  export interface CountedDeleteProps { kind: "audio" | "models" | "history"; row: StorageRowState; phase: "idle" | "deleting" | "partial"; outcome?: { deleted: number; left: number }; onConfirm(): void; onCancel(): void }
  export function CountedDeleteContent(props: CountedDeleteProps & { Title?: React.ElementType; Description?: React.ElementType }): JSX.Element; // SSR-testable body
  export function CountedDeleteDialog(props: CountedDeleteProps & { open: boolean; onOpenChange(open: boolean): void }): JSX.Element;
  export function StorageListView(props: { audio: StorageRowState; models: StorageRowState; history: StorageRowState; onDelete(kind): void; onOpenModels(): void; onReset(): void }): JSX.Element;
  export function StorageList(): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/components/storageMath.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/settings/storageMath.ts");

test("model storage counts only downloaded files across all three model families", async () => {
  const { summarizeModels } = await load();
  assert.deepEqual(
    summarizeModels({
      whisper: { models: [{ downloaded: true, size_mb: 142 }, { downloaded: false, size_mb: 466 }] },
      parakeet: { models: [{ downloaded: true, size_bytes: 680000000 }, { downloaded: true, size_mb: 100 }] },
      llm: [{ isDownloaded: true, sizeBytes: 1329766560 }, { isDownloaded: false, sizeBytes: 5 }, { isDownloaded: true, downloadedSize: 10 }],
    }),
    { count: 5, bytes: 142000000 + 680000000 + 100000000 + 1329766560 + 10 }
  );
  assert.deepEqual(summarizeModels({}), { count: 0, bytes: 0 });
});

test("a delete reports what was and was not deleted", async () => {
  const { deletionOutcome } = await load();
  assert.deepEqual(deletionOutcome(214, 0), { deleted: 214, left: 0 });
  assert.deepEqual(deletionOutcome(214, 3), { deleted: 211, left: 3 });
  assert.deepEqual(deletionOutcome(2, 5), { deleted: 0, left: 5 }, "never negative");
});

test("reset needs the word typed, case and spacing forgiven", async () => {
  const { resetConfirmed } = await load();
  assert.equal(resetConfirmed(" Reset ", "reset"), true);
  assert.equal(resetConfirmed("res", "reset"), false);
  assert.equal(resetConfirmed("", "reset"), false);
});
```

Create `test/components/storageList.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const { withI18nMock } = require("../lib/i18nTestMock");

test("storage list", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-storage-list-test-" }, { withOptions: true }));
  const s = await vite.ssrLoadModule("/components/settings/StorageList.tsx");
  const audio = { count: 214, bytes: 1_200_000_000, directory: "/Users/x/Library/Application Support/loqui/audio" };
  const models = { count: 3, bytes: 9_800_000_000, directory: "/Users/x/.cache/loqui" };
  const history = { count: 1482, bytes: null, directory: null };

  await t.test("rows show counts and sizes; triggers are outline, never solid red", () => {
    const html = renderToStaticMarkup(React.createElement(s.StorageListView, { audio, models, history, onDelete() {}, onOpenModels() {}, onReset() {} }));
    assert.match(html, /storage\.audio\.summary\{&quot;count&quot;:214,&quot;size&quot;:&quot;1\.2 GB&quot;\}/);
    assert.match(html, /storage\.models\.summary\{&quot;count&quot;:3,&quot;size&quot;:&quot;9\.8 GB&quot;\}/);
    assert.match(html, /storage\.history\.summary\{&quot;count&quot;:1482\}/);
    assert.doesNotMatch(html, /data-variant="destructive"/);
    assert.match(html, /storage\.danger/);
  });

  await t.test("empty rows say so and disable delete", () => {
    const html = renderToStaticMarkup(React.createElement(s.StorageListView, {
      audio: { count: 0, bytes: 0, directory: null }, models, history, onDelete() {}, onOpenModels() {}, onReset() {},
    }));
    assert.match(html, /storage\.audio\.empty/);
    assert.match(html, /data-storage-delete="audio"[^>]*disabled=""/);
  });

  await t.test("the confirm repeats count, size and folder, and the button repeats the count", () => {
    // Radix portals render nothing on the server, so test the dialog body directly.
    const html = renderToStaticMarkup(React.createElement(s.CountedDeleteContent, {
      kind: "audio", row: audio, phase: "idle", onConfirm() {}, onCancel() {},
    }));
    assert.match(html, /storage\.audio\.confirmTitle\{&quot;count&quot;:214\}/);
    assert.match(html, /storage\.audio\.confirmBody\{&quot;count&quot;:214,&quot;size&quot;:&quot;1\.2 GB&quot;\}/);
    assert.match(html, /<code dir="ltr"[^>]*>\/Users\/x\/Library\/Application Support\/loqui\/audio<\/code>/);
    assert.match(html, /storage\.audio\.confirmButton\{&quot;count&quot;:214\}/);
    assert.match(html, /data-variant="destructive"/);
  });

  await t.test("partial failure keeps the dialog open with an alert", () => {
    const html = renderToStaticMarkup(React.createElement(s.CountedDeleteContent, {
      kind: "models", row: models, phase: "partial", outcome: { deleted: 2, left: 1 }, onConfirm() {}, onCancel() {},
    }));
    assert.match(html, /role="alert"[^>]*>[^<]*storage\.partial\{&quot;left&quot;:1,&quot;deleted&quot;:2\}/);
    assert.match(html, /storage\.retry/);
  });
});
```

Create `test/helpers/transcriptionCount.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDb } = require("./harness/db");

test("countTranscriptions counts what history shows and drops to zero after a clear", (t) => {
  const db = createDb(t);
  if (!db) return;
  assert.equal(db.countTranscriptions(), 0);
  db.db.prepare("INSERT INTO transcriptions (text) VALUES ('a'), ('b')").run();
  db.db.prepare("INSERT INTO transcriptions (text, status) VALUES ('c', 'discarded')").run();
  db.db.prepare("INSERT INTO transcriptions (text, deleted_at) VALUES ('d', '2026-01-01')").run();
  assert.equal(db.countTranscriptions(), 2);
  db.clearTranscriptions();
  assert.equal(db.countTranscriptions(), 0);
});
```

`transcriptions.text` is the only `NOT NULL` column without a default (`localDatabaseSchema.js:4-18`), so the raw insert is valid.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/storageMath.test.js test/components/storageList.test.js test/helpers/transcriptionCount.test.js`
Expected: FAIL. The modules are missing and `countTranscriptions` is not a function.

- [ ] **Step 3: Implement**

1. **Main process.**
   - In `src/helpers/audioStorage.js:200`, return `{ fileCount: files.length, totalBytes, directory: this.audioDir }`. In the catch at `:203`, return `{ fileCount: 0, totalBytes: 0, directory: this.audioDir }`.
   - In `src/helpers/database.js`, after `clearTranscriptions`, add:

     ```js
       // Counts what the history list shows (getTranscriptions, database.js:534-541).
       countTranscriptions() {
         return this.db
           .prepare("SELECT COUNT(*) AS n FROM transcriptions WHERE deleted_at IS NULL AND status != 'discarded'")
           .get().n;
       }
     ```

   - In `ipcHandlers.js`, after the `db-clear-transcriptions` handler, add `ipcMain.handle("db-count-transcriptions", () => this.databaseManager.countTranscriptions());`.
   - In `preload.js`, after `clearTranscriptions` (`:180`), add `countTranscriptions: () => ipcRenderer.invoke("db-count-transcriptions"),`.
   - Update the types as listed under Files.

   `test/helpers/personalIpcContract.test.js` already checks that every `db-*` invoke in `preload.js` has a handler, so it covers the new channel.

2. Create `src/components/settings/storageMath.ts`:

   ```ts
   export interface ModelLists {
     whisper?: { models?: { downloaded: boolean; size_bytes?: number; size_mb?: number }[] };
     parakeet?: { models?: { downloaded: boolean; size_bytes?: number; size_mb?: number }[] };
     llm?: { isDownloaded?: boolean; sizeBytes?: number; downloadedSize?: number }[];
   }

   export function summarizeModels(lists: ModelLists): { count: number; bytes: number } {
     let count = 0;
     let bytes = 0;
     for (const m of lists.whisper?.models ?? []) {
       if (!m.downloaded) continue;
       count++;
       // size_mb is rounded MiB; prefer exact bytes when main reports them.
       bytes += m.size_bytes ?? (m.size_mb ?? 0) * 1_000_000;
     }
     for (const m of lists.parakeet?.models ?? []) {
       if (!m.downloaded) continue;
       count++;
       bytes += m.size_bytes ?? (m.size_mb ?? 0) * 1_000_000;
     }
     for (const m of lists.llm ?? []) {
       if (!m.isDownloaded) continue;
       count++;
       bytes += m.downloadedSize ?? m.sizeBytes ?? 0;
     }
     return { count, bytes };
   }

   export function deletionOutcome(before: number, after: number) {
     return { deleted: Math.max(0, before - after), left: Math.max(0, after) };
   }

   export function resetConfirmed(typed: string, word: string): boolean {
     return typed.trim().toLocaleLowerCase() === word.trim().toLocaleLowerCase() && word.trim().length > 0;
   }
   ```

   In the first test, the LLM entry `{ isDownloaded: true, downloadedSize: 10 }` counts 10 bytes, because `downloadedSize` is preferred over the catalogue size. The expected sum in the test reflects that.

3. Create `src/components/settings/StorageList.tsx`:

   ```tsx
   import { useCallback, useEffect, useState } from "react";
   import type { TFunction } from "i18next";
   import { useTranslation } from "react-i18next";
   import { clearMissingLocalModelSelections } from "../../stores/settingsStore";
   import { refreshRouteFacts } from "../../stores/routeFactsStore";
   import { formatDecimalBytes } from "../../utils/formatBytes";
   import { Button } from "../ui/button";
   import { ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
   import { Input } from "../ui/input";
   import { useToast } from "../ui/useToast";
   import { deletionOutcome, resetConfirmed, summarizeModels } from "./storageMath";

   type Kind = "audio" | "models" | "history";
   export interface StorageRowState { count: number | null; bytes: number | null; directory: string | null }
   const EMPTY: StorageRowState = { count: null, bytes: null, directory: null };

   const summary = (t: TFunction, kind: Kind, row: StorageRowState) => {
     if (row.count === null) return t("storage.loading");
     if (row.count === 0) return t(`storage.${kind}.empty`);
     return row.bytes !== null && kind !== "history"
       ? t(`storage.${kind}.summary`, { count: row.count, size: formatDecimalBytes(row.bytes) })
       : t(`storage.${kind}.summary`, { count: row.count });
   };

   export function StorageListView(props: {
     audio: StorageRowState;
     models: StorageRowState;
     history: StorageRowState;
     onDelete: (kind: Kind) => void;
     onOpenModels: () => void;
     onReset: () => void;
   }) {
     const { t } = useTranslation();
     const row = (kind: Kind, state: StorageRowState, extra?: React.ReactNode) => (
       <div className="flex min-h-[54px] items-center gap-2 px-4 py-2">
         <div className="min-w-0 flex-1">
           <p className="text-xs font-semibold">{t(`storage.${kind}.title`)}</p>
           <p className="text-xs text-muted-foreground tabular-nums">{summary(t, kind, state)}</p>
         </div>
         {extra}
         <Button
           size="sm"
           variant="outline"
           data-storage-delete={kind}
           className="text-destructive border-destructive/30"
           disabled={!state.count}
           onClick={() => props.onDelete(kind)}
         >
           {t("storage.delete")}
         </Button>
       </div>
     );
     return (
       <section aria-labelledby="storage-title" className="space-y-2">
         <h3 id="storage-title" className="text-xs font-semibold text-muted-foreground">{t("storage.title")}</h3>
         <div className="divide-y divide-border/60 rounded-lg border border-border/70">
           {row("audio", props.audio)}
           {row(
             "models",
             props.models,
             <Button size="sm" variant="outline" onClick={props.onOpenModels}>
               {t("storage.open")}
             </Button>
           )}
           {row("history", props.history)}
           <div className="flex min-h-[54px] items-center gap-2 border-t border-destructive/30 px-4 py-2">
             <div className="min-w-0 flex-1">
               <p className="text-xs font-semibold text-destructive">{t("storage.danger")}</p>
               <p className="text-xs font-semibold">{t("storage.reset.title")}</p>
               <p className="text-xs text-muted-foreground">{t("storage.reset.description")}</p>
             </div>
             <Button size="sm" variant="outline" className="text-destructive border-destructive/30" onClick={props.onReset}>
               {t("storage.reset.button")}
             </Button>
           </div>
         </div>
       </section>
     );
   }

   export interface CountedDeleteProps {
     kind: Kind;
     row: StorageRowState;
     phase: "idle" | "deleting" | "partial";
     outcome?: { deleted: number; left: number };
     onConfirm: () => void;
     onCancel: () => void;
   }

   // The dialog body. Title/Description default to plain elements so the body
   // renders on the server in tests; the dialog passes Radix's labelled parts.
   export function CountedDeleteContent({
     Title = "h2",
     Description = "p",
     ...props
   }: CountedDeleteProps & { Title?: React.ElementType; Description?: React.ElementType }) {
     const { t } = useTranslation();
     const { kind, row } = props;
     const count = row.count ?? 0;
     const body =
       row.bytes !== null && kind !== "history"
         ? t(`storage.${kind}.confirmBody`, { count, size: formatDecimalBytes(row.bytes) })
         : t(`storage.${kind}.confirmBody`, { count });
     return (
       <div className="space-y-3">
         <Title className="text-base font-semibold">{t(`storage.${kind}.confirmTitle`, { count })}</Title>
         <Description className="text-sm text-muted-foreground">{body}</Description>
         {row.directory && (
           <code dir="ltr" className="block rounded bg-muted px-2 py-1 font-mono text-[11px] break-all">
             {row.directory}
           </code>
         )}
         {props.phase === "partial" && props.outcome && (
           <p role="alert" className="text-xs font-semibold text-destructive">
             {t("storage.partial", { left: props.outcome.left, deleted: props.outcome.deleted })}
           </p>
         )}
         <div className="flex justify-end gap-2">
           <Button variant="outline" onClick={props.onCancel}>
             {t("common.cancel")}
           </Button>
           <Button variant="destructive" disabled={props.phase === "deleting"} onClick={props.onConfirm}>
             {props.phase === "partial" ? t("storage.retry") : t(`storage.${kind}.confirmButton`, { count })}
           </Button>
         </div>
       </div>
     );
   }

   export function CountedDeleteDialog(props: CountedDeleteProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
     return (
       <Dialog open={props.open} onOpenChange={props.onOpenChange}>
         <DialogContent role="alertdialog">
           <CountedDeleteContent {...props} Title={DialogTitle} Description={DialogDescription} />
         </DialogContent>
       </Dialog>
     );
   }

   export function StorageList() {
     const { t } = useTranslation();
     const { toast } = useToast();
     const api = window.electronAPI;
     const [audio, setAudio] = useState<StorageRowState>(EMPTY);
     const [models, setModels] = useState<StorageRowState>(EMPTY);
     const [history, setHistory] = useState<StorageRowState>(EMPTY);
     const [dialog, setDialog] = useState<{ kind: Kind; phase: "idle" | "deleting" | "partial"; outcome?: { deleted: number; left: number } } | null>(null);
     const [resetOpen, setResetOpen] = useState(false);
     const [typed, setTyped] = useState("");

     const loadAudio = useCallback(async () => {
       const u = await api?.getAudioStorageUsage?.().catch(() => null);
       setAudio(u ? { count: u.fileCount, bytes: u.totalBytes, directory: u.directory ?? null } : EMPTY);
       return u?.fileCount ?? 0;
     }, [api]);
     const loadModels = useCallback(async () => {
       const [whisper, parakeet, llm, root] = await Promise.all([
         api?.listWhisperModels?.().catch(() => undefined),
         api?.listParakeetModels?.().catch(() => undefined),
         api?.modelGetAll?.().catch(() => undefined),
         api?.getModelCacheRoot?.().catch(() => null),
       ]);
       const sum = summarizeModels({ whisper, parakeet, llm });
       setModels({ count: sum.count, bytes: sum.bytes, directory: root ?? null });
       return sum.count;
     }, [api]);
     const loadHistory = useCallback(async () => {
       const n = await api?.countTranscriptions?.().catch(() => null);
       setHistory({ count: n ?? null, bytes: null, directory: null });
       return n ?? 0;
     }, [api]);

     useEffect(() => {
       void loadAudio();
       void loadModels();
       void loadHistory();
     }, [loadAudio, loadModels, loadHistory]);

     const rowFor = (kind: Kind) => (kind === "audio" ? audio : kind === "models" ? models : history);

     const runDelete = async (kind: Kind) => {
       const before = rowFor(kind).count ?? 0;
       setDialog({ kind, phase: "deleting" });
       let after = 0;
       try {
         if (kind === "audio") {
           await api?.deleteAllAudio?.();
           after = await loadAudio();
         } else if (kind === "models") {
           // Moved from SettingsPage.handleRemoveModels: delete every family,
           // then clear selections whose files are gone (never silently: the
           // route state shows "Choose a model").
           await Promise.allSettled([
             api?.deleteAllWhisperModels?.(),
             api?.deleteAllParakeetModels?.(),
             api?.modelDeleteAll?.(),
           ]);
           after = await loadModels();
           // As in the old handleRemoveModels: clear selections only when every
           // file is gone. After a partial failure, the surviving selections stay
           // valid and route facts mark the deleted ones as needing a model.
           if (after === 0) clearMissingLocalModelSelections(() => false);
           window.dispatchEvent(new Event("openwhispr-models-cleared"));
           void refreshRouteFacts();
         } else {
           await api?.clearTranscriptions?.();
           after = await loadHistory();
         }
       } catch {
         after = kind === "audio" ? await loadAudio() : kind === "models" ? await loadModels() : await loadHistory();
       }
       const outcome = deletionOutcome(before, after);
       if (outcome.left > 0) {
         setDialog({ kind, phase: "partial", outcome });
         return;
       }
       setDialog(null);
       toast({ title: t("storage.deleted", { count: outcome.deleted }), variant: "success", duration: 4500 });
     };

     return (
       <>
         <StorageListView
           audio={audio}
           models={models}
           history={history}
           onDelete={(kind) => setDialog({ kind, phase: "idle" })}
           onOpenModels={() => void api?.openWhisperModelsFolder?.()}
           onReset={() => {
             setTyped("");
             setResetOpen(true);
           }}
         />
         {dialog && (
           <CountedDeleteDialog
             open
             kind={dialog.kind}
             row={rowFor(dialog.kind)}
             phase={dialog.phase}
             outcome={dialog.outcome}
             onConfirm={() => void runDelete(dialog.kind)}
             onCancel={() => dialog.phase !== "deleting" && setDialog(null)}
             onOpenChange={(open) => !open && dialog.phase !== "deleting" && setDialog(null)}
           />
         )}
         <ConfirmDialog
           open={resetOpen}
           onOpenChange={setResetOpen}
           title={t("storage.reset.confirmTitle")}
           description={t("storage.reset.confirmBody")}
           confirmText={t("storage.reset.confirmButton")}
           variant="destructive"
           confirmDisabled={!resetConfirmed(typed, t("storage.reset.word"))}
           onConfirm={async () => {
             try {
               await api?.cleanupApp();
               toast({ title: t("settingsPage.developer.resetAll.successTitle"), variant: "success" });
               setTimeout(() => api?.relaunchApp(), 1000);
             } catch {
               toast({ title: t("settingsPage.developer.resetAll.failedTitle"), variant: "destructive" });
             }
           }}
         >
           <label className="block space-y-1 text-xs">
             <span>{t("storage.reset.typeLabel", { word: t("storage.reset.word") })}</span>
             <Input value={typed} onChange={(e) => setTyped(e.target.value)} className="h-9" autoComplete="off" />
           </label>
         </ConfirmDialog>
       </>
     );
   }
   ```

   The reset success and failure toasts reuse the existing `settingsPage.developer.resetAll.{successTitle,failedTitle}` keys, so they are not duplicated. If `ConfirmDialog` closes itself after `onConfirm`, that is fine for reset, because reset relaunches.

4. **`SettingsPage.tsx` re-homing**, per the Files list. Render `<StorageList />` in `privacyData` directly after the transcript-retention panel (`:2866`) and before the permissions cards (`:2873`). Do not touch the retention selects. Previewing retention changes is R7 B, which was not picked.

5. Write `/tmp/loqui-i18n-task-11.json` and merge it. The `en` block is below. Every key with `_one/_other` needs every plural category per locale.

   ```json
   {
     "storage": {
       "title": "Storage",
       "loading": "Counting…",
       "delete": "Delete…",
       "open": "Open",
       "retry": "Try again",
       "danger": "Danger zone",
       "deleted_one": "Deleted {{count}} item.",
       "deleted_other": "Deleted {{count}} items.",
       "partial": "Couldn't delete {{left}} (in use). {{deleted}} were deleted. Nothing else was touched.",
       "audio": {
         "title": "Dictation audio",
         "empty": "No audio files stored",
         "summary_one": "{{count}} file · {{size}}",
         "summary_other": "{{count}} files · {{size}}",
         "confirmTitle_one": "Delete {{count}} recording?",
         "confirmTitle_other": "Delete {{count}} recordings?",
         "confirmBody_one": "This permanently deletes {{count}} recording ({{size}}). Transcripts stay. Copies already sent to a provider are not affected.",
         "confirmBody_other": "This permanently deletes {{count}} recordings ({{size}}). Transcripts stay. Copies already sent to a provider are not affected.",
         "confirmButton_one": "Delete {{count}} recording",
         "confirmButton_other": "Delete {{count}} recordings"
       },
       "models": {
         "title": "Downloaded models",
         "empty": "None downloaded",
         "summary_one": "{{count}} model · {{size}}",
         "summary_other": "{{count}} models · {{size}}",
         "confirmTitle_one": "Delete {{count}} model?",
         "confirmTitle_other": "Delete {{count}} models?",
         "confirmBody_one": "This permanently deletes {{count}} model ({{size}}). Tasks that use it will ask you to choose a model again.",
         "confirmBody_other": "This permanently deletes {{count}} models ({{size}}). Tasks that use them will ask you to choose a model again.",
         "confirmButton_one": "Delete {{count}} model",
         "confirmButton_other": "Delete {{count}} models"
       },
       "history": {
         "title": "Transcript history",
         "empty": "No transcripts saved",
         "summary_one": "{{count}} item",
         "summary_other": "{{count}} items",
         "confirmTitle_one": "Delete {{count}} item?",
         "confirmTitle_other": "Delete {{count}} items?",
         "confirmBody_one": "This permanently deletes {{count}} transcript and its audio. Copies already sent to a provider are not affected.",
         "confirmBody_other": "This permanently deletes {{count}} transcripts and their audio. Copies already sent to a provider are not affected.",
         "confirmButton_one": "Delete {{count}} item",
         "confirmButton_other": "Delete {{count}} items"
       },
       "reset": {
         "title": "Reset Loqui",
         "description": "Deletes settings, history, audio, downloaded models and saved provider keys.",
         "button": "Reset…",
         "confirmTitle": "Reset Loqui?",
         "confirmBody": "This deletes settings, history, audio, downloaded models and your saved provider keys. It cannot be undone.",
         "confirmButton": "Reset Loqui",
         "typeLabel": "Type “{{word}}” to confirm",
         "word": "reset"
       }
     }
   }
   ```

   The history body says "and its audio" because `db-clear-transcriptions` also deletes all audio (`ipcHandlers.js:1287`). Translate `storage.reset.word` into a short, easy-to-type word in each language, for example de "zurücksetzen" and ja "リセット".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run native:node && npm test -- test/components/storageMath.test.js test/components/storageList.test.js test/helpers/transcriptionCount.test.js test/helpers/personalIpcContract.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

Then check manually against card R7 A (`05-settings.html:1658-1672`):
- Privacy & Data shows Storage with real counts.
- Delete… on audio names the count, size and folder.
- Reset stays disabled until "reset" is typed.
- System no longer shows Clear Cache or Reset.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/storageMath.ts src/components/settings/StorageList.tsx src/helpers/audioStorage.js src/helpers/database.js src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/components/SettingsPage.tsx src/locales test/components/storageMath.test.js test/components/storageList.test.js test/helpers/transcriptionCount.test.js
git commit -m "feat(settings): Storage list with counted delete confirms"
```

---

