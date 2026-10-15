### Task 3: Settings paths, in-modal navigation and the support-models tab (SET-Q17)

Every `ResolvedRoute.settingsPath` (`"stt/dictation"`, `"llms/supportModels"`, …) must open Settings at that exact place, both from outside the modal (`ControlPanel`'s `onOpenSettings(section?: string)`) and from inside it (Patchbay rows, search results). This task also delivers SET-Q17: speaker identification and semantic search move out of Privacy & Data into a Language Models sub-tab, with their sizes.

**Files:**
- Create: `src/lib/settingsPaths.ts`
- Modify: `src/components/SettingsModal.tsx`. Move `SECTION_ALIASES` (`:12-26`) and `LEGACY_SUB_TAB` (`:28-38`) into the new module, and replace `resolveSection` (`:98-101`) and the two `LEGACY_SUB_TAB[...]` reads (`:107`, `:115`).
- Modify: `src/components/SettingsPage.tsx`:
  - `LlmTab` and `LLM_TABS` (`:741-756`);
  - `LlmsTabs` (`:844-892`);
  - the `llms` TabPanel (`:3159-3190`);
  - remove `<LocalSupportModels />` from `privacyData` (`:2757`);
  - the props interface (`:114-119`).
- Modify: `src/components/settings/LocalSupportModels.tsx`. Show sizes, and drop the misleading `localModels.ready` label.
- Modify: `src/locales/*/translation.json`
- Test: `test/lib/settingsPaths.test.js`, `test/components/localSupportModels.test.js`

**Interfaces:**
- Produces:

  ```ts
  // src/lib/settingsPaths.ts
  export interface SettingsLocation { section: SettingsSectionType; subTab?: string }
  export const SECTION_ALIASES: Record<string, SettingsSectionType>;
  export const LEGACY_SUB_TAB: Record<string, string>;
  export function parseSettingsPath(path: string | null | undefined): SettingsLocation;
  ```

- Produces the `SettingsPage` prop `onNavigateToPath?: (path: string) => void`. Tasks 7, 9 and 13 call it to jump inside the open modal.
- Produces `LlmTab` `"supportModels"`, the target of `ROUTE_SETTINGS_PATH.speakerId` and `.semanticSearch`.
- Calls `refreshRouteFacts()` (Task 2) after a support-model download.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/settingsPaths.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/settingsPaths.ts");

test("route paths open the right section and sub-tab", async () => {
  const { parseSettingsPath } = await load();
  assert.deepEqual(parseSettingsPath("stt/dictation"), { section: "speechToText", subTab: "dictation" });
  assert.deepEqual(parseSettingsPath("llms/supportModels"), { section: "llms", subTab: "supportModels" });
  assert.deepEqual(parseSettingsPath("privacyData"), { section: "privacyData" });
});

test("legacy deep links keep landing where they used to", async () => {
  const { parseSettingsPath } = await load();
  assert.deepEqual(parseSettingsPath("transcription"), { section: "speechToText", subTab: "dictation" });
  assert.deepEqual(parseSettingsPath("dictationAgent"), { section: "llms", subTab: "dictationAgent" });
  assert.deepEqual(parseSettingsPath("intelligence"), { section: "llms", subTab: "dictationCleanup" });
  assert.deepEqual(parseSettingsPath("developer"), { section: "system" });
});

test("unknown or empty paths fall back to Preferences instead of a blank page", async () => {
  const { parseSettingsPath } = await load();
  for (const p of [undefined, null, "", "nope", "nope/x", "/dictation"]) {
    assert.deepEqual(parseSettingsPath(p), { section: "general" }, String(p));
  }
});
```

Create `test/components/localSupportModels.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("support models show what they are, where they run and how big they are", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-support-models-test-" }, { t: "(k, o) => (o && o.size ? `${k}|${o.size}` : k)" })
  );
  const LocalSupportModels = (await vite.ssrLoadModule("/components/settings/LocalSupportModels.tsx")).default;
  const html = renderToStaticMarkup(React.createElement(LocalSupportModels));
  assert.match(html, /supportModels\.download\|34\.8 MB/);  // pyannote 6.6 MB + CAM++ 28.2 MB
  assert.match(html, /supportModels\.download\|91 MB/);
  assert.match(html, /locality\.device/);
  assert.doesNotMatch(html, /localModels\.ready/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/lib/settingsPaths.test.js test/components/localSupportModels.test.js`
Expected: FAIL. `settingsPaths.ts` is missing, and the support-models markup has no sizes.

- [ ] **Step 3: Implement**

1. Create `src/lib/settingsPaths.ts`. Move the two maps verbatim from `SettingsModal.tsx:12-38`, keep their comment, and add the parser:

   ```ts
   import type { SettingsSectionType } from "../components/SettingsPage";

   // Settings locations are "<section>" or "<section>/<subTab>". Route
   // settingsPaths (src/lib/routes.ts) and every legacy deep link resolve here,
   // and anything unknown falls back to Preferences rather than a blank pane.

   export interface SettingsLocation {
     section: SettingsSectionType;
     subTab?: string;
   }

   export const SETTINGS_SECTIONS: readonly SettingsSectionType[] = [
     "general",
     "hotkeys",
     "speechToText",
     "llms",
     "privacyData",
     "system",
   ];

   // The old AI Models sidebar had four items (transcription, meetings,
   // intelligence, agentMode) — they now collapse into two: speechToText + llms.
   // Legacy deep-links land on the matching sub-tab via LEGACY_SUB_TAB.
   // "dictationAgent" is a live deep-link (the Home GPU banner), not a legacy alias.
   export const SECTION_ALIASES: Record<string, SettingsSectionType> = {
     aiModels: "llms",
     agentConfig: "llms",
     agentMode: "llms",
     dictationAgent: "llms",
     intelligence: "llms",
     meetings: "llms",
     prompts: "llms",
     transcription: "speechToText",
     uploadTranscription: "speechToText",
     softwareUpdates: "system",
     privacy: "privacyData",
     permissions: "privacyData",
     developer: "system",
     stt: "speechToText",
   };

   export const LEGACY_SUB_TAB: Record<string, string> = {
     transcription: "dictation",
     uploadTranscription: "upload",
     dictationAgent: "dictationAgent",
     meetings: "noteFormatting",
     intelligence: "dictationCleanup",
     agentMode: "chatIntelligence",
     agentConfig: "chatIntelligence",
     aiModels: "dictationCleanup",
     prompts: "dictationCleanup",
   };

   export function parseSettingsPath(path: string | null | undefined): SettingsLocation {
     if (!path) return { section: "general" };
     const [head, sub] = path.split("/", 2);
     const section = (SETTINGS_SECTIONS as readonly string[]).includes(head)
       ? (head as SettingsSectionType)
       : SECTION_ALIASES[head];
     if (!section) return { section: "general" };
     const subTab = sub || LEGACY_SUB_TAB[head];
     return subTab ? { section, subTab } : { section };
   }
   ```

2. In `src/components/SettingsModal.tsx`:
   - Delete the two maps and their comment (`:8-38`) and `resolveSection` (`:98-101`). Add `import { parseSettingsPath } from "../lib/settingsPaths";`.
   - Replace the state block (`:103-118`) with:

     ```tsx
     const initial = parseSettingsPath(initialSection);
     const [activeSection, setActiveSection] = React.useState<SettingsSectionType>(initial.section);
     const [initialSubTab, setInitialSubTab] = useState<string | undefined>(initial.subTab);
     const [prevOpen, setPrevOpen] = useState(open);

     if (open && !prevOpen && initialSection) {
       setPrevOpen(open);
       setActiveSection(initial.section);
       setInitialSubTab(initial.subTab);
     } else if (open !== prevOpen) {
       setPrevOpen(open);
       if (!open) setInitialSubTab(undefined);
     }

     const handleNavigateToPath = (path: string) => {
       const next = parseSettingsPath(path);
       setActiveSection(next.section);
       setInitialSubTab(next.subTab);
     };
     ```

   - Pass `onNavigateToPath={handleNavigateToPath}` to `<SettingsPage>`.

3. In `src/components/SettingsPage.tsx`:
   - Add `onNavigateToPath?: (path: string) => void;` to `SettingsPageProps` (`:114-119`) and destructure it in the component signature (`:963`). Later tasks pass it down.
   - Add `"supportModels"` as the last member of `LlmTab` and the last entry of `LLM_TABS`.
   - In `LlmsTabs`:
     - Add a `renderSupportModels: () => React.ReactNode` prop.
     - Add `{ id: "supportModels", name: t("settingsPage.llms.tabs.supportModels") }` as the last `subTabs` entry.
     - Add `if (id === "supportModels") return <HardDrive className="w-3.5 h-3.5" />;` before the final `return` in `renderIcon`. Import `HardDrive` from `./icons`.
     - Add `<TabPanel active={tab === "supportModels"}>{renderSupportModels()}</TabPanel>` after the chat panel.
   - In the `llms` TabPanel (`:3162`), pass `renderSupportModels={() => <LocalSupportModels />}`.
   - Delete `<LocalSupportModels />` from the `privacyData` case (`:2757`).

4. Rewrite the render part of `src/components/settings/LocalSupportModels.tsx`. Keep its state, effects and `download()`. After a successful download, add `void refreshRouteFacts();` (import it from `../../stores/routeFactsStore`). Above the component, add:

   ```tsx
   import modelRegistryData from "../../models/modelRegistryData.json";
   import { formatDecimalBytes } from "../../utils/formatBytes";
   import { LocalityRing } from "../ui/LocalityRing";

   // Sizes shown before download. Diarization is the sum of the registry
   // entries; the embedding model (all-MiniLM-L6-v2 ONNX plus tokenizer) is
   // fetched by scripts/download-minilm.js and is about 91 MB.
   const SUPPORT_MODEL_BYTES: Record<ModelKind, number> = {
     meeting: Object.values(modelRegistryData.diarizationModels).reduce(
       (sum, m) => sum + m.sizeMb * 1_000_000,
       0
     ),
     search: 91_000_000,
   };
   ```

   Then replace the returned JSX with:

   ```tsx
   return (
     <div className="space-y-3">
       <SectionHeader
         title={t("settingsPage.llms.supportModels.title")}
         description={t("settingsPage.llms.supportModels.description")}
       />
       <SettingsPanel>
         {(["meeting", "search"] as const).map((kind) => (
           <SettingsPanelRow key={kind}>
             <SettingsRow
               label={t(`personal.supportModels.${kind}`)}
               description={t(`personal.supportModels.${kind}Description`)}
             >
               <div className="flex items-center gap-2">
                 <LocalityRing locality="device" label={t("locality.device")} size={18} />
                 {ready[kind] ? (
                   <span className="text-xs font-medium text-success">
                     {t("settingsPage.llms.supportModels.downloaded")}
                   </span>
                 ) : (
                   <Button
                     size="sm"
                     variant="outline"
                     disabled={!!busy}
                     onClick={() => void download(kind)}
                   >
                     {busy === kind
                       ? t("personal.downloading")
                       : t("supportModels.download", {
                           size: formatDecimalBytes(SUPPORT_MODEL_BYTES[kind]),
                         })}
                   </Button>
                 )}
               </div>
             </SettingsRow>
           </SettingsPanelRow>
         ))}
       </SettingsPanel>
       {error && (
         <p role="alert" className="text-xs text-destructive">
           {error}
         </p>
       )}
     </div>
   );
   ```

   Import `SectionHeader` alongside the existing `SettingsSection` imports. Then add a decimal formatter to `src/utils/formatBytes.ts`. Model hosts publish decimal sizes ("34.8 MB", "91 MB"), and the existing `formatBytes` is 1024-based:

   ```ts
   // Decimal (1000-based) units, matching the sizes model hosts publish.
   export function formatDecimalBytes(bytes: number, decimals = 1): string {
     if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
     const units = ["B", "KB", "MB", "GB", "TB"];
     const i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
     return `${parseFloat((bytes / 1000 ** i).toFixed(decimals))} ${units[i]}`;
   }
   ```

   Every later task that shows a model or file size uses `formatDecimalBytes`.

5. Write `/tmp/loqui-i18n-task-3.json` and merge it. The `en` block is:

   ```json
   {
     "settingsPage": {
       "llms": {
         "tabs": { "supportModels": "On-device support" },
         "supportModels": {
           "title": "On-device support models",
           "description": "Small models that always run on this device. Your recordings and notes never leave it for these tasks.",
           "downloaded": "Downloaded"
         }
       }
     },
     "supportModels": { "download": "Download {{size}}" }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/lib/settingsPaths.test.js test/components/localSupportModels.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS.

Then manually check: open Settings → Language Models. The "On-device support" tab exists, and Privacy & Data no longer shows the support models.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settingsPaths.ts src/components/SettingsModal.tsx src/components/SettingsPage.tsx src/components/settings/LocalSupportModels.tsx src/utils/formatBytes.ts src/locales test/lib/settingsPaths.test.js test/components/localSupportModels.test.js
git commit -m "feat(settings): Route deep links and on-device support models tab"
```

---

