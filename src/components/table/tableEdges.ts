import type { TableEntityRef } from "../../types/table";
import { parseMentionHref } from "../../utils/mentionMarkdown";

// Adapter over the spec §5.10 entity mention hrefs. Meetings are notes on
// the Table; folders and people are not cards, so they draw no connector.
export function parseEntityHref(href: string): TableEntityRef | null {
  const mention = parseMentionHref(href);
  const id = mention?.entityId != null ? Number(mention.entityId) : Number.NaN;
  if (!mention || !Number.isSafeInteger(id) || id <= 0) return null;
  if (mention.kind === "note" || mention.kind === "meeting") return { type: "note", id };
  if (mention.kind === "dictation") return { type: "dictation", id };
  return null;
}
