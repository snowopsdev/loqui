// Pure helpers for Settings > Storage. Main owns audio and history counts
// (src/helpers/storageOps.js); this module validates what main returns and
// does the renderer-side model arithmetic. Nothing here turns an unknown
// into zero or a failure into success. Audio success is Plan 02's rule
// (spec §5.6): resolveClearAudioOutcome must say "cleared".
import { resolveClearAudioOutcome } from "../../utils/audioDeletion.ts";
import type { AudioUsage } from "../../hooks/useAudioStorageUsage.ts";

export type ModelFamily = "whisper" | "parakeet" | "llm";
export const MODEL_FAMILIES: readonly ModelFamily[] = ["whisper", "parakeet", "llm"];

export interface AudioSnapshot {
  kind: "audio";
  files: number;
  bytes: number;
  directory: string;
  audioIdentity: string;
}
export interface HistorySnapshot {
  kind: "history";
  total: number;
  discarded: number;
  softDeleted: number;
  files: number;
  bytes: number;
  directory: string;
  audioIdentity: string;
  historyIdentity: string;
}
export interface ModelsSnapshot {
  kind: "models";
  count: number;
  bytes: number;
  directory: string | null;
}
export type StorageSnapshot = AudioSnapshot | HistorySnapshot | ModelsSnapshot;
export type StorageKind = StorageSnapshot["kind"];
export type RowState<S extends StorageSnapshot = StorageSnapshot> =
  { status: "loading" } | { status: "error"; error: string } | { status: "ready"; snapshot: S };

export interface FamilyOutcome {
  family: ModelFamily;
  ok: boolean;
  error?: string;
}
export interface DeleteOutcome {
  ok: boolean;
  deleted: number | null; // null: main's answer is unknown
  remaining: number | null; // null: could not be recounted
  errors: string[];
  audio?: { deleted: number | null; remaining: number | null }; // history only
  families?: FamilyOutcome[]; // models only
}

interface SpeechModelInfo {
  downloaded?: boolean;
  size_bytes?: number;
  size_mb?: number;
}
interface LlmModelInfo {
  isDownloaded?: boolean;
  sizeBytes?: number;
  downloadedSize?: number;
}
export interface ModelLists {
  whisper?: { models?: SpeechModelInfo[] };
  parakeet?: { models?: SpeechModelInfo[] };
  llm?: LlmModelInfo[];
}

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose => !!value && typeof value === "object";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const isIdentity = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isObject(error) && typeof error.error === "string") return error.error;
  return String(error ?? "unknown error");
}

export function rowsFromPreview(raw: unknown): {
  audio: RowState<AudioSnapshot>;
  history: RowState<HistorySnapshot>;
} {
  const audioRaw = isObject(raw) ? raw.audio : undefined;
  const historyRaw = isObject(raw) ? raw.history : undefined;

  let audio: RowState<AudioSnapshot> = { status: "error", error: "invalid-preview" };
  if (isObject(audioRaw) && typeof audioRaw.error === "string") {
    audio = { status: "error", error: audioRaw.error };
  } else if (isObject(audioRaw)) {
    const { files, bytes, directory, audioIdentity } = audioRaw;
    if (
      isCount(files) &&
      isCount(bytes) &&
      typeof directory === "string" &&
      isIdentity(audioIdentity)
    ) {
      audio = {
        status: "ready",
        snapshot: { kind: "audio", files, bytes, directory, audioIdentity },
      };
    }
  }

  let history: RowState<HistorySnapshot> = { status: "error", error: "invalid-preview" };
  if (isObject(historyRaw) && typeof historyRaw.error === "string") {
    history = { status: "error", error: historyRaw.error };
  } else if (audio.status === "error") {
    // History deletion also deletes every recording, so it can't be counted without them.
    history = { status: "error", error: `audio: ${audio.error}` };
  } else if (isObject(historyRaw) && audio.status === "ready") {
    const { total, discarded, softDeleted, historyIdentity } = historyRaw;
    if (
      isCount(total) &&
      isCount(discarded) &&
      isCount(softDeleted) &&
      isIdentity(historyIdentity)
    ) {
      const { files, bytes, directory, audioIdentity } = audio.snapshot;
      history = {
        status: "ready",
        snapshot: {
          kind: "history",
          total,
          discarded,
          softDeleted,
          files,
          bytes,
          directory,
          audioIdentity,
          historyIdentity,
        },
      };
    }
  }
  return { audio, history };
}

