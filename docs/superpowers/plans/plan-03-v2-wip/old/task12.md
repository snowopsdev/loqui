### Task 12: Re-home the sections, render nav descriptions, sticky title and close (SET-R2 A part 1, SET-Q3, SET-Q18, SET-Q21)

The sections stay the same six plus Routing, but blocks move to where people look for them (SET-07):
- **Hotkeys becomes "Dictation"** (id `hotkeys` is kept, so no deep link breaks). It holds hotkeys and activation, plus microphone, paste and clipboard, transcription language and Chinese script, dictionary auto-learn, and the Linux/Wayland paste diagnostics.
- **Preferences** keeps appearance, interface language, sounds, notifications, startup, floating icon, note files and Granola import.
- Privacy & Data and System were already re-homed in Tasks 3 and 11.

The nav descriptions, written but never shown (SET-Q3), render as a second line on wide windows and as a tooltip in the compact rail. The content column gets a sticky title row with a 32×32 close button at 70% opacity (SET-Q21). The duplicated settings primitives in `SettingsPage.tsx` are deleted (SET-Q18).

**Files:**
- Create: `src/components/ui/SettingsNav.tsx` (extracted from `SidebarModal.tsx:140-215`) and `src/components/ui/SettingsTitleBar.tsx`
- Modify: `src/components/ui/SidebarModal.tsx`. Use both, and move the close button (`:135-138`) into the title bar.
- Modify: `src/components/ui/SettingsSection.tsx:100-109`. In `SectionHeader`, make `title` optional and add `note?: string | false`.
- Modify: `src/components/SettingsPage.tsx`:
  - delete `SettingsPanel`, `SettingsPanelRow` and `SectionHeader` (`:142-190`), and import them from `./ui/SettingsSection` (`:92`);
  - move these blocks from `case "general"` to the end of `case "hotkeys"`:
    - Clipboard (`:1763-1788`);
    - the transcription-language and Chinese-script part of Language (`:1915-1958`; the UI-language selector at `:1894-1913` stays);
    - Microphone (`:2013-2031`);
    - Dictionary auto-learn (`:2032-2054`);
    - Linux/Wayland paste diagnostics (`:2059-2550`).
  - drop the `title` from the first `SectionHeader` of `SpeechToTextTabs` and `LlmsTabs`, keeping the description.
- Modify: `src/components/settings/routing/RoutingSection.tsx`. Drop the `SectionHeader` title.
- Modify: `src/locales/*/translation.json`. Update the `settingsModal.sections.*.label` and `.description` values.
- Test: `test/components/settingsNav.test.js`, `test/components/settingsRehoming.test.js`

Line numbers drift after Tasks 3, 6 and 11 edit this file. Find each block by the anchors quoted below rather than by number:
- `{/* Dictionary */}`
- `<MicrophoneSettings`
- `keepTranscriptionInClipboard`
- `settingsPage.general.language`
- the Linux/Wayland IIFE that starts with `{(() => {` right after the dictionary block.

**Interfaces:**
- Produces:

  ```tsx
  export function SettingsNav<T extends string>(props: { items: SidebarItem<T>[]; activeSection: T; onSectionChange(id: T): void; isCompact: boolean }): JSX.Element;
  export function SettingsTitleBar(props: { title: string; close: React.ReactNode }): JSX.Element;
  // SectionHeader: { title?: string; description?: string; note?: string | false }
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/components/settingsNav.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("settings nav and title bar", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-settings-nav-test-" }));
  const { SettingsNav } = await vite.ssrLoadModule("/components/ui/SettingsNav.tsx");
  const { SettingsTitleBar } = await vite.ssrLoadModule("/components/ui/SettingsTitleBar.tsx");
  const Icon = () => null;
  const items = [
    { id: "general", label: "Preferences", description: "Appearance, sounds, startup", icon: Icon, group: "App" },
    { id: "routing", label: "Routing", description: "Where each task runs", icon: Icon, group: "AI Models" },
  ];

  await t.test("descriptions render as a second line on wide windows", () => {
    const html = renderToStaticMarkup(React.createElement(SettingsNav, { items, activeSection: "routing", onSectionChange() {}, isCompact: false }));
    assert.match(html, /class="[^"]*hidden[^"]*min-\[1000px\]:block[^"]*"[^>]*>Where each task runs</);
    assert.match(html, /data-section-id="routing"[^>]*aria-current="page"/);
  });

  await t.test("the compact rail keeps the description as a tooltip", () => {
    const html = renderToStaticMarkup(React.createElement(SettingsNav, { items, activeSection: "general", onSectionChange() {}, isCompact: true }));
    assert.match(html, /title="Routing — Where each task runs"/);
    assert.doesNotMatch(html, />Where each task runs</);
  });

  await t.test("the title bar is sticky and the close target is 32px at 70% opacity", () => {
    const html = renderToStaticMarkup(React.createElement(SettingsTitleBar, {
      title: "Routing",
      close: React.createElement("button", { className: "settings-close" }, "x"),
    }));
    assert.match(html, /class="[^"]*sticky top-0[^"]*"/);
    assert.match(html, /<h2[^>]*>Routing<\/h2>/);
    assert.match(html, /settings-close/);
  });
});
```

