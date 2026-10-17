import { useCallback, useEffect, useRef, useState } from "react";
import type { ElementType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { clearMissingLocalModelSelections } from "../../stores/settingsStore";
import { formatDecimalBytes } from "../../utils/formatBytes";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { useToast } from "../ui/useToast";
import { useAudioStorageUsage } from "../../hooks/useAudioStorageUsage";
import {
  audioRowFromUsage,
  countModels,
  errorText,
  familyOutcome,
  historyOutcomeFromResult,
  isEmptySnapshot,
  MODEL_FAMILIES,
  modelsOutcome,
  outcomeFromRejection,
  outcomeFromResult,
  resetConfirmed,
  resetOutcome,
  rowsFromPreview,
  snapshotCount,
  type AudioSnapshot,
  type HistorySnapshot,
  type DeleteOutcome,
  type ModelsSnapshot,
  type RowState,
  type StorageKind,
  type StorageSnapshot,
} from "./storageMath";

// I13: Button's outline variant hovers to bg-muted (#f5f5f5), where
// --color-destructive is 4.43:1. Destructive triggers stay on the page
// background (4.83:1 light); Plum Night keeps the variant's dark surfaces.
export const DESTRUCTIVE_OUTLINE =
  "bg-background hover:bg-background text-destructive hover:text-destructive border-destructive/40 hover:border-destructive";
export const RESET_RELAUNCH_DELAY_MS = 1000;

export type DeletePhase = "review" | "running" | "failed";
export type ResetPhase = "review" | "running" | "failed" | "done";
type T = ReturnType<typeof useTranslation>["t"];
type Api = Window["electronAPI"] | undefined;
type Rows = {
  audio: RowState<AudioSnapshot>;
  history: RowState<HistorySnapshot>;
  models: RowState<ModelsSnapshot>;
};
type Last = { snapshot: StorageSnapshot; outcome: DeleteOutcome };
type DeleteIntent = { kind: "delete"; phase: DeletePhase | "opening"; read: number };
type ResetIntent = { kind: "reset"; phase: ResetPhase };
type DialogState = {
  owner: DeleteIntent;
  snapshot: StorageSnapshot;
  phase: DeletePhase;
  last: Last | null;
};
type ResetState = { owner: ResetIntent; phase: ResetPhase; typed: string; errors: string[] };

const LOADING: Rows = {
  audio: { status: "loading" },
  models: { status: "loading" },
  history: { status: "loading" },
};

const call = <R,>(fn: (() => Promise<R>) | undefined): Promise<R> =>
  fn ? fn() : Promise.reject(new Error("unavailable in this window"));

function rowSummary(t: T, kind: StorageKind, row: RowState): string {
  if (row.status === "loading") return t("storage.loading");
  // Plan 02's unavailable state (spec §5.6): an unreadable audio folder is never "no audio".
  if (row.status === "error")
    return kind === "audio"
      ? t("settingsPage.privacy.audioStorageUnavailable")
      : t("storage.countFailed");
  const s = row.snapshot;
  if (isEmptySnapshot(s)) return t(`storage.${kind}.empty`);
  if (s.kind === "audio") {
    return t("storage.audio.summary", { count: s.files, size: formatDecimalBytes(s.bytes) });
  }
  if (s.kind === "models") {
    return t("storage.models.summary", { count: s.count, size: formatDecimalBytes(s.bytes) });
  }
  const hidden = s.discarded + s.softDeleted;
  return hidden > 0
    ? t("storage.history.summaryWithHidden", {
        count: s.total,
        hidden: t("storage.history.hidden", { count: hidden }),
      })
    : t("storage.history.summary", { count: s.total });
}

export interface StorageListViewProps {
  audio: RowState;
  models: RowState;
  history: RowState;
  onDelete: (kind: StorageKind) => void | Promise<void>;
  onOpenModels: () => void;
  onRefresh: () => void;
  onReset: () => void;
}

export function StorageListView(props: StorageListViewProps) {
  const { t } = useTranslation();
  const anyError = [props.audio, props.models, props.history].some((r) => r.status === "error");
  const row = (kind: StorageKind, state: RowState, extra?: ReactNode) => (
    <div className="flex min-h-[54px] items-center gap-2 px-4 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">{t(`storage.${kind}.title`)}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{rowSummary(t, kind, state)}</p>
      </div>
      {extra}
      <Button
        size="sm"
        variant="outline"
        data-storage-delete={kind}
        className={DESTRUCTIVE_OUTLINE}
        disabled={state.status !== "ready" || isEmptySnapshot(state.snapshot)}
        onClick={() => void props.onDelete(kind)}
      >
        {t("storage.delete")}
      </Button>
    </div>
  );
  return (
    <section data-setting-id="storage" aria-labelledby="storage-title" className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 id="storage-title" className="flex-1 text-xs font-semibold text-foreground">
          {t("storage.title")}
        </h3>
        {anyError && (
          <Button size="sm" variant="ghost" data-storage-action="refresh" onClick={props.onRefresh}>
            {t("storage.countAgain")}
          </Button>
        )}
      </div>
      <div className="divide-y divide-border/60 rounded-lg border border-border/70 bg-card/50 dark:border-border-subtle/70 dark:bg-surface-2/50">
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
            <p className="text-xs font-semibold text-foreground">{t("storage.reset.title")}</p>
            <p className="text-xs text-muted-foreground">{t("storage.reset.description")}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            data-storage-reset=""
            className={DESTRUCTIVE_OUTLINE}
            onClick={props.onReset}
          >
            {t("storage.reset.button")}
          </Button>
        </div>
      </div>
    </section>
  );
}

function confirmCopy(t: T, s: StorageSnapshot): { title: string; body: string; button: string } {
  if (s.kind === "audio") {
    return {
      title: t("storage.audio.confirmTitle", { count: s.files }),
      body: t("storage.audio.confirmBody", { count: s.files, size: formatDecimalBytes(s.bytes) }),
      button: t("storage.audio.confirmButton", { count: s.files }),
    };
  }
  if (s.kind === "models") {
    return {
      title: t("storage.models.confirmTitle", { count: s.count }),
      body: t("storage.models.confirmBody", { count: s.count, size: formatDecimalBytes(s.bytes) }),
      button: t("storage.models.confirmButton", { count: s.count }),
    };
  }
  const transcripts =
    s.discarded + s.softDeleted > 0
      ? t("storage.history.transcriptsWithHidden", {
          count: s.total,
          discarded: t("storage.history.discarded", { count: s.discarded }),
          deleted: t("storage.history.softDeleted", { count: s.softDeleted }),
        })
      : t("storage.history.transcripts", { count: s.total });
  return {
    title: t("storage.history.confirmTitle"),
    body: t("storage.history.confirmBody", {
      transcripts,
      audio: t("storage.history.audioFiles", { count: s.files, size: formatDecimalBytes(s.bytes) }),
    }),
    button: t("storage.history.confirmButton", {
      transcripts: t("storage.history.transcripts", { count: s.total }),
      audio: t("storage.history.audioFilesShort", { count: s.files }),
    }),
  };
}

function outcomeLines(t: T, s: StorageSnapshot, o: DeleteOutcome): string[] {
  if (o.errors.includes("stale")) return [t("storage.failed.stale")];
  const lines: string[] = [];
  for (const f of o.families ?? []) {
    if (f.ok === false) {
      lines.push(
        t("storage.models.familyFailed", { family: t(`storage.models.families.${f.family}`) })
      );
    }
  }
  if (o.deleted === null || o.remaining === null) {
    lines.push(t("storage.failed.unknown"));
    return lines;
  }
  if (s.kind !== "history") {
    lines.push(
      t("storage.failed.partial", {
        deleted: o.deleted,
        total: snapshotCount(s),
        remaining: o.remaining,
      })
    );
    return lines;
  }
  lines.push(t("storage.failed.historyRows", { deleted: o.deleted, total: s.total }));
  if (o.audio && (o.audio.deleted === null || o.audio.remaining === null)) {
    lines.push(t("storage.failed.historyAudioUnknown"));
  } else if (o.audio) {
    lines.push(
      t("storage.failed.historyAudio", {
        deleted: o.audio.deleted,
        total: s.files,
        remaining: o.audio.remaining,
      })
    );
  }
  return lines;
}

function ErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul
      dir="ltr"
      className="list-disc space-y-0.5 ps-4 font-mono text-[11px] text-muted-foreground break-all"
    >
      {errors.map((error, index) => (
        <li key={`${index}:${error}`}>{error}</li>
      ))}
    </ul>
  );
}

