const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(rel, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// Every Settings component Plan 03 creates or edits: the whole settings/ directory (so new files are
// covered automatically) plus the existing components this plan changes.
// DeveloperSection is not edited by an earlier task, but it renders inside Settings → System, so it is held
// to the same roles (Step 3 fixes its one site).
const EXTRA = [
  "src/components/SettingsPage.tsx", // Tasks 4, 5, 8, 9, 10, 14, 15, 17
  "src/components/SettingsModal.tsx", // Tasks 4, 8, 10, 16
  "src/components/DeveloperSection.tsx",
  "src/components/CodexConnection.tsx", // Task 9
  "src/components/DictionaryHeaderActions.tsx", // Task 17 (new)
  "src/components/DictionaryView.tsx", // Task 17
  "src/components/EnterpriseProviderConfig.tsx", // Tasks 2, 12
  "src/components/LocalModelPicker.tsx", // Task 13
  "src/components/OpenAICompatiblePanel.tsx", // Task 9
  "src/components/ReasoningModelSelector.tsx", // Tasks 9, 12, 13
  "src/components/SelfHostedPanel.tsx", // Task 9
  "src/components/TranscriptionModelPicker.tsx", // Tasks 9, 12, 13, 17
  "src/components/ui/ApiKeyInput.tsx", // Tasks 2, 12
  "src/components/ui/ModelCardList.tsx", // Task 5
  "src/components/ui/ModelCartridgeGrid.tsx", // Task 13 (new)
  "src/components/ui/SettingsNav.tsx", // Task 15 (new)
  "src/components/ui/SettingsSection.tsx", // Tasks 5, 15, 16
  "src/components/ui/SettingsTitleBar.tsx", // Task 15 (new)
  "src/components/ui/SidebarModal.tsx", // Tasks 8, 10, 15, 16
];
const FILES = [
  ...new Set([
    ...sourceFiles("src/components/settings"),
    ...EXTRA.filter((f) => fs.existsSync(path.join(root, f))),
  ]),
].sort();

// A status glyph on the same line is a graphic (3:1 needed), not text (4.5:1).
const ICON_TAG =
  /<(?:Check|CheckCircle2?|CircleAlert|CircleCheck|AlertTriangle|AlertCircle|Info)\b/;

// Buttons whose variant paints bg-muted on hover (outline, secondary, ghost), found with a small JSX
// tag scanner because attribute values contain "=>" and braces.
function openingTags(src, name) {
  const tags = [];
  const needle = `<${name}`;
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) {
    if (!/[\s>/]/.test(src[i + needle.length])) {
      i += needle.length;
      continue;
    }
    let depth = 0;
    let quote = null;
    let j = i + needle.length;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (quote) {
        if (ch === quote && src[j - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    tags.push(src.slice(i, j + 1));
    i = j + 1;
  }
  return tags;
}

test("[baseline guard] the guard covers every component file Plan 03 creates, plus the support-model row", () => {
  // Every .tsx file Tasks 4-17 create (their "Create:" lines), and LocalSupportModels (Task 4 edits it).
  // A missing file means a task was skipped or renamed its output: fix the task, not this list.
  for (const required of [
    "src/components/settings/LocalSupportModels.tsx", // Task 4
    "src/components/settings/routing/RouteChips.tsx", // Task 5
    "src/components/settings/routing/EndpointDraft.tsx", // Task 8
    "src/components/settings/routing/StagedRouteBar.tsx", // Task 8
    "src/components/settings/routing/StagedRoutePanel.tsx", // Task 8
    "src/components/settings/routing/RouteSwitch.tsx", // Task 8
    "src/components/settings/routing/Patchbay.tsx", // Task 10
    "src/components/settings/routing/RoutingSection.tsx", // Task 10
    "src/components/settings/routing/KeyringPanel.tsx", // Task 12
    "src/components/ui/ModelCartridgeGrid.tsx", // Task 13
    "src/components/settings/StorageList.tsx", // Task 14
    "src/components/ui/SettingsNav.tsx", // Task 15
    "src/components/ui/SettingsTitleBar.tsx", // Task 15
    "src/components/settings/SettingsSearchField.tsx", // Task 16
    "src/components/settings/SettingsSearchResults.tsx", // Task 16
    "src/components/DictionaryHeaderActions.tsx", // Task 17
  ]) {
    assert.ok(FILES.includes(required), `${required} is guarded`);
  }
});

test("[baseline guard] settings text never uses the low-contrast success/warning colours", () => {
  const offenders = [];
  for (const file of FILES) {
    read(file)
      .split("\n")
      .forEach((line, index) => {
        if (/\btext-(?:success|warning)\b/.test(line) && !ICON_TAG.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
  }
  assert.deepEqual(
    offenders,
    [],
    "text-success is 3.30:1 on white; use text-foreground, or text-locality-device for 'on this device'"
  );
});

test("[baseline guard] support-model status uses the device locality role, never success", () => {
  const src = read("src/components/settings/LocalSupportModels.tsx");
  assert.match(src, /\btext-locality-device\b/);
  assert.doesNotMatch(src, /\btext-success\b/);
});

test("[baseline guard] solid warning fills and orange 'live' stay out of Settings", () => {
  for (const file of FILES) {
    const src = read(file);
    assert.doesNotMatch(
      src,
      /\bbg-warning(?![\w/-])/,
      `${file}: bg-warning is 2.92:1 on #f5f5f5; amber dots use bg-locality-remote`
    );
    assert.doesNotMatch(
      src,
      /variant="live"|\b(?:bg|text|border)-live\b/,
      `${file}: orange means live voice only`
    );
  }
});

test("[baseline guard] locality is drawn with the locality roles, not ad-hoc greens and ambers", () => {
  for (const file of FILES)
    assert.doesNotMatch(read(file), /#(?:22A559|E39B14|0f9f6e|b45309)/i, file);
});

test("[baseline guard] destructive text never sits on a #f5f5f5 surface class", () => {
  const offenders = [];
  for (const file of FILES) {
    for (const match of read(file).matchAll(
      /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g
    )) {
      const cls = match[1] ?? match[2] ?? match[3];
      // Light-theme greys: #f5f5f5 (muted, secondary, surface-3) is 4.43:1 and #f0f0f0 (surface-raised) is 4.24:1
      // for #dc2626. Variants such as dark: and md: are skipped (the lookbehind rejects any other prefix).
      const grey =
        /(?<![\w:-])(?:hover:)?bg-(?:muted|secondary|surface-3|surface-raised)(?![\w/-])/.test(cls);
      if (grey && /(?<![\w:-])(?:hover:)?text-destructive(?![\w/-])/.test(cls))
        offenders.push(`${file}: ${cls}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("[baseline guard] destructive text on outline, secondary and ghost Buttons carries hover:bg-background", () => {
  // button.tsx paints hover:bg-muted on these variants; #dc2626 on #f5f5f5 is 4.43:1.
  const offenders = [];
  for (const file of FILES) {
    for (const tag of openingTags(read(file), "Button")) {
      const variant = tag.match(/variant="([^"]+)"/)?.[1];
      if (!["outline", "secondary", "ghost"].includes(variant)) continue;
      if (/\btext-destructive\b/.test(tag) && !/\bhover:bg-background\b/.test(tag)) {
        offenders.push(`${file}: ${tag.replace(/\s+/g, " ").slice(0, 140)}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

// Task 10's destinations.ts sorts provider cards by the English name so the order is stable across
// languages; it never renders it (its own source guard bans providerDisplayName( in Patchbay.tsx).
const SORT_KEY_ONLY = new Set(["src/components/settings/routing/destinations.ts"]);

test("[baseline guard] provider names in UI come from providerDisplayLabel, never the English providerDisplayName", () => {
  for (const file of [...sourceFiles("src/components"), ...sourceFiles("src/hooks")]) {
    const src = stripComments(read(file));
    assert.doesNotMatch(
      src,
      /\broute\.provider\b/,
      `${file}: render route.providerId through providerDisplayLabel`
    );
    if (SORT_KEY_ONLY.has(file)) {
      const uses = src.split("\n").filter((line) => /\bproviderDisplayName\b/.test(line));
      for (const line of uses) {
        assert.ok(
          /\bimport\b|localeCompare/.test(line),
          `${file}: providerDisplayName only as a sort key: ${line.trim()}`
        );
      }
      continue;
    }
    assert.doesNotMatch(
      src,
      /\bproviderDisplayName\b/,
      `${file}: logs only; UI calls providerDisplayLabel(id, t)`
    );
  }
});