Create `test/components/settingsRehoming.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const src = fs.readFileSync(path.join(__dirname, "../../src/components/SettingsPage.tsx"), "utf8");
const between = (start, end) => {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `${start} … ${end}`);
  return src.slice(a, b);
};

test("dictation controls live in the Dictation section, not in Preferences", () => {
  const general = between('case "general":', 'case "hotkeys":');
  const dictation = between('case "hotkeys":', 'case "routing":');
  for (const marker of ["<MicrophoneSettings", "keepTranscriptionInClipboard", "autoLearnCorrections", "preferredLanguage"]) {
    assert.ok(!general.includes(marker), `${marker} left Preferences`);
    assert.ok(dictation.includes(marker), `${marker} is in Dictation`);
  }
  assert.ok(general.includes("uiLanguage") || general.includes("UI_LANGUAGE_OPTIONS"), "interface language stays in Preferences");
});

test("settings primitives are imported, not re-declared", () => {
  assert.doesNotMatch(src, /^function SettingsPanel\(/m);
  assert.doesNotMatch(src, /^function SettingsPanelRow\(/m);
  assert.doesNotMatch(src, /^function SectionHeader\(/m);
  assert.match(src, /import \{[^}]*SectionHeader[^}]*\} from "\.\/ui\/SettingsSection"/);
});

test("section labels and descriptions match the re-homed contents", () => {
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
  const s = en.settingsModal.sections;
  assert.equal(s.hotkeys.label, "Dictation");
  assert.equal(s.hotkeys.description, "Hotkeys, microphone, paste, language");
  assert.doesNotMatch(s.privacyData.description, /analytics/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/settingsNav.test.js test/components/settingsRehoming.test.js`
Expected: FAIL. The modules are missing, the blocks are still in `general`, and the primitives are still declared.

- [ ] **Step 3: Implement**

1. **`SectionHeader`** (`ui/SettingsSection.tsx:100-109`). Make `title` optional, render the `<h3>` only when it is present, and add the `note` line exactly as the local copy at `SettingsPage.tsx:172-190` renders it:

   ```tsx
   export function SectionHeader({ title, description, note }: { title?: string; description?: string; note?: string | false }) {
     return (
       <div className="mb-3">
         {title && <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>}
         {description && <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">{description}</p>}
         {note && <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">{note}</p>}
       </div>
     );
   }
   ```

   Keep the exact `h3` and `p` class strings the file already uses. The block above shows the structure; copy the classes from the existing exported `SectionHeader`.

2. **Delete the duplicates** in `SettingsPage.tsx:142-190`. Change the import at `:92` to `import { InferenceModeSelector, SectionHeader, SettingsPanel, SettingsPanelRow, SettingsRow } from "./ui/SettingsSection";`, and drop the `useSettingsLayout` import (`:95`) if nothing else uses it.

3. **Move the blocks** listed under Files, cut and paste verbatim, to the end of the `hotkeys` case's returned fragment (just before its closing `</div>`). They read component-scope state, so no props change. Keep their order: Microphone, Clipboard, Transcription language, Dictionary auto-learn, Linux paste diagnostics.

