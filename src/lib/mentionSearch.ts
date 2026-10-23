import type { FolderItem, NoteItem, TranscriptionItem } from "../types/electron";
import type { MentionEntity, MentionKind, MentionPerson } from "../utils/mentionMarkdown";

export const MENTION_GROUP_LIMIT = 3;
export const MENTION_GROUP_ORDER: readonly MentionKind[] = [
  "person",
  "note",
  "meeting",
  "dictation",
  "folder",
];

export interface MentionResult extends MentionEntity {
  key: string;
  meta: string | null;
}
export interface MentionGroup {
  kind: MentionKind;
  results: MentionResult[];
}
export interface MentionSources {
  people: MentionPerson[];
  searchContacts(query: string): Promise<Array<{ email: string; display_name: string | null }>>;
  searchNotes(query: string, limit: number): Promise<NoteItem[]>;
  recentNotes: NoteItem[];
  transcriptions: TranscriptionItem[];
  folders: FolderItem[];
  describe: {
    note(note: NoteItem): string;
    meeting(note: NoteItem): string;
    dictation(item: TranscriptionItem): string;
    folder(folder: FolderItem): string;
  };
}

const LABEL_MAX = 40;
function boundedPreview(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max - 1);
  if (/[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
  return `${text.slice(0, end)}…`;
}
export function dictationLabel(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return boundedPreview(clean, LABEL_MAX);
}

export function quoteExcerpt(text: string, max = 280): string {
  const plain = text
    .replace(/\[(@?[^\]]*)\]\([^)]*\)/g, "$1") // links and mentions keep their label
    .replace(/^[\s#>\-]+/gm, "") // line-leading heading, quote and list markers
    .replace(/[*_`~]+/g, "") // inline emphasis markers
    .replace(/\s+/g, " ")
    .trim();
  return boundedPreview(plain, max);
}

const includes = (haystack: string | null | undefined, needle: string) =>
  !needle || (haystack ?? "").toLocaleLowerCase().includes(needle);

export async function searchMentionEntities(
  query: string,
  sources: MentionSources,
  kinds: readonly MentionKind[] = MENTION_GROUP_ORDER
): Promise<MentionGroup[]> {
  const needle = query.trim().toLocaleLowerCase();
  const wants = (kind: MentionKind) => kinds.includes(kind);
  const [contacts, notes] = await Promise.allSettled([
    wants("person") && needle
      ? Promise.resolve().then(() => sources.searchContacts(needle))
      : Promise.resolve([]),
    wants("note") || wants("meeting")
      ? needle
        ? Promise.resolve().then(() => sources.searchNotes(needle, 8))
        : Promise.resolve(sources.recentNotes)
      : Promise.resolve([]),
  ]);

  const people = new Map<string, MentionResult>();
  const addPerson = (name: string, email: string | null) => {
    const key = (email ?? name).toLocaleLowerCase();
    if (people.has(key) || !(includes(name, needle) || includes(email, needle))) return;
    people.set(key, {
      key: `person-${key}`,
      kind: "person",
      label: name,
      entityId: null,
      email,
      meta: email,
    });
  };
  if (wants("person")) {
    for (const person of sources.people) addPerson(person.name, person.email);
    if (contacts.status === "fulfilled")
      for (const c of contacts.value) addPerson(c.display_name || c.email, c.email);
  }

  const noteRows = notes.status === "fulfilled" ? notes.value : [];
  const toNote = (note: NoteItem): MentionResult => {
    const kind = note.note_type === "meeting" ? "meeting" : "note";
    return {
      key: `${kind}-${note.id}`,
      kind,
      label: note.title || "",
      entityId: String(note.id),
      email: null,
      meta: kind === "meeting" ? sources.describe.meeting(note) : sources.describe.note(note),
    };
  };

  const byKind: Record<MentionKind, MentionResult[]> = {
    person: [...people.values()],
    note: wants("note")
      ? noteRows.filter((n) => !n.deleted_at && n.note_type !== "meeting").map(toNote)
      : [],
    meeting: wants("meeting")
      ? noteRows.filter((n) => !n.deleted_at && n.note_type === "meeting").map(toNote)
      : [],
    dictation: wants("dictation")
      ? sources.transcriptions
          .filter(
            (item) => !item.deleted_at && item.status !== "discarded" && includes(item.text, needle)
          )
          .map((item) => ({
            key: `dictation-${item.id}`,
            kind: "dictation" as const,
            label: dictationLabel(item.text),
            entityId: String(item.id),
            email: null,
            meta: sources.describe.dictation(item),
          }))
      : [],
    folder: wants("folder")
      ? sources.folders
          .filter((folder) => !folder.deleted_at && includes(folder.name, needle))
          .map((folder) => ({
            key: `folder-${folder.id}`,
            kind: "folder" as const,
            label: folder.name,
            entityId: String(folder.id),
            email: null,
            meta: sources.describe.folder(folder),
          }))
      : [],
  };

  return MENTION_GROUP_ORDER.filter(wants)
    .map((kind) => ({ kind, results: byKind[kind].slice(0, MENTION_GROUP_LIMIT) }))
    .filter((group) => group.results.length > 0);
}

export function flattenMentionGroups(groups: MentionGroup[]): MentionResult[] {
  return groups.flatMap((group) => group.results);
}