function OutcomeAlert({ last }: { last: Last }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-destructive/40 bg-background p-2 text-xs"
    >
      {outcomeLines(t, last.snapshot, last.outcome).map((line) => (
        <p key={line} className="font-semibold text-destructive">
          {line}
        </p>
      ))}
      <ErrorList errors={last.outcome.errors.filter((e) => e !== "stale")} />
    </div>
  );
}

export interface CountedDeleteProps {
  snapshot: StorageSnapshot;
  phase: DeletePhase;
  last: Last | null;
  onConfirm: () => void;
  onCancel: () => void;
  onRecount: () => void;
}

// The dialog body. Title/Description default to plain elements so it
// renders on the server in tests; the dialog passes Radix's labelled parts.
export function CountedDeleteContent({
  Title = "h2",
  Description = "p",
  ...props
}: CountedDeleteProps & { Title?: ElementType; Description?: ElementType }) {
  const { t } = useTranslation();
  const copy = confirmCopy(t, props.snapshot);
  const running = props.phase === "running";
  return (
    <div className="space-y-3" aria-busy={running || undefined}>
      <Title className="text-base font-semibold text-foreground">{copy.title}</Title>
      <Description className="text-sm text-muted-foreground">{copy.body}</Description>
      {props.snapshot.directory && (
        <code
          dir="ltr"
          className="block rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-foreground break-all"
        >
          {props.snapshot.directory}
        </code>
      )}
      {props.last && <OutcomeAlert last={props.last} />}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={running} onClick={props.onCancel}>
          {t("common.cancel")}
        </Button>
        {props.phase === "failed" ? (
          <Button data-storage-action="recount" onClick={props.onRecount}>
            {t("storage.countAgain")}
          </Button>
        ) : (
          <Button
            variant="destructive"
            data-storage-action="confirm"
            disabled={running || isEmptySnapshot(props.snapshot)}
            onClick={props.onConfirm}
          >
            {running ? t("storage.deleting") : copy.button}
          </Button>
        )}
      </div>
    </div>
  );
}