4. **Create `src/components/ui/SettingsNav.tsx`.** Move the nav markup from `SidebarModal.tsx:140-215` (groups, group labels and buttons) and change the button. Keep Plan 02's SET-Q1 `aria-current` and focus-visible ring if present; the test requires `aria-current="page"` either way.

   ```tsx
   <button
     key={item.id}
     data-section-id={item.id}
     aria-current={isActive ? "page" : undefined}
     onClick={() => onSectionChange(item.id)}
     title={isCompact ? (item.description ? `${item.label} — ${item.description}` : item.label) : undefined}
     className={`group relative w-full flex items-center text-start text-xs rounded-md transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
       isCompact ? "justify-center px-0 py-2" : "gap-2 px-2 py-1.5"
     } ${
       isActive
         ? "text-foreground bg-muted dark:bg-surface-raised"
         : "text-muted-foreground dark:text-foreground/75 hover:text-foreground hover:bg-muted/50 dark:hover:bg-surface-2"
     }`}
   >
     <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
     {!isCompact && (
       <span className="min-w-0 flex-1">
         <span className={`block truncate leading-tight ${isActive ? "font-medium" : "font-normal"}`}>{item.label}</span>
         {item.description && (
           <span className="hidden min-[1000px]:block truncate text-[11px] leading-tight text-muted-foreground">
             {item.description}
           </span>
         )}
       </span>
     )}
     {!isCompact && renderBadge(item)}
   </button>
   ```

   Move `renderBadge` and the shortcut `<kbd>` with it, unchanged. `SidebarModal` then renders `<SettingsNav items={sidebarItems} activeSection={activeSection} onSectionChange={onSectionChange} isCompact={isCompact} />` where the old nav was.

5. **Create `src/components/ui/SettingsTitleBar.tsx`:**

   ```tsx
   import type { ReactNode } from "react";

   export function SettingsTitleBar({ title, close }: { title: string; close: ReactNode }) {
     return (
       <div className="sticky top-0 z-20 -mx-6 mb-4 flex items-center justify-between gap-3 border-b border-border/60 bg-background/90 px-6 py-3 backdrop-blur-md">
         <h2 className="text-sm font-semibold text-foreground">{title}</h2>
         {close}
       </div>
     );
   }
   ```

   In `SidebarModal.tsx`:
   - Render `<SettingsTitleBar title={activeItem?.label ?? title} close={…} />` as the first child of the content column (`:243`).
   - Pass the existing `DialogPrimitive.Close` as `close`, with its classes changed to `grid h-8 w-8 place-items-center rounded-md opacity-70 hover:opacity-100 hover:bg-muted dark:hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-ring` and an `h-4 w-4` icon.
   - Delete the absolute-positioned close (`:135-138`), and delete the `mt-6`/`mt-8` offsets on `notice` that existed only to clear it (`:246` comment).
   - In compact mode, use `-mx-4 px-4` instead of `-mx-6 px-6`. Pass `compact` to the title bar, or use the `isCompact` class switch already in `SidebarModal`.
   - Keep `<DialogPrimitive.Title className="sr-only">` (`:141`) as the dialog's accessible name.

6. **Drop the duplicated titles.**
   - In `SpeechToTextTabs` and `LlmsTabs` (`SettingsPage.tsx`), change `<SectionHeader title={…} description={…} />` to `<SectionHeader description={…} />`.
   - In `RoutingSection.tsx`, do the same for `patchbay.description`.
   - In the `privacyData` case, drop the title from the first `SectionHeader`.

   The sticky title bar now names the section.

7. Write `/tmp/loqui-i18n-task-12.json` and merge it. The `en` block below overwrites existing values. In the other locales, translate the new values.

   ```json
   {
     "settingsModal": {
       "sections": {
         "general": { "label": "Preferences", "description": "Appearance, sounds, startup" },
         "hotkeys": { "label": "Dictation", "description": "Hotkeys, microphone, paste, language" },
         "speechToText": { "label": "Speech-to-Text", "description": "Engines for dictation and notes" },
         "llms": { "label": "Language Models", "description": "Cleanup, assistant, chat, on-device support" },
         "privacyData": { "label": "Privacy & Data", "description": "Retention, storage, permissions" },
         "system": { "label": "System", "description": "Updates and developer tools" }
       }
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/settingsNav.test.js test/components/settingsRehoming.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

Then check manually, at 1280px and at 760px, in `de` (long strings) and `ar` (RTL), comparing against card R2 A (`05-settings.html:634-645`):
- Dictation holds the mic, paste, language and auto-learn settings.
- Descriptions show under the nav labels at full width and disappear in the icon rail.
- The title stays visible while scrolling.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/SettingsNav.tsx src/components/ui/SettingsTitleBar.tsx src/components/ui/SidebarModal.tsx src/components/ui/SettingsSection.tsx src/components/SettingsPage.tsx src/components/settings/routing/RoutingSection.tsx src/locales test/components/settingsNav.test.js test/components/settingsRehoming.test.js
git commit -m "feat(settings): Re-home dictation settings, show nav descriptions, sticky title"
```

---