const MIB = 1024 * 1024;

export function summarizeModels(lists: ModelLists): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const m of [...(lists.whisper?.models ?? []), ...(lists.parakeet?.models ?? [])]) {
    if (!m.downloaded) continue;
    count++;
    // Main reports exact bytes; size_mb is rounded MiB (whisper.js:714-715, parakeet.js:625-626).
    bytes += m.size_bytes ?? (m.size_mb ?? 0) * MIB;
  }
  for (const m of lists.llm ?? []) {
    if (!m.isDownloaded) continue;
    count++;
    bytes += m.downloadedSize || m.sizeBytes || 0;
  }
  return { count, bytes };
}

export function countModels(
  settled: Record<ModelFamily, PromiseSettledResult<unknown>>
): { ok: true; count: number; bytes: number } | { ok: false; error: string } {
  const errors: string[] = [];
  const read = (family: ModelFamily): unknown => {
    const result = settled[family];
    if (result.status === "rejected") {
      errors.push(`${family}: ${errorText(result.reason)}`);
      return undefined;
    }
    const value = result.value;
    const models = family === "llm" ? value : isObject(value) ? value.models : undefined;
    const flag = family === "llm" ? "isDownloaded" : "downloaded";
    // Validate the existing inventory contract, independently of capability.
    // Descriptive `size` labels are not byte fields and remain unrestricted.
    const sizeKeys = family === "llm" ? ["downloadedSize", "sizeBytes"] : ["size_bytes", "size_mb"];
    const valid =
      (family === "llm" || (isObject(value) && value.success === true)) &&
      Array.isArray(models) &&
      models.every(
        (model) =>
          isObject(model) &&
          typeof model[flag] === "boolean" &&
          sizeKeys.every(
            (key) =>
              model[key] === undefined ||
              (typeof model[key] === "number" && Number.isFinite(model[key]) && model[key] >= 0)
          )
      );
    if (!valid) {
      const reason =
        isObject(value) && typeof value.error === "string" ? value.error : "unreadable model list";
      errors.push(`${family}: ${reason}`);
      return undefined;
    }
    return value;
  };
  const whisper = read("whisper") as ModelLists["whisper"];
  const parakeet = read("parakeet") as ModelLists["parakeet"];
  const llm = read("llm") as ModelLists["llm"];
  if (errors.length > 0) return { ok: false, error: errors.join("; ") };
  return { ok: true, ...summarizeModels({ whisper, parakeet, llm }) };
}

export function familyOutcome(
  family: ModelFamily,
  settled: PromiseSettledResult<unknown>
): FamilyOutcome {
  if (settled.status === "rejected") return { family, ok: false, error: errorText(settled.reason) };
  const value = settled.value;
  if (isObject(value) && value.success === true) return { family, ok: true };
  const error =
    isObject(value) && typeof value.error === "string" ? value.error : "no success result";
  return { family, ok: false, error };
}

export function modelsOutcome(
  before: number,
  families: FamilyOutcome[],
  remaining: number | null,
  recountError: string | null
): DeleteOutcome {
  const errors = families
    .filter((f) => f.ok === false)
    .map((f) => `${f.family}: ${f.error ?? "failed"}`);
  if (recountError !== null) errors.push(`recount-failed: ${recountError}`);
  return {
    ok: errors.length === 0 && remaining === 0,
    deleted: remaining === null ? null : Math.max(0, before - remaining),
    remaining,
    errors,
    families,
  };
}

function readResult(raw: unknown): DeleteOutcome | null {
  if (!isObject(raw)) return null;
  const { ok, deleted, remaining, errors } = raw;
  if (typeof ok !== "boolean" || !isCount(deleted) || !Array.isArray(errors)) return null;
  if (remaining !== null && !isCount(remaining)) return null;
  const list = errors.map(String);
  return {
    ok: ok === true && list.length === 0 && remaining === 0,
    deleted,
    remaining: remaining as number | null,
    errors: list,
  };
}

