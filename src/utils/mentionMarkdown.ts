export interface MentionPerson {
  name: string;
  email: string | null;
}

export const MENTION_HREF_PREFIX = "mention:";

const sanitizeLabel = (name: string) =>
  name
    .replace(/[[\]\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// encodeURIComponent leaves ( and ) alone, which would end the markdown link early.
const encodeMentionId = (id: string) =>
  encodeURIComponent(id).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** A mention serializes as a plain markdown link, so exports and other markdown
 * consumers degrade to a readable `@Name` link instead of losing the tag. */
export function buildMentionMarkdown(person: MentionPerson): string {
  const identityLabel = sanitizeLabel(person.name);
  const label = markdownLabel(person.name);
  return `[@${label}](${MENTION_HREF_PREFIX}${encodeMentionId(person.email || identityLabel)})`;
}

// Backslashes and inline formatting markers are escaped for display only. The
// sanitized, unescaped label remains the stable fallback identity for people.
const markdownLabel = (name: string) => sanitizeLabel(name).replace(/[\\*_`~]/g, "\\$&");

export function parseMentionEmail(href: string | null): string | null {
  if (!href?.startsWith(MENTION_HREF_PREFIX)) return null;
  try {
    const id = decodeURIComponent(href.slice(MENTION_HREF_PREFIX.length));
    return id.includes("@") ? id : null;
  } catch {
    return null;
  }
}

// WS-R7 B: notes, meetings, dictations and folders are mentionable too.
// Stored as ordinary Markdown links so exports remain readable; people keep
// their existing mention:<email|name> identity scheme.
export type MentionKind = "person" | "note" | "meeting" | "dictation" | "folder";
export const ENTITY_MENTION_KINDS = ["note", "meeting", "dictation", "folder"] as const;

export interface MentionEntity {
  kind: MentionKind;
  label: string;
  entityId: string | null;
  email: string | null;
}

const POSITIVE_INT = /^[1-9]\d*$/;

export function parseMentionHref(
  href: string | null | undefined
): Omit<MentionEntity, "label"> | null {
  if (!href) return null;
  if (href.startsWith(MENTION_HREF_PREFIX)) {
    return { kind: "person", entityId: null, email: parseMentionEmail(href) };
  }
  const colon = href.indexOf(":");
  const kind = href.slice(0, colon) as (typeof ENTITY_MENTION_KINDS)[number];
  const id = href.slice(colon + 1);
  if (colon < 1 || !ENTITY_MENTION_KINDS.includes(kind) || !POSITIVE_INT.test(id)) return null;
  return { kind, entityId: id, email: null };
}

export function mentionHref(entity: Omit<MentionEntity, "label"> & { label: string }): string {
  if (entity.kind === "person") {
    return `${MENTION_HREF_PREFIX}${encodeMentionId(entity.email || sanitizeLabel(entity.label))}`;
  }
  return `${entity.kind}:${entity.entityId}`;
}

export function buildEntityMentionMarkdown(entity: MentionEntity): string {
  if (entity.kind === "person")
    return buildMentionMarkdown({ name: entity.label, email: entity.email });
  const label = markdownLabel(entity.label);
  if (!entity.entityId || !POSITIVE_INT.test(entity.entityId)) return `@${label}`;
  return `[@${label}](${entity.kind}:${entity.entityId})`;
}

const TASK_OWNER_LINE = /^(\s*[-*]\s*\[[ xX]\]\s+\S.*?)(\s+[—–-]\s+)(\S.*?)\s*$/;
const OWNER_SPLIT = /\s*(?:,|&|\/|\band\b)\s*/i;

interface NameIndex {
  byFullName: Map<string, MentionPerson>;
  byFirstName: Map<string, MentionPerson | null>;
}

function buildNameIndex(people: MentionPerson[]): NameIndex {
  const byFullName = new Map<string, MentionPerson>();
  for (const person of people) {
    const name = sanitizeLabel(person.name).toLowerCase();
    if (name && !byFullName.has(name)) byFullName.set(name, person);
  }
  // First names resolve only when unambiguous across all known people.
  const byFirstName = new Map<string, MentionPerson | null>();
  for (const [fullName, person] of byFullName) {
    const first = fullName.split(" ")[0];
    byFirstName.set(first, byFirstName.has(first) ? null : person);
  }
  return { byFullName, byFirstName };
}

function matchOwner(raw: string, index: NameIndex): MentionPerson | null {
  const owner = raw.trim().replace(/^@/, "").replace(/[.:]$/, "").toLowerCase();
  if (!owner) return null;
  return index.byFullName.get(owner) ?? index.byFirstName.get(owner) ?? null;
}

/**
 * Converts the trailing owner of `- [ ] Action — Owner` checkbox lines into
 * mention links when the owner matches a known person, so generated action
 * items render as tagged owner chips in the editor. Lines with unknown or
 * ambiguous owners are left untouched.
 */
export function tagActionItemOwners(markdown: string, people: MentionPerson[]): string {
  if (!markdown || people.length === 0) return markdown;
  const index = buildNameIndex(people);
  if (index.byFullName.size === 0) return markdown;

  return markdown
    .split("\n")
    .map((line) => {
      if (line.includes(MENTION_HREF_PREFIX)) return line;
      const match = line.match(TASK_OWNER_LINE);
      if (!match) return line;
      const [, task, separator, ownerText] = match;
      const parts = ownerText.split(OWNER_SPLIT).filter(Boolean);
      if (parts.length === 0) return line;
      const owners = parts.map((part) => matchOwner(part, index));
      if (owners.some((owner) => owner == null)) return line;
      return `${task}${separator}${owners
        .map((owner) => buildMentionMarkdown(owner as MentionPerson))
        .join(", ")}`;
    })
    .join("\n");
}
