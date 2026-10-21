import type { TFunction } from "i18next";
import type { TableCardModel } from "./tableModel";
import { plainExcerpt } from "./tableModel";
import { formatMmSs } from "../../utils/formatDuration";

const EXCERPT = { note: 200, meeting: 160, dictation: 220, chat: 260 } as const;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

/** Identical text semantics for the React fallback and the live DOM owner. */
export function tableCardContent(card: TableCardModel, expanded: boolean, t: TFunction) {
  const { entity } = card;
  const kindLabel = t(`table.kind.${entity.kind}`);
  const title =
    entity.title?.trim() || (entity.kind === "dictation" ? "" : t("table.card.untitled"));
  const excerpt = entity.excerpt
    ? plainExcerpt(entity.excerpt, expanded ? 600 : EXCERPT[entity.kind])
    : entity.kind === "chat"
      ? t("table.card.answerPending")
      : "";
  return {
    kindLabel,
    title,
    excerpt,
    label: t("table.card.label", { kind: kindLabel, title: title || excerpt.slice(0, 60) }),
    participants: entity.participants.slice(0, 3).map(initials),
    duration: entity.durationMs == null ? null : formatMmSs(Math.round(entity.durationMs / 1000)),
  };
}