// Plan 02's audio fields (spec §5.6). Both are required: a result without
// them is not a result this build understands.
interface AudioErase {
  deleted: number;
  failed: number;
  readable: boolean;
  remaining: number | null;
}
function readAudioErase(raw: unknown): AudioErase | null {
  if (!isObject(raw)) return null;
  const { deleted, failed, readable, remaining } = raw;
  if (!isCount(deleted) || !isCount(failed) || typeof readable !== "boolean") return null;
  if (remaining !== null && !isCount(remaining)) return null;
  return { deleted, failed, readable, remaining: remaining as number | null };
}
// "Cleared" only when nothing failed, the folder was readable, and the
// counted set reads back readable and empty. An unreadable zero never is.
const audioCleared = (erase: AudioErase): boolean =>
  resolveClearAudioOutcome(
    { failed: erase.failed, readable: erase.readable },
    erase.remaining === null ? null : { fileCount: erase.remaining, readable: true }
  ) === "cleared";

const INVALID: DeleteOutcome = {
  ok: false,
  deleted: null,
  remaining: null,
  errors: ["invalid-result"],
};

export function outcomeFromResult(raw: unknown): DeleteOutcome {
  const rows = readResult(raw);
  const erase = readAudioErase(raw);
  if (!rows || !erase) return { ...INVALID, errors: [...INVALID.errors] };
  return { ...rows, ok: rows.ok === true && audioCleared(erase) };
}

export function historyOutcomeFromResult(raw: unknown): DeleteOutcome {
  const rows = readResult(raw);
  const audio = readAudioErase(isObject(raw) ? raw.audio : null);
  if (!rows || !audio) {
    return { ...INVALID, errors: [...INVALID.errors], audio: { deleted: null, remaining: null } };
  }
  return {
    ...rows,
    ok: rows.ok === true && audioCleared(audio),
    audio: { deleted: audio.deleted, remaining: audio.remaining },
  };
}

export function outcomeFromRejection(error: unknown, kind: StorageKind): DeleteOutcome {
  const outcome: DeleteOutcome = {
    ok: false,
    deleted: null,
    remaining: null,
    errors: [`ipc-failed: ${errorText(error)}`],
  };
  if (kind === "history") outcome.audio = { deleted: null, remaining: null };
  return outcome;
}

export function resetOutcome(raw: unknown): { ok: boolean; errors: string[] } {
  if (!isObject(raw)) return { ok: false, errors: ["reset-failed: no result"] };
  const errors = Array.isArray(raw.errors) ? raw.errors.map(String) : [];
  if (raw.success === true && errors.length === 0) return { ok: true, errors: [] };
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: false,
    errors: [`reset-failed: ${typeof raw.message === "string" ? raw.message : "unknown"}`],
  };
}

export function resetConfirmed(typed: string, word: string): boolean {
  const expected = word.trim().toLocaleLowerCase();
  return expected.length > 0 && typed.trim().toLocaleLowerCase() === expected;
}

export function snapshotCount(snapshot: StorageSnapshot): number {
  if (snapshot.kind === "audio") return snapshot.files;
  if (snapshot.kind === "history") return snapshot.total;
  return snapshot.count;
}

export function isEmptySnapshot(snapshot: StorageSnapshot): boolean {
  if (snapshot.kind === "history") return snapshot.total === 0 && snapshot.files === 0;
  return snapshotCount(snapshot) === 0;
}

// The audio row is Plan 02's useAudioStorageUsage state (spec §5.6): unavailable
// is an error row, never zero. Main must also provide a valid folder identity.
// Display may use hook counts; confirmation uses load()'s main snapshot.
export function audioRowFromUsage(
  usage: AudioUsage,
  preview: RowState<AudioSnapshot>
): RowState<AudioSnapshot> {
  if (usage.status === "loading") return { status: "loading" };
  if (usage.status === "unavailable") return { status: "error", error: "unavailable" };
  if (preview.status !== "ready") return preview;
  return {
    status: "ready",
    snapshot: { ...preview.snapshot, files: usage.fileCount, bytes: usage.totalBytes },
  };
}