export function CountedDeleteDialog(
  props: CountedDeleteProps & { open: boolean; onOpenChange: (open: boolean) => void }
) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent role="alertdialog">
        <CountedDeleteContent {...props} Title={DialogTitle} Description={DialogDescription} />
      </DialogContent>
    </Dialog>
  );
}

export interface ResetProps {
  phase: ResetPhase;
  typed: string;
  confirmDisabled: boolean;
  errors: string[];
  onTypedChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ResetContent({
  Title = "h2",
  Description = "p",
  ...props
}: ResetProps & { Title?: ElementType; Description?: ElementType }) {
  const { t } = useTranslation();
  const running = props.phase === "running";
  const failed = props.phase === "failed";
  if (props.phase === "done") {
    return (
      <div className="space-y-3">
        <Title className="text-base font-semibold text-foreground">
          {t("storage.reset.confirmTitle")}
        </Title>
        <Description role="status" className="text-sm text-foreground">
          {t("storage.reset.done")}
        </Description>
      </div>
    );
  }
  return (
    <div className="space-y-3" aria-busy={running || undefined}>
      <Title className="text-base font-semibold text-foreground">
        {t("storage.reset.confirmTitle")}
      </Title>
      <Description className="text-sm text-muted-foreground">
        {t("storage.reset.confirmBody")}
      </Description>
      <label className="block space-y-1 text-xs text-foreground">
        <span>{t("storage.reset.typeLabel", { word: t("storage.reset.word") })}</span>
        <Input
          value={props.typed}
          disabled={running}
          onChange={(e) => props.onTypedChange(e.target.value)}
          className="h-9"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {failed && (
        <div
          role="alert"
          className="space-y-1 rounded-md border border-destructive/40 bg-background p-2 text-xs"
        >
          <p className="font-semibold text-destructive">{t("storage.reset.failed")}</p>
          <ErrorList errors={props.errors} />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={running} onClick={props.onCancel}>
          {failed ? t("common.close") : t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          data-storage-action="reset"
          disabled={props.confirmDisabled}
          onClick={props.onConfirm}
        >
          {running
            ? t("storage.reset.running")
            : failed
              ? t("storage.retry")
              : t("storage.reset.confirmButton")}
        </Button>
      </div>
    </div>
  );
}

export function ResetDialog(
  props: ResetProps & { open: boolean; onOpenChange: (open: boolean) => void }
) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent role="alertdialog">
        <ResetContent {...props} Title={DialogTitle} Description={DialogDescription} />
      </DialogContent>
    </Dialog>
  );
}

async function loadPreviewRows(api: Api): Promise<Pick<Rows, "audio" | "history">> {
  try {
    return rowsFromPreview(await call(api?.storage?.preview));
  } catch (error) {
    const failed: RowState = { status: "error", error: errorText(error) };
    return { audio: failed, history: failed };
  }
}

async function loadModelsRow(api: Api): Promise<RowState<ModelsSnapshot>> {
  const [whisper, parakeet, llm] = await Promise.allSettled([
    call(api?.listWhisperModels),
    call(api?.listParakeetModels),
    call(api?.modelGetAll),
  ]);
  const counted = countModels({ whisper, parakeet, llm });
  if (counted.ok === false) return { status: "error", error: counted.error };
  const directory = await call(api?.getModelCacheRoot).catch(() => null);
  return {
    status: "ready",
    snapshot: {
      kind: "models",
      count: counted.count,
      bytes: counted.bytes,
      directory: directory || null,
    },
  };
}

async function deleteModels(api: Api, s: ModelsSnapshot): Promise<DeleteOutcome> {
  const settled = await Promise.allSettled([
    call(api?.deleteAllWhisperModels),
    call(api?.deleteAllParakeetModels),
    call(api?.modelDeleteAll),
  ]);
  const families = MODEL_FAMILIES.map((family, index) => familyOutcome(family, settled[index]));
  const after = await loadModelsRow(api);
  if (after.status === "ready") return modelsOutcome(s.count, families, after.snapshot.count, null);
  return modelsOutcome(
    s.count,
    families,
    null,
    after.status === "error" ? after.error : "not counted"
  );
}

async function performDelete(api: Api, s: StorageSnapshot): Promise<DeleteOutcome> {
  try {
    if (s.kind === "models") return await deleteModels(api, s);
    const storage = api?.storage;
    if (!storage) throw new Error("unavailable in this window");
    if (s.kind === "audio")
      return outcomeFromResult(
        await storage.deleteAudio({ files: s.files, audioIdentity: s.audioIdentity })
      );
    return historyOutcomeFromResult(
      await storage.deleteHistory({
        total: s.total,
        files: s.files,
        audioIdentity: s.audioIdentity,
        historyIdentity: s.historyIdentity,
      })
    );
  } catch (error) {
    return outcomeFromRejection(error, s.kind);
  }
}

const doneTitle = (t: T, s: StorageSnapshot, o: DeleteOutcome) =>
  t(`storage.${s.kind}.done`, { count: o.deleted ?? 0 });

export function StorageList() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [rows, setRows] = useState<Rows>(LOADING);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [reset, setReset] = useState<ResetState | null>(null);
  const busy = useRef(false);
  const resetBusy = useRef(false);
  // UI lifetime only: main still owns the reviewed storage identities and deletion.
  const intent = useRef<DeleteIntent | ResetIntent | null>(null);
  const mounted = useRef(true);
  const owns = (owner: DeleteIntent | ResetIntent) => mounted.current && intent.current === owner;
  const publishDialog = (owner: DeleteIntent, next: Omit<DialogState, "owner">) => {
    if (!owns(owner)) return;
    owner.phase = next.phase;
    setDialog((current) => (owns(owner) ? { ...next, owner } : current));
  };
  const publishReset = (owner: ResetIntent, next: Omit<ResetState, "owner">) => {
    if (!owns(owner)) return;
    owner.phase = next.phase;
    setReset((current) => (owns(owner) ? { ...next, owner } : current));
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      intent.current = null;
    };
  }, []);
  const word = t("storage.reset.word");

  // Plan 02's hook (spec §5.6) owns the audio row's count, bytes and
  // unavailable state; load() re-reads it with the rest of the list.
  const audioUsage = useAudioStorageUsage(true);
  const refreshAudioUsage = audioUsage.refresh;

  const load = useCallback(async (): Promise<Rows> => {
    const api = window.electronAPI;
    const [preview, models, usage] = await Promise.all([
      loadPreviewRows(api),
      loadModelsRow(api),
      refreshAudioUsage(),
    ]);
    const next: Rows = {
      audio: usage.status === "known" ? preview.audio : { status: "error", error: "unavailable" },
      history: preview.history,
      models,
    };
    if (mounted.current) setRows(next);
    return next;
  }, [refreshAudioUsage]);

  useEffect(() => {
    void load();
  }, [load]);

  const runDelete = async () => {
    if (
      !dialog ||
      !owns(dialog.owner) ||
      dialog.owner.phase !== "review" ||
      busy.current ||
      resetBusy.current
    )
      return;
    const owner = dialog.owner;
    owner.read++; // retire any metadata read from the preceding review
    busy.current = true;
    const reviewed = dialog.snapshot;
    publishDialog(owner, { ...dialog, phase: "running" });
    const outcome = await performDelete(window.electronAPI, reviewed);
    if (reviewed.kind === "models") {
      // Clear local selections only when the recount proves every model file
      // is gone; after a partial delete the survivors stay selectable and
      // route facts mark the missing ones (the event refreshes them).
      if (outcome.ok === true && outcome.remaining === 0)
        clearMissingLocalModelSelections(() => false);
      window.dispatchEvent(new Event("openwhispr-models-cleared"));
    }
    const fresh = await load(); // refreshes the rows; never decides the outcome
    busy.current = false;
    if (!owns(owner)) return;
    if (outcome.ok === true) {
      intent.current = null;
      setDialog((current) => (current?.owner === owner ? null : current));
      toast({ title: doneTitle(t, reviewed, outcome), variant: "success", duration: 4500 });
      return;
    }
    const last = { snapshot: reviewed, outcome };
    const row = fresh[reviewed.kind];
    if (outcome.errors.includes("stale") && row.status === "ready") {
      publishDialog(owner, { snapshot: row.snapshot, phase: "review", last });
    } else {
      publishDialog(owner, { snapshot: reviewed, phase: "failed", last });
    }
  };

  // Plan 02 (spec §5.6): count again before confirming. A failed read turns
  // the row unavailable and opens no confirmation, so a stale count is never
  // presented as current.
  const openDelete = async (kind: StorageKind) => {
    if (!mounted.current || busy.current || resetBusy.current) return;
    if (intent.current && (intent.current.kind !== "delete" || intent.current.phase !== "opening"))
      return;
    const owner: DeleteIntent = { kind: "delete", phase: "opening", read: 0 };
    intent.current = owner; // a newer opening intent supersedes an older pending read
    const row = (await load())[kind];
    if (!owns(owner) || busy.current || resetBusy.current) return;
    if (row.status === "ready" && !isEmptySnapshot(row.snapshot)) {
      publishDialog(owner, { snapshot: row.snapshot, phase: "review", last: null });
    } else {
      intent.current = null;
    }
  };

  const recount = async () => {
    if (
      !dialog ||
      !owns(dialog.owner) ||
      dialog.owner.phase !== "failed" ||
      busy.current ||
      resetBusy.current
    )
      return;
    const current = dialog;
    const owner = current.owner;
    const read = ++owner.read;
    const row = (await load())[current.snapshot.kind];
    if (!owns(owner) || owner.read !== read || owner.phase !== "failed") return;
    if (row.status === "ready") {
      publishDialog(owner, { snapshot: row.snapshot, phase: "review", last: current.last });
    } else if (row.status === "error" && current.last) {
      const outcome = {
        ...current.last.outcome,
        errors: [...current.last.outcome.errors, `count-failed: ${row.error}`],
      };
      publishDialog(owner, { ...current, last: { ...current.last, outcome } });
    }
  };

  const runReset = async () => {
    if (
      !reset ||
      !owns(reset.owner) ||
      resetBusy.current ||
      reset.owner.phase === "running" ||
      reset.owner.phase === "done"
    )
      return;
    if (!resetConfirmed(reset.typed, word)) return;
    const owner = reset.owner;
    resetBusy.current = true;
    const typed = reset.typed;
    publishReset(owner, { phase: "running", typed, errors: [] });
    let result: { ok: boolean; errors: string[] };
    try {
      result = resetOutcome(await call(window.electronAPI?.cleanupApp));
    } catch (error) {
      result = { ok: false, errors: [`ipc-failed: ${errorText(error)}`] };
    }
    if (!owns(owner)) return;
    if (result.ok === false) {
      resetBusy.current = false;
      publishReset(owner, { phase: "failed", typed, errors: result.errors });
      return;
    }
    publishReset(owner, { phase: "done", typed, errors: [] });
    setTimeout(() => {
      if (owns(owner)) void window.electronAPI?.relaunchApp?.();
    }, RESET_RELAUNCH_DELAY_MS);
  };

  const closeDialog = () => {
    if (!dialog || !owns(dialog.owner) || busy.current || dialog.owner.phase === "running") return;
    const owner = dialog.owner;
    intent.current = null;
    setDialog((current) => (current?.owner === owner ? null : current));
  };
  const closeReset = () => {
    if (
      !reset ||
      !owns(reset.owner) ||
      resetBusy.current ||
      reset.owner.phase === "running" ||
      reset.owner.phase === "done"
    )
      return;
    const owner = reset.owner;
    intent.current = null;
    setReset((current) => (current?.owner === owner ? null : current));
  };

  return (
    <>
      <StorageListView
        audio={audioRowFromUsage(audioUsage.usage, rows.audio)}
        models={rows.models}
        history={rows.history}
        onDelete={(kind) => openDelete(kind)}
        onOpenModels={() => void window.electronAPI?.openWhisperModelsFolder?.()}
        onRefresh={() => void load()}
        onReset={() => {
          if (!mounted.current || busy.current || resetBusy.current) return;
          if (
            intent.current &&
            (intent.current.kind !== "delete" || intent.current.phase !== "opening")
          )
            return;
          const owner: ResetIntent = { kind: "reset", phase: "review" };
          intent.current = owner;
          publishReset(owner, { phase: "review", typed: "", errors: [] });
        }}
      />
      {dialog && (
        <CountedDeleteDialog
          open
          snapshot={dialog.snapshot}
          phase={dialog.phase}
          last={dialog.last}
          onConfirm={() => void runDelete()}
          onRecount={() => void recount()}
          onCancel={closeDialog}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
        />
      )}
      {reset && (
        <ResetDialog
          open
          phase={reset.phase}
          typed={reset.typed}
          errors={reset.errors}
          confirmDisabled={
            reset.phase === "running" ||
            reset.phase === "done" ||
            !resetConfirmed(reset.typed, word)
          }
          onTypedChange={(typed) =>
            setReset((current) =>
              current &&
              owns(current.owner) &&
              current.owner.phase !== "running" &&
              current.owner.phase !== "done"
                ? { ...current, typed }
                : current
            )
          }
          onConfirm={() => void runReset()}
          onCancel={closeReset}
          onOpenChange={(open) => {
            if (!open) closeReset();
          }}
        />
      )}
    </>
  );
}
