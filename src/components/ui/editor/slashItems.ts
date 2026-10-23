import type { ActionItem } from "../../../types/electron";
import type { RouteState } from "../../../lib/routes";

export type SlashGroup = "text" | "ai" | "insert";
export type SlashItemId =
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "numbered"
  | "todo"
  | "quote"
  | "code"
  | "timestamp"
  | "dictation"
  | "mention"
  | "manageActions"
  | "setupAi"
  | `action-${number}`;

export interface SlashItem {
  id: SlashItemId;
  group: SlashGroup;
  label: string;
  keywords: readonly string[];
  actionId?: number;
  disabledReason?: string;
}

export interface SlashContext {
  items: SlashItem[];
  onRunAction(actionId: number): void;
  onManageActions(): void;
  onSetupAi(): void;
  onDictateHere(): void;
  formatTimestamp(date: Date): string;
}

/** The chain methods we call; ChainedCommands satisfies it structurally. */
export interface SlashChain {
  setNode(type: string, attrs?: Record<string, unknown>): SlashChain;
  toggleBulletList(): SlashChain;
  toggleOrderedList(): SlashChain;
  toggleTaskList(): SlashChain;
  toggleBlockquote(): SlashChain;
  toggleCodeBlock(): SlashChain;
  insertContent(content: string): SlashChain;
  run(): boolean;
}

const TEXT: ReadonlyArray<[SlashItemId, readonly string[]]> = [
  ["h1", ["heading", "title", "#"]],
  ["h2", ["heading", "subtitle", "##"]],
  ["h3", ["heading", "###"]],
  ["bullet", ["list", "ul", "-"]],
  ["numbered", ["list", "ol", "1."]],
  ["todo", ["todo", "task", "checkbox", "check"]],
  ["quote", ["blockquote", ">"]],
  ["code", ["snippet", "```"]],
];
const INSERT: ReadonlyArray<[SlashItemId, readonly string[]]> = [
  ["timestamp", ["time", "date", "now"]],
  ["dictation", ["dictate", "voice", "speak", "mic"]],
  ["mention", ["@", "person", "link"]],
];

export function buildSlashItems(input: {
  actions: ActionItem[];
  aiAvailable: boolean;
  aiUnavailableReason?: string;
  aiNeedsSetup?: boolean;
  t: (key: string, options?: { defaultValue: string }) => string;
}): SlashItem[] {
  const { t } = input;
  const reason = input.aiAvailable
    ? undefined
    : (input.aiUnavailableReason ?? t("notes.slash.aiNeedsModel"));
  const ai: SlashItem[] = [...input.actions]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((action) => ({
      id: `action-${action.id}` as const,
      group: "ai" as const,
      label: action.translation_key
        ? t(`${action.translation_key}.name`, { defaultValue: action.name })
        : action.name,
      keywords: ["ai", "action"],
      actionId: action.id,
      disabledReason: reason,
    }));
  if (input.aiNeedsSetup ?? !input.aiAvailable) {
    ai.unshift({
      id: "setupAi",
      group: "ai",
      label: t("notes.slash.setupAi"),
      keywords: ["setup", "model", "key", "ai"],
    });
  }
  ai.push({
    id: "manageActions",
    group: "ai",
    label: t("notes.slash.manageActions"),
    keywords: ["actions", "edit"],
  });
  return [
    ...TEXT.map(([id, keywords]) => ({
      id,
      group: "text" as const,
      label: t(`notes.slash.items.${id}`),
      keywords,
    })),
    ...ai,
    ...INSERT.map(([id, keywords]) => ({
      id,
      group: "insert" as const,
      label: t(`notes.slash.items.${id}`),
      keywords,
    })),
  ];
}

export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return items;
  return items.filter(
    (item) =>
      item.label.toLocaleLowerCase().includes(needle) ||
      item.keywords.some((keyword) => keyword.toLocaleLowerCase().startsWith(needle))
  );
}

export function groupSlashItems(
  items: SlashItem[]
): Array<{ group: SlashGroup; items: SlashItem[] }> {
  return (["text", "ai", "insert"] as const)
    .map((group) => ({ group, items: items.filter((item) => item.group === group) }))
    .filter((entry) => entry.items.length > 0);
}

// Readiness comes from the resolved noteFormatting route (§5.1), never from
// which cleanup model is selected (review I09).
export function noteAiReadiness(state: RouteState): {
  available: boolean;
  reasonKey: string | null;
  needsSetup: boolean;
} {
  if (state.status === "ready") return { available: true, reasonKey: null, needsSetup: false };
  // unknown: main has not confirmed yet (§5.1 rule 1). Disabled, never ready, and no "Set up" nag.
  if (state.status === "unknown")
    return { available: false, reasonKey: "notes.slash.ai.unknown", needsSetup: false };
  return { available: false, reasonKey: `notes.slash.ai.${state.status}`, needsSetup: true };
}

export interface SlashReadiness {
  aiAvailable: boolean;
  aiUnavailableReason?: string;
  aiNeedsSetup: boolean;
}

// Notes side of the boundary: the slash prop's readiness fields for a route state.
export function slashReadiness(state: RouteState, t: (key: string) => string): SlashReadiness {
  const ready = noteAiReadiness(state);
  return {
    aiAvailable: ready.available,
    aiUnavailableReason: ready.reasonKey ? t(ready.reasonKey) : undefined,
    aiNeedsSetup: ready.needsSetup,
  };
}

// Editor side of the boundary: the slash prop's readiness reaches
// buildSlashItems whole, so `unknown` never grows a setup item (I09-R2).
export function slashItemsFromProp(
  slash: { actions: ActionItem[] } & SlashReadiness,
  t: (key: string) => string
): SlashItem[] {
  const { actions, aiAvailable, aiUnavailableReason, aiNeedsSetup } = slash;
  return buildSlashItems({ actions, aiAvailable, aiUnavailableReason, aiNeedsSetup, t });
}

export function applySlashItem(
  item: SlashItem,
  chain: SlashChain,
  ctx: Pick<
    SlashContext,
    "onRunAction" | "onManageActions" | "onSetupAi" | "onDictateHere" | "formatTimestamp"
  >
): boolean {
  if (item.disabledReason) return false;
  switch (item.id) {
    case "h1":
      return chain.setNode("heading", { level: 1 }).run();
    case "h2":
      return chain.setNode("heading", { level: 2 }).run();
    case "h3":
      return chain.setNode("heading", { level: 3 }).run();
    case "bullet":
      return chain.toggleBulletList().run();
    case "numbered":
      return chain.toggleOrderedList().run();
    case "todo":
      return chain.toggleTaskList().run();
    case "quote":
      return chain.toggleBlockquote().run();
    case "code":
      return chain.toggleCodeBlock().run();
    case "timestamp":
      return chain.insertContent(`${ctx.formatTimestamp(new Date())} `).run();
    case "mention":
      return chain.insertContent("@").run();
    case "dictation":
      chain.run();
      ctx.onDictateHere();
      return true;
    case "manageActions":
      chain.run();
      ctx.onManageActions();
      return true;
    case "setupAi":
      chain.run();
      ctx.onSetupAi();
      return true;
    default:
      chain.run();
      if (item.actionId != null) ctx.onRunAction(item.actionId);
      return true;
  }
}
