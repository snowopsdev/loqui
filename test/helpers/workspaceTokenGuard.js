// Workspace token guard (Plan 06, CR-06-6). One rule set for D1 (orange means
// live voice), the WS-R11 B type ramp and the spec §4 contrast floors.
// Opt-out for a justified line: a trailing comment
//   // token-guard: allow <rule-id> — <reason>
// on the same line. The reason is required, and reviewers read it.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "../..");

const LINE_RULES = [
  {
    id: "arbitrary-size",
    why: "arbitrary pixel font size; use the ramp (text-micro … text-display)",
    re: /\btext-\[\d+(?:\.\d+)?px\]/g,
  },
  {
    id: "faded-muted",
    why: "faded metadata; use full text-muted-foreground",
    re: /\btext-muted-foreground\/\d+/g,
  },
  {
    id: "faded-foreground",
    why: "foreground below 70% falls under 4.5:1; use text-muted-foreground",
    re: /\btext-foreground\/(?:[0-6]?\d)\b(?!\d)/g,
  },
  {
    id: "orange-text",
    why: "orange text on light; use text-link",
    re: /\btext-primary\b(?!-foreground)/g,
  },
  {
    id: "orange-fill",
    why: "orange fill outside live voice (D1); neutral, or bg-live on voice controls",
    re: /\bbg-primary\b/g,
  },
  {
    id: "raw-amber",
    why: "raw amber; use the warning tokens",
    re: /\b(?:text|bg|border)-amber-\d+/g,
  },
  { id: "glyph-icon", why: "text glyph used as an icon; use a Lucide icon and a word", re: /⊘/g },
  {
    id: "provider-name",
    why: "providerDisplayName is for logs; use providerDisplayLabel(providerId, t)",
    re: /\bproviderDisplayName\s*\(/g,
  },
  {
    id: "faded-ring",
    why: "translucent focus ring is under 3:1; use ring-2 ring-ring (Plan 02)",
    re: /\bring-(?:ring|primary)\/\d+/g,
  },
  {
    id: "live-glass",
    why: "orange glass outside a voice control (D1)",
    re: /\b(?:GRADIENT_CIRCLE|BRAND_GLASS_SURFACE)\b|gradient-brand-glass/g,
  },
];

// Files whose glass is on voice controls only (mic, voice stop).
const LIVE_GLASS_ALLOWED = new Set(["src/components/chat/ChatInput.tsx"]);

// Default (ink) Buttons are text only: Plan 01's brand dot already leads.
const BUTTON_WITH_LEADING_ICON = /<Button\b((?:[^>{]|\{[^}]*\})*)>\s*<([A-Z][A-Za-z0-9]*)\b/g;

const dir = (d) =>
  fs.existsSync(path.join(ROOT, d))
    ? fs
        .readdirSync(path.join(ROOT, d))
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `${d}/${f}`)
    : [];

// Every workspace screen and the components they own. Dictionary and Snippets
// are in scope for tokens only; Plan 03 owns their header and import changes.
const WORKSPACE_GUARDED_FILES = [
  "src/components/ControlPanel.tsx",
  "src/components/ControlPanelSidebar.tsx",
  "src/components/ControlPanelTopBar.tsx",
  "src/components/HistoryView.tsx",
  "src/components/CommandSearch.tsx",
  "src/components/UpcomingMeetings.tsx",
  "src/components/InsightsView.tsx",
  "src/components/IntegrationsView.tsx",
  "src/components/DictionaryView.tsx",
  "src/components/SnippetsView.tsx",
  "src/components/CaptureMenu.tsx",
  "src/components/CaptureControl.tsx",
  "src/components/MicStatusCard.tsx",
  "src/components/ui/TranscriptionItem.tsx",
  "src/components/ui/EmptyStateCard.tsx",
  "src/components/ui/DataRetentionNotice.tsx",
  "src/components/ui/MentionSuggestions.tsx",
  "src/components/ui/MentionChip.tsx",
  "src/components/ui/MentionHoverCard.tsx",
  "src/components/notes/NoteEditor.tsx",
  "src/components/notes/NoteBottomBar.tsx",
  "src/components/notes/PersonalNotesView.tsx",
  "src/components/notes/SpacesTree.tsx",
  "src/components/notes/UploadAudioView.tsx",
  "src/components/notes/UploadDropZone.tsx",
  ...dir("src/components/chat"),
  ...dir("src/components/table"),
  ...dir("src/components/home"),
  ...dir("src/components/insights"),
  ...dir("src/components/ui/editor"),
];

const ALLOW = /token-guard:\s*allow\s+([\w-]+)\s+—\s+\S/;

function scanText(file, text) {
  const out = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const allowed = line.match(ALLOW)?.[1];
    for (const rule of LINE_RULES) {
      if (rule.id === allowed) continue;
      if (rule.id === "live-glass" && LIVE_GLASS_ALLOWED.has(file)) continue;
      for (const match of line.matchAll(rule.re))
        out.push(`${file}:${index + 1} ${match[0]} — ${rule.id}: ${rule.why}`);
    }
  });
  for (const match of text.matchAll(BUTTON_WITH_LEADING_ICON)) {
    const attrs = match[1];
    if (/\bvariant=/.test(attrs) && !/variant="default"/.test(attrs)) continue;
    const lineNo = text.slice(0, match.index).split("\n").length;
    if (ALLOW.exec(lines[lineNo - 1])?.[1] === "icon-cta") continue;
    out.push(
      `${file}:${lineNo} <Button> + <${match[2]}> — icon-cta: default Buttons are text only; use variant="live" (voice) or "secondary"/"outline"`
    );
  }
  return out;
}

/** Scan repo-relative files; missing files are skipped. Returns violations. */
function scanFiles(files) {
  return files.flatMap((file) => {
    const full = path.join(ROOT, file);
    return fs.existsSync(full) ? scanText(file, fs.readFileSync(full, "utf8")) : [];
  });
}

module.exports = { LINE_RULES, LIVE_GLASS_ALLOWED, WORKSPACE_GUARDED_FILES, scanText, scanFiles };
