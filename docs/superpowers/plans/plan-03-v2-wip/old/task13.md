### Task 13: Settings search with live controls (SET-R2 A part 2)

Settings gets a search field at the top of the sidebar. ⌘F or Ctrl+F focuses it, and so does `/` when the user is not typing in another field.
- Results replace the content pane, grouped by section, each with a breadcrumb ("Privacy & Data › Retention").
- Results carry a **live control**: toggles switch in place, selects change in place, and route results show where the task runs right now.
- ↑/↓ move the active result, Enter jumps to the setting and flashes it once, and Esc clears the query (and only the next Esc closes Settings).
- No results reads: "No setting matches "xyz". Try "mic", "retention" or "cloud"."

The settings page stays mounted while search results show, so downloads and IPC listeners survive.

**Files:**
- Create: `src/components/settings/settingsRegistry.ts`
- Create: `src/components/settings/SettingsSearchResults.tsx`
- Create: `src/components/settings/SettingsSearchField.tsx`
- Modify: `src/components/ui/SettingsSection.tsx`. `SettingsPanelRow` accepts `settingId?: string` and renders `data-setting-id`.
- Modify: `src/components/ui/SidebarModal.tsx`. Add a `search?: ReactNode` slot above the nav.
- Modify: `src/components/SettingsModal.tsx`. Add query state, result navigation, the shortcuts, jump and flash, and hide (don't unmount) `SettingsPage` while a query is active.
- Modify: the anchor sites in the table in Step 3.4.
- Modify: `src/components/settings/routing/Patchbay.tsx`. Add ``data-setting-id={`route-${route.id}`}`` on each task row wrapper.
- Modify: `src/index.css`. Add the `[data-flash="true"]` rule.
- Modify: `src/locales/*/translation.json`
- Test: `test/components/settingsRegistry.test.js`, `test/components/settingsSearchResults.test.js`

**Interfaces:**
- Consumes:
  - `parseSettingsPath` (Task 3);
  - `useResolvedRoutes`, `RouteDestinationChip` and `RouteStateChip` (Tasks 2 and 4);
  - `ROUTE_IDS`;
  - the store booleans and setters listed in Step 3.1, each verified in `src/stores/settingsStore.ts` (field default line / setter implementation line):

    | Field | Default line | Setter | Setter line |
    |---|---|---|---|
    | `audioCuesEnabled` | `:1490` | `setAudioCuesEnabled` | `:2202` |
    | `notificationsEnabled` | `:1494` | `setNotificationsEnabled` | `:2238` |
    | `notifyMeetingDetection` | `:1495` | `setNotifyMeetingDetection` | `:2239` |
    | `notifyCalendarReminders` | `:1496` | `setNotifyCalendarReminders` | `:2240` |
    | `floatingIconAutoHide` | `:1492` | `setFloatingIconAutoHide` | `:2205` |
    | `startMinimized` | `:1493` | `setStartMinimized` | `:2214` |
    | `autoPasteEnabled` | `:1558` | `setAutoPasteEnabled` | `:2339` |
    | `keepTranscriptionInClipboard` | `:1559` | `setKeepTranscriptionInClipboard` | `:2340` |
    | `dataRetentionEnabled` | `:1488` | `setDataRetentionEnabled` | `:2190` |
    | `saveDiscardedTranscriptions` | `:1489` | `setSaveDiscardedTranscriptions` | `:2201` |
    | `speakerDiarizationEnabled` | `:1528` | `setSpeakerDiarizationEnabled` | `:2253` |
    | `theme` | `:1481` | `setTheme` | `:2179` |

    Also `useCleanupModel`, `useDictationTranslation` and `useDictationAgent`, with their `set…` setters.
- Produces:

  ```ts
  // settingsRegistry.ts
  export type SettingControl =
    | { kind: "toggle"; get: (s: SettingsState) => boolean; set: (s: SettingsState, value: boolean) => void }
    | { kind: "select"; get: (s: SettingsState) => string; set: (s: SettingsState, value: string) => void; options: { value: string; labelKey: string }[] }
    | { kind: "route"; routeId: RouteId }
    | { kind: "link" };
  export interface SettingEntry { id: string; path: string; labelKey: string; descriptionKey: string; keywords: string; control: SettingControl }
  export const SETTINGS_REGISTRY: readonly SettingEntry[];
  export interface SearchGroup { section: SettingsSectionType; entries: SettingEntry[] }
  export function normalizeForSearch(text: string): string;
  export function searchSettings(query: string, translate: (key: string) => string): SearchGroup[];
  export function anchorIdFor(entry: SettingEntry): string;   // entry.id, or "route-<id>" for route entries
  // SettingsSearchResults.tsx
  export function SettingsSearchResultsView(props: { query: string; groups: SearchGroup[]; activeId: string | null; onJump(entry: SettingEntry): void }): JSX.Element;
  export function SettingsSearchResults(props: { query: string; activeId: string | null; onJump(entry: SettingEntry): void }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/components/settingsRegistry.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const EN = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
const lookup = (json) => (key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), json) ?? key;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name)) out.push(fs.readFileSync(full, "utf8"));
  }
  return out;
}

test("settings registry", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-settings-registry-test-" });
  const r = await vite.ssrLoadModule("/components/settings/settingsRegistry.ts");
  const { parseSettingsPath } = await vite.ssrLoadModule("/lib/settingsPaths.ts");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const en = lookup(EN);
  const ids = (groups) => groups.flatMap((g) => g.entries.map((e) => e.id));

  await t.test("every entry is unique, reachable and labelled in English", () => {
    const seen = new Set();
    for (const e of r.SETTINGS_REGISTRY) {
      assert.ok(!seen.has(e.id), `duplicate ${e.id}`);
      seen.add(e.id);
      const head = e.path.split("/")[0];
      const loc = parseSettingsPath(e.path);
      assert.ok(head === loc.section || head === "stt", `${e.id} path ${e.path} resolves`);
      assert.notEqual(en(e.labelKey), e.labelKey, `${e.labelKey} exists`);
      assert.notEqual(en(e.descriptionKey), e.descriptionKey, `${e.descriptionKey} exists`);
    }
    assert.equal(r.SETTINGS_REGISTRY.filter((e) => e.control.kind === "route").length, 11);
  });

  await t.test("live toggles read real store booleans", () => {
    const state = useSettingsStore.getState();
    for (const e of r.SETTINGS_REGISTRY.filter((x) => x.control.kind === "toggle")) {
      assert.equal(typeof e.control.get(state), "boolean", e.id);
    }
  });

  await t.test("search matches label, description and keywords, AND-ing tokens", () => {
    assert.equal(ids(r.searchSettings("mic", en))[0], "microphone");
    const retention = r.searchSettings("retention", en);
    assert.deepEqual(retention.map((g) => g.section), ["privacyData"]);
    assert.ok(ids(retention).includes("audioRetention") && ids(retention).includes("transcriptRetention"));
    assert.ok(ids(r.searchSettings("audio retention", en)).includes("audioRetention"));
    assert.ok(!ids(r.searchSettings("audio retention", en)).includes("transcriptRetention"));
    assert.ok(ids(r.searchSettings("cloud", en)).some((id) => id.startsWith("route:")));
    assert.deepEqual(r.searchSettings("xyzzy", en), []);
    assert.deepEqual(r.searchSettings("   ", en), []);
  });

  await t.test("search works in the user's language and ignores accents", () => {
    const de = (key) => (key === "settingsSearch.items.microphone.label" ? "Mikrofon" : en(key));
    assert.equal(ids(r.searchSettings("mikro", de))[0], "microphone");
    assert.equal(r.normalizeForSearch("Résumé"), "resume");
  });

  await t.test("every non-route entry has an anchor in the source", () => {
    const src = walk(path.join(__dirname, "../../src")).join("\n");
    for (const e of r.SETTINGS_REGISTRY.filter((x) => x.control.kind !== "route")) {
      assert.ok(
        src.includes(`data-setting-id="${e.id}"`) || src.includes(`settingId="${e.id}"`),
        `anchor for ${e.id}`
      );
    }
    assert.ok(src.includes("data-setting-id={`route-${route.id}`}"), "patchbay rows are route anchors");
  });
});
```

Create `test/components/settingsSearchResults.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const { withI18nMock } = require("../lib/i18nTestMock");

test("search results", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-search-results-test-" }, { withOptions: true }));
  const { SettingsSearchResultsView } = await vite.ssrLoadModule("/components/settings/SettingsSearchResults.tsx");
  const { SETTINGS_REGISTRY } = await vite.ssrLoadModule("/components/settings/settingsRegistry.ts");
  const pick = (...ids) => SETTINGS_REGISTRY.filter((e) => ids.includes(e.id));

  await t.test("grouped results with breadcrumbs, an active row and live controls", () => {
    const html = renderToStaticMarkup(React.createElement(SettingsSearchResultsView, {
      query: "retention",
      groups: [{ section: "privacyData", entries: pick("audioRetention", "dataRetention") }],
      activeId: "dataRetention",
      onJump() {},
    }));
    assert.match(html, /settingsSearch\.count\{&quot;count&quot;:2\}/);
    assert.match(html, /settingsModal\.sections\.privacyData\.label/);
    assert.match(html, /data-result="dataRetention"[^>]*data-active="true"/);
    assert.match(html, /role="switch"/, "toggle entries render a live switch");
  });

  await t.test("no results suggests what to try", () => {
    const html = renderToStaticMarkup(React.createElement(SettingsSearchResultsView, { query: "xyz", groups: [], activeId: null, onJump() {} }));
    assert.match(html, /settingsSearch\.none\{&quot;query&quot;:&quot;xyz&quot;\}/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/settingsRegistry.test.js test/components/settingsSearchResults.test.js`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement**

1. Create `src/components/settings/settingsRegistry.ts`:

   ```ts
   import { parseSettingsPath } from "../../lib/settingsPaths";
   import { ROUTE_IDS, ROUTE_SETTINGS_PATH, type RouteId } from "../../lib/routes";
   import type { SettingsState } from "../../stores/settingsStore";
   import type { SettingsSectionType } from "../SettingsPage";

   // One declaration per searchable setting (SET-R2 A). Labels and
   // descriptions are i18n keys, so search works in the user's language;
   // keywords are language-neutral technical terms.

   export type SettingControl =
     | { kind: "toggle"; get: (s: SettingsState) => boolean; set: (s: SettingsState, value: boolean) => void }
     | {
         kind: "select";
         get: (s: SettingsState) => string;
         set: (s: SettingsState, value: string) => void;
         options: { value: string; labelKey: string }[];
       }
     | { kind: "route"; routeId: RouteId }
     | { kind: "link" };

   export interface SettingEntry {
     id: string;
     path: string;
     labelKey: string;
     descriptionKey: string;
     keywords: string;
     control: SettingControl;
   }

   const item = (id: string, path: string, keywords: string, control: SettingControl): SettingEntry => ({
     id,
     path,
     labelKey: `settingsSearch.items.${id}.label`,
     descriptionKey: `settingsSearch.items.${id}.description`,
     keywords,
     control,
   });
   const toggle = (get: (s: SettingsState) => boolean, set: (s: SettingsState, v: boolean) => void): SettingControl => ({
     kind: "toggle",
     get,
     set,
   });
   const link: SettingControl = { kind: "link" };

   export const SETTINGS_REGISTRY: readonly SettingEntry[] = [
     // Preferences
     item("theme", "general", "appearance dark light mode theme plum", {
       kind: "select",
       get: (s) => s.theme,
       set: (s, v) => s.setTheme(v as SettingsState["theme"]),
       options: [
         { value: "light", labelKey: "settingsSearch.options.theme.light" },
         { value: "dark", labelKey: "settingsSearch.options.theme.dark" },
         { value: "auto", labelKey: "settingsSearch.options.theme.auto" },
       ],
     }),
     item("audioCues", "general", "sound effects beep chime audio cues", toggle((s) => s.audioCuesEnabled, (s, v) => s.setAudioCuesEnabled(v))),
     item("notifications", "general", "notifications alerts", toggle((s) => s.notificationsEnabled, (s, v) => s.setNotificationsEnabled(v))),
     item("meetingDetection", "general", "meeting detection zoom facetime notify", toggle((s) => s.notifyMeetingDetection, (s, v) => s.setNotifyMeetingDetection(v))),
     item("calendarReminders", "general", "calendar reminders events notify", toggle((s) => s.notifyCalendarReminders, (s, v) => s.setNotifyCalendarReminders(v))),
     item("floatingIcon", "general", "floating icon pill hide", toggle((s) => s.floatingIconAutoHide, (s, v) => s.setFloatingIconAutoHide(v))),
     item("startMinimized", "general", "startup launch minimized", toggle((s) => s.startMinimized, (s, v) => s.setStartMinimized(v))),
     item("launchAtLogin", "general", "startup login autostart boot", link),
     item("uiLanguage", "general", "language locale interface ui", link),
     // Dictation (section id "hotkeys")
     item("dictationHotkey", "hotkeys", "hotkey shortcut keyboard push to talk tap hold", link),
     item("microphone", "hotkeys", "mic microphone input device audio", link),
     item("autoPaste", "hotkeys", "paste auto insert", toggle((s) => s.autoPasteEnabled, (s, v) => s.setAutoPasteEnabled(v))),
     item("keepInClipboard", "hotkeys", "clipboard copy restore", toggle((s) => s.keepTranscriptionInClipboard, (s, v) => s.setKeepTranscriptionInClipboard(v))),
     item("transcriptionLanguage", "hotkeys", "language speak transcription", link),
     item("autoLearn", "hotkeys", "dictionary auto learn corrections words", link),
     // Models
     item("cleanupEnabled", "llms/dictationCleanup", "cleanup filler grammar punctuation llm", toggle((s) => s.useCleanupModel, (s, v) => s.setUseCleanupModel(v))),
     item("assistantEnabled", "llms/dictationAgent", "voice assistant agent", toggle((s) => s.useDictationAgent, (s, v) => s.setUseDictationAgent(v))),
     item("screenContext", "llms/dictationAgent", "screen screenshot vision context", link),
     item("translationEnabled", "llms/dictationTranslation", "translate translation language", toggle((s) => s.useDictationTranslation, (s, v) => s.setUseDictationTranslation(v))),
     item("supportModels", "llms/supportModels", "speaker diarization embeddings semantic search local", link),
     item("speakerLabels", "stt/noteRecording", "speaker labels diarization meeting who", toggle((s) => s.speakerDiarizationEnabled, (s, v) => s.setSpeakerDiarizationEnabled(v))),
     item("keyring", "routing", "api key keys verify credentials provider rotate", link),
     // Privacy & Data
     item("audioRetention", "privacyData", "retention audio recordings delete keep", link),
     item("transcriptRetention", "privacyData", "retention transcripts history delete keep", link),
     item("dataRetention", "privacyData", "retention history save transcripts", toggle((s) => s.dataRetentionEnabled, (s, v) => s.setDataRetentionEnabled(v))),
     item("saveDiscarded", "privacyData", "discarded cancelled save", toggle((s) => s.saveDiscardedTranscriptions, (s, v) => s.setSaveDiscardedTranscriptions(v))),
     item("storage", "privacyData", "storage disk delete models audio reset", link),
     item("permissions", "privacyData", "permissions microphone accessibility screen recording", link),
     // System
     item("updates", "system", "updates version release check", link),
     item("debugLogging", "system", "debug logs logging developer", link),
     // Routes: one per task, shown with where it runs now.
     ...ROUTE_IDS.map((routeId) => ({
       id: `route:${routeId}`,
       path: "routing",
       labelKey: `routes.names.${routeId}`,
       descriptionKey: `routes.subtitles.${routeId}`,
       keywords: `route runs on local cloud provider server device ${ROUTE_SETTINGS_PATH[routeId].replace("/", " ")}`,
       control: { kind: "route", routeId } as SettingControl,
     })),
   ];

   export interface SearchGroup {
     section: SettingsSectionType;
     entries: SettingEntry[];
   }

   export function normalizeForSearch(text: string): string {
     return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
   }

   export function anchorIdFor(entry: SettingEntry): string {
     return entry.control.kind === "route" ? `route-${entry.control.routeId}` : entry.id;
   }

   export function searchSettings(query: string, translate: (key: string) => string): SearchGroup[] {
     const tokens = normalizeForSearch(query).split(/\s+/).filter(Boolean);
     if (tokens.length === 0) return [];
     const scored = SETTINGS_REGISTRY.map((entry, index) => {
       const section = parseSettingsPath(entry.path).section;
       const label = normalizeForSearch(translate(entry.labelKey));
       const haystack = normalizeForSearch(
         [translate(entry.labelKey), translate(entry.descriptionKey), translate(`settingsModal.sections.${section}.label`), entry.keywords].join(" ")
       );
       if (!tokens.every((tok) => haystack.includes(tok))) return null;
       // Label hits rank above description/keyword hits; registry order breaks ties.
       const score = tokens.filter((tok) => label.includes(tok)).length;
       return { entry, section, index, score };
     }).filter((x): x is NonNullable<typeof x> => x !== null);
     scored.sort((a, b) => b.score - a.score || a.index - b.index);
     const groups: SearchGroup[] = [];
     for (const s of scored) {
       const group = groups.find((g) => g.section === s.section);
       if (group) group.entries.push(s.entry);
       else groups.push({ section: s.section, entries: [s.entry] });
     }
     return groups;
   }
   ```

   In the first test, "mic" matches `microphone` (label hit) and also `permissions` (keyword "microphone"). The label score puts `microphone` first.

2. Create `src/components/settings/SettingsSearchResults.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { useResolvedRoutes } from "../../lib/routes";
   import { parseSettingsPath } from "../../lib/settingsPaths";
   import { useSettingsStore } from "../../stores/settingsStore";
   import { RouteDestinationChip, RouteStateChip } from "./routing/RouteChips";
   import { Toggle } from "../ui/toggle";
   import { searchSettings, type SearchGroup, type SettingEntry } from "./settingsRegistry";

   function LiveControl({ entry }: { entry: SettingEntry }) {
     const { t } = useTranslation();
     const settings = useSettingsStore();
     const routes = useResolvedRoutes();
     const label = t(entry.labelKey);
     const c = entry.control;
     if (c.kind === "toggle") return <Toggle checked={c.get(settings)} onChange={(v) => c.set(settings, v)} aria-label={label} />;
     if (c.kind === "select") {
       return (
         <select
           aria-label={label}
           value={c.get(settings)}
           onChange={(e) => c.set(settings, e.target.value)}
           className="h-7 rounded-md border border-border bg-background px-2 text-xs"
         >
           {c.options.map((o) => (
             <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
           ))}
         </select>
       );
     }
     if (c.kind === "route") {
       const route = routes.find((r) => r.id === c.routeId);
       return route ? (
         <span className="flex items-center gap-2">
           <RouteDestinationChip route={route} />
           <RouteStateChip state={route.state} />
         </span>
       ) : null;
     }
     return null;
   }

   export function SettingsSearchResultsView({
     query,
     groups,
     activeId,
     onJump,
   }: {
     query: string;
     groups: SearchGroup[];
     activeId: string | null;
     onJump: (entry: SettingEntry) => void;
   }) {
     const { t } = useTranslation();
     const count = groups.reduce((n, g) => n + g.entries.length, 0);
     if (count === 0) {
       return <p className="py-8 text-center text-sm text-muted-foreground">{t("settingsSearch.none", { query })}</p>;
     }
     return (
       <div className="space-y-4">
         <p aria-live="polite" className="text-xs text-muted-foreground">{t("settingsSearch.count", { count })}</p>
         {groups.map((group) => (
           <section key={group.section} className="space-y-1.5">
             <h3 className="text-[11px] font-semibold text-muted-foreground">{t(`settingsModal.sections.${group.section}.label`)}</h3>
             {group.entries.map((entry) => {
               const sub = parseSettingsPath(entry.path).subTab;
               return (
                 <div
                   key={entry.id}
                   data-result={entry.id}
                   data-active={activeId === entry.id ? "true" : "false"}
                   className="flex min-h-[52px] items-center gap-3 rounded-lg border border-border px-3 py-2 data-[active=true]:border-ring data-[active=true]:ring-2 data-[active=true]:ring-ring/30"
                 >
                   <button type="button" onClick={() => onJump(entry)} className="min-w-0 flex-1 text-start">
                     <span className="block text-[11px] text-muted-foreground">
                       {t(`settingsModal.sections.${group.section}.label`)}
                       {sub ? ` › ${t(`settingsSearch.subTabs.${sub}`)}` : ""}
                     </span>
                     <span className="block text-xs font-semibold">{t(entry.labelKey)}</span>
                     <span className="block truncate text-xs text-muted-foreground">{t(entry.descriptionKey)}</span>
                   </button>
                   <LiveControl entry={entry} />
                 </div>
               );
             })}
           </section>
         ))}
       </div>
     );
   }

   export function SettingsSearchResults(props: { query: string; activeId: string | null; onJump: (entry: SettingEntry) => void }) {
     const { t } = useTranslation();
     return <SettingsSearchResultsView {...props} groups={searchSettings(props.query, t)} />;
   }
   ```

   The view test passes `groups` directly, and `Toggle` renders `role="switch"`. `LiveControl` calls `useSettingsStore()` and `useResolvedRoutes()`, which work in SSR with the store's initial state.

3. Create `src/components/settings/SettingsSearchField.tsx`:

   ```tsx
   import { forwardRef } from "react";
   import { useTranslation } from "react-i18next";
   import { Search } from "../icons";

   const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

   export const SettingsSearchField = forwardRef<
     HTMLInputElement,
     { value: string; onChange: (v: string) => void; onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void }
   >(function SettingsSearchField({ value, onChange, onKeyDown }, ref) {
     const { t } = useTranslation();
     return (
       <div className="relative px-3 pt-3" data-escape-active={value ? "true" : "false"}>
         <Search className="pointer-events-none absolute start-5 top-1/2 mt-1.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
         <input
           ref={ref}
           type="search"
           value={value}
           onChange={(e) => onChange(e.target.value)}
           onKeyDown={onKeyDown}
           placeholder={t("settingsSearch.placeholder")}
           aria-label={t("settingsSearch.placeholder")}
           autoComplete="off"
           className="h-8 w-full rounded-lg border border-border bg-background ps-7 pe-10 text-xs focus-visible:outline-2 focus-visible:outline-ring"
         />
         <kbd aria-hidden="true" dir="ltr" className="pointer-events-none absolute end-5 top-1/2 mt-1.5 -translate-y-1/2 font-mono text-[10px] text-muted-foreground">
           {isMac ? "⌘F" : "Ctrl F"}
         </kbd>
       </div>
     );
   });
   ```

   In compact mode the sidebar is a 48px icon rail. `SidebarModal` then renders the `search` slot at the top of the content column, above the title bar, instead of in the sidebar. The ⌘F and `/` shortcuts work the same in both layouts, because `SettingsModal` owns them.

4. **Anchors.** Add a `settingId` prop to `SettingsPanelRow` in `ui/SettingsSection.tsx`:

   ```tsx
   export function SettingsPanelRow({ children, className = "", settingId }: { children: React.ReactNode; className?: string; settingId?: string }) {
     const { isCompact } = useSettingsLayout();
     return (
       <div data-setting-id={settingId} className={`${isCompact ? "px-3 py-2.5" : "px-4 py-3"} ${className}`}>
         {children}
       </div>
     );
   }
   ```

   Then put the anchor on the row or wrapper of each entry. Find each site by its marker:

   | id | File | Marker to find | Put on |
   |---|---|---|---|
   | theme | `SettingsPage.tsx` (general) | the Light/Dark/Auto segmented control | its `SettingsPanelRow settingId="theme"` |
   | audioCues | `SettingsPage.tsx` | `audioCuesEnabled` toggle | row |
   | notifications | `SettingsPage.tsx` | `notificationsEnabled` toggle | row |
   | meetingDetection | `SettingsPage.tsx` | `notifyMeetingDetection` | row |
   | calendarReminders | `SettingsPage.tsx` | `notifyCalendarReminders` | row |
   | floatingIcon | `SettingsPage.tsx` | `floatingIconAutoHide` | row |
   | startMinimized | `SettingsPage.tsx` | `startMinimized` toggle | row |
   | launchAtLogin | `SettingsPage.tsx` | `handleAutoStartChange` toggle | row |
   | uiLanguage | `SettingsPage.tsx` | `UI_LANGUAGE_OPTIONS` selector | row |
   | dictationHotkey | `SettingsPage.tsx` (hotkeys) | first `<HotkeyListInput` | its wrapper `<div data-setting-id="dictationHotkey">` |
   | microphone | `SettingsPage.tsx` (hotkeys after Task 12) | `<MicrophoneSettings` | wrapper `div` |
   | autoPaste | `SettingsPage.tsx` | `autoPasteEnabled` | row |
   | keepInClipboard | `SettingsPage.tsx` | `keepTranscriptionInClipboard` | row |
   | transcriptionLanguage | `SettingsPage.tsx` | `preferredLanguage` selector | row |
   | autoLearn | `SettingsPage.tsx` | `autoLearnCorrections` toggle | row |
   | cleanupEnabled | `SettingsPage.tsx` `AiModelsSection` | `useCleanupModel` toggle | row |
   | assistantEnabled | `settings/DictationAgentSettings.tsx` | `useDictationAgent` toggle | row |
   | screenContext | `settings/DictationAgentSettings.tsx` | `dictationAgent.screenContext.enable` | row |
   | translationEnabled | `settings/DictationTranslationSettings.tsx` | `useDictationTranslation` toggle | row |
   | supportModels | `settings/LocalSupportModels.tsx` | root `div` | `data-setting-id="supportModels"` |
   | speakerLabels | `settings/MeetingSettings.tsx:19-27` | `MeetingSpeakerDetectionRow` | row |
   | keyring | `settings/routing/KeyringPanel.tsx` | `<section aria-labelledby="keyring-title"` | `data-setting-id="keyring"` |
   | audioRetention | `SettingsPage.tsx` (privacyData) | audio-retention select | row |
   | transcriptRetention | `SettingsPage.tsx` | transcript-retention select | row |
   | dataRetention | `SettingsPage.tsx` | `dataRetentionEnabled` toggle | row |
   | saveDiscarded | `SettingsPage.tsx` | `saveDiscardedTranscriptions` toggle | row |
   | storage | `settings/StorageList.tsx` | `<section aria-labelledby="storage-title"` | `data-setting-id="storage"` |
   | permissions | `SettingsPage.tsx` | the permissions cards wrapper (`PermissionCard` group) | wrapper `div` |
   | updates | `settings/UpdateSettings.tsx` | root element | `data-setting-id="updates"` |
   | debugLogging | `DeveloperSection.tsx` | debug `Toggle` (`:147`) | its row |

   In `Patchbay.tsx`, add ``data-setting-id={`route-${route.id}`}`` to the `<div key={route.id} className="flex items-center gap-1">` wrapper of each task row.

5. **`SidebarModal`.** Add a `search?: ReactNode` prop. Render it above `<SettingsNav>` when `!isCompact`, and as the first child of the content column when `isCompact`.

6. **`SettingsModal`.** Add the search state and behaviour:

   ```tsx
   const { t } = useTranslation();
   const [query, setQuery] = useState("");
   const [activeIndex, setActiveIndex] = useState(0);
   const searchRef = useRef<HTMLInputElement>(null);
   const groups = useMemo(() => searchSettings(query, t), [query, t]);
   const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
   const activeId = flat[Math.min(activeIndex, flat.length - 1)]?.id ?? null;
   const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

   const jump = (entry: SettingEntry) => {
     setQuery("");
     handleNavigateToPath(entry.path);
     setPendingAnchor(anchorIdFor(entry));
   };

   useEffect(() => {
     if (!pendingAnchor) return;
     const frame = requestAnimationFrame(() => {
       const el = document.querySelector<HTMLElement>(`[data-setting-id="${CSS.escape(pendingAnchor)}"]`);
       if (el) {
         el.scrollIntoView({ block: "center" });
         el.dataset.flash = "true";
         window.setTimeout(() => delete el.dataset.flash, 1400);
       }
       setPendingAnchor(null);
     });
     return () => cancelAnimationFrame(frame);
   }, [pendingAnchor, activeSection]);

   useEffect(() => {
     if (!open) return;
     const onKey = (e: KeyboardEvent) => {
       const target = e.target as HTMLElement | null;
       const typing = !!target?.closest("input, textarea, select, [contenteditable=true]");
       if ((e.key === "f" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
         e.preventDefault();
         searchRef.current?.focus();
         searchRef.current?.select();
       }
     };
     document.addEventListener("keydown", onKey);
     return () => document.removeEventListener("keydown", onKey);
   }, [open]);

   const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
     if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, Math.max(0, flat.length - 1))); }
     else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); }
     else if (e.key === "Enter" && flat[activeIndex]) { e.preventDefault(); jump(flat[activeIndex]); }
     else if (e.key === "Escape" && query) { setQuery(""); }
   };
   ```

   - Pass `search={<SettingsSearchField ref={searchRef} value={query} onChange={(v) => { setQuery(v); setActiveIndex(0); }} onKeyDown={onSearchKey} />}` to `SidebarModal`.
   - Render the children as:

     ```tsx
     <>
       {query && <SettingsSearchResults query={query} activeId={activeId} onJump={jump} />}
       <div className={query ? "hidden" : undefined}>
         <SettingsPage … />
       </div>
     </>
     ```

   - Make `handleSectionChange` also call `setQuery("")`, so that clicking a nav item clears the search.

7. Append to `src/index.css`:

   ```css
   /* Settings search landing (SET-R2 A): flash the row once. */
   [data-setting-id][data-flash="true"] {
     animation: settings-flash 1.4s var(--motion-ease-std);
     outline: 2px solid var(--color-ring);
     outline-offset: 2px;
     border-radius: 8px;
   }
   @keyframes settings-flash {
     0%, 40% { background-color: color-mix(in srgb, var(--color-ring) 16%, transparent); }
     100% { background-color: transparent; }
   }
   @media (prefers-reduced-motion: reduce) {
     [data-setting-id][data-flash="true"] { animation: none; }
   }
   ```

   Under reduced motion the orange outline remains for 1.4 s and the background flash is dropped. Colour feedback without movement is allowed.

8. Write `/tmp/loqui-i18n-task-13.json` and merge it. The `en` block is below. `count` needs every plural category per locale. The `subTabs` labels reuse wording from the existing tab keys.

   ```json
   {
     "settingsSearch": {
       "placeholder": "Search settings",
       "count_one": "{{count}} result",
       "count_other": "{{count}} results",
       "none": "No setting matches “{{query}}”. Try “mic”, “retention” or “cloud”.",
       "subTabs": {
         "dictation": "Dictation", "noteRecording": "Note recording", "upload": "Audio upload",
         "dictationCleanup": "Cleanup", "dictationAgent": "Voice assistant", "dictationTranslation": "Translation",
         "noteFormatting": "Note formatting", "chatIntelligence": "Chat", "supportModels": "On-device support"
       },
       "options": { "theme": { "light": "Light", "dark": "Dark", "auto": "Match system" } },
       "items": {
         "theme": { "label": "Appearance", "description": "Light, dark or follow the system" },
         "audioCues": { "label": "Sound effects", "description": "Play a sound when dictation starts and stops" },
         "notifications": { "label": "Notifications", "description": "Allow Loqui to show notifications" },
         "meetingDetection": { "label": "Meeting detection", "description": "Notify me when a meeting app starts" },
         "calendarReminders": { "label": "Calendar reminders", "description": "Remind me before calendar events" },
         "floatingIcon": { "label": "Auto-hide floating icon", "description": "Hide the pill when Loqui is idle" },
         "startMinimized": { "label": "Start minimized", "description": "Open in the background at startup" },
         "launchAtLogin": { "label": "Launch at login", "description": "Start Loqui when you sign in" },
         "uiLanguage": { "label": "Interface language", "description": "The language Loqui's menus use" },
         "dictationHotkey": { "label": "Dictation hotkey", "description": "Tap to talk, hold to push-to-talk" },
         "microphone": { "label": "Microphone", "description": "Which input device Loqui records from" },
         "autoPaste": { "label": "Paste automatically", "description": "Insert the text where your cursor is" },
         "keepInClipboard": { "label": "Keep text in clipboard", "description": "Leave the dictated text on the clipboard after pasting" },
         "transcriptionLanguage": { "label": "Transcription language", "description": "The language you speak most" },
         "autoLearn": { "label": "Dictionary auto-learn", "description": "Add corrected words to your dictionary" },
         "cleanupEnabled": { "label": "Dictation cleanup", "description": "Fix fillers, grammar and punctuation" },
         "assistantEnabled": { "label": "Voice assistant", "description": "Ask by voice and get an answer" },
         "screenContext": { "label": "Screen context", "description": "Send a screenshot with assistant requests" },
         "translationEnabled": { "label": "Translation", "description": "Dictate in one language, paste in another" },
         "supportModels": { "label": "On-device support models", "description": "Speaker identification and semantic search" },
         "speakerLabels": { "label": "Speaker labels", "description": "Tell speakers apart in meeting notes" },
         "keyring": { "label": "Keyring", "description": "Saved provider keys and whether they still work" },
         "audioRetention": { "label": "Audio retention", "description": "How long dictation audio is kept" },
         "transcriptRetention": { "label": "Transcript retention", "description": "How long saved transcripts are kept" },
         "dataRetention": { "label": "Keep history", "description": "Save transcripts to your history" },
         "saveDiscarded": { "label": "Save discarded dictations", "description": "Keep dictations you cancelled" },
         "storage": { "label": "Storage", "description": "Audio, models and history on this device" },
         "permissions": { "label": "Permissions", "description": "Microphone, accessibility and screen recording" },
         "updates": { "label": "Updates", "description": "Check GitHub for new releases" },
         "debugLogging": { "label": "Debug logging", "description": "Write detailed logs to disk" }
       }
     }
   }
   ```

   Before merging, open each settings row these entries point to and check that the English label matches what the row says. If a row's own label is clearer, copy it here so search shows the same words as the page.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/settingsRegistry.test.js test/components/settingsSearchResults.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

Then check manually against card R2 A:
- ⌘F focuses search, and typing "mic" shows Microphone first.
- ↓ and Enter jump to Dictation and flash the row.
- Toggling "Sound effects" in the results flips it in place.
- Esc clears the query, and a second Esc closes Settings.
- Start a model download, search, then clear the search: the download progress is still there.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/settingsRegistry.ts src/components/settings/SettingsSearchResults.tsx src/components/settings/SettingsSearchField.tsx src/components/ui/SettingsSection.tsx src/components/ui/SidebarModal.tsx src/components/SettingsModal.tsx src/components/SettingsPage.tsx src/components/settings src/components/DeveloperSection.tsx src/index.css src/locales test/components/settingsRegistry.test.js test/components/settingsSearchResults.test.js
git commit -m "feat(settings): Search settings with live controls"
```

---

