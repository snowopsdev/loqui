### Task 4: Route chips and an honest mode selector (SET-Q4)

"Active" means "mode selected", not "usable" (SET-04). This task does three things:
- It replaces "Active" with "Current" plus the route's real state chip.
- It makes the mode selector a real radio group: `role="radiogroup"`/`radio`, `aria-checked`, roving tab stop, arrow keys.
- It ships the two chip primitives every later screen uses.

**Files:**
- Create: `src/components/settings/routing/RouteChips.tsx`
- Create: `src/components/ui/rovingNav.ts`
- Modify: `src/components/ui/SettingsSection.tsx`. Rework `InferenceModeSelector` (`:111-197`).
- Modify: `src/components/ui/ModelCardList.tsx:172-176`. Change "Active" to "Selected".
- Modify: `src/components/icons/index.ts`. Add `WifiOff` and `Laptop`.
- Modify: `src/lib/routes.ts`. Add `SCOPE_ROUTE` and `STT_CONTEXT_ROUTE`.
- Modify these four call sites to pass `label` and `routeState`:
  - `src/components/SettingsPage.tsx:638`
  - `src/components/settings/MeetingSettings.tsx:145`
  - `src/components/settings/UploadSettings.tsx:124`
  - `src/components/settings/InferenceConfigEditor.tsx:156`
- Modify: `src/locales/*/translation.json`
- Modify: `test/components/plumNight.test.js` (Plan 01's). Extend contrast coverage to the surfaces Settings uses (Plan 01 review item 4).
- Test: `test/components/routeChips.test.js`, `test/components/inferenceModeSelector.test.js`, `test/components/rovingNav.test.js`, `test/components/plumNight.test.js`

**Interfaces:**
- Consumes:
  - `RouteState`, `ResolvedRoute` and `useResolvedRoute` (Tasks 1–2);
  - `LocalityRing` and the `locality.*` keys (Plan 01);
  - `formatDecimalBytes` (Task 3).
- Produces:

  ```ts
  // src/components/settings/routing/RouteChips.tsx
  export function routeStateLabel(state: RouteState, t: TFunction): string;
  export function RouteStateChip(props: { state: RouteState; className?: string }): JSX.Element;
  export function RouteDestinationChip(props: { route: Pick<ResolvedRoute, "locality" | "providerId" | "model">; className?: string }): JSX.Element;
  // src/components/ui/rovingNav.ts
  export type NavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";
  export function stepLinear(index: number, key: string, disabled: readonly boolean[]): number;  // returns index unchanged for other keys
  // src/lib/routes.ts (additive)
  export const SCOPE_ROUTE: Record<LlmRouteScope, RouteId>;
  export const STT_CONTEXT_ROUTE: Record<SttContext, RouteId>;
  // InferenceModeSelector gains props:
  //   label: string                    (radiogroup accessible name)
  //   routeState?: RouteState          (state of the applied mode's route)
  //   stagedMode?: InferenceMode|null  (Task 6; shows "Staged, not active")
  ```

- [ ] **Step 1: Write the failing tests**

Append to `test/components/plumNight.test.js`. It reuses that file's `css`, `load` and `resolveTokens`. Plan 01 checks text roles only on background, card, surface-raised and surface-window, but route chips, the Patchbay, the keyring, the cartridges and the storage list sit on popover, muted, secondary and surface-1 to surface-3:

```js
const SETTINGS_SURFACES = [
  "--color-popover",
  "--color-muted",
  "--color-secondary",
  "--color-surface-1",
  "--color-surface-2",
  "--color-surface-3",
];

test("Plum Night text roles meet 4.5:1 on the settings surfaces", async () => {
  const { contrastRatio } = await load();
  const { dark } = resolveTokens(css);
  const texts = [
    "--color-foreground",
    "--color-muted-foreground",
    "--color-popover-foreground",
    "--color-secondary-foreground",
    "--color-link",
    "--color-destructive",
    "--color-locality-device",
    "--color-locality-network",
    "--color-locality-remote",
  ];
  for (const t of texts)
    for (const s of SETTINGS_SURFACES) {
      const ratio = contrastRatio(dark[t], dark[s]);
      assert.ok(ratio >= 4.5, `${t} on ${s} is ${ratio}:1`);
    }
});

test("Plum Night non-text roles (ring, locality jacks, status dots) meet 3:1 on the settings surfaces", async () => {
  const { contrastRatio } = await load();
  const { dark } = resolveTokens(css);
  const marks = ["--color-ring", "--color-locality-device", "--color-locality-network", "--color-locality-remote", "--color-warning", "--color-destructive"];
  for (const m of marks)
    for (const s of SETTINGS_SURFACES) {
      const ratio = contrastRatio(dark[m], dark[s]);
      assert.ok(ratio >= 3, `${m} on ${s} is ${ratio}:1`);
    }
});
```

These pass against the tokens shipped at `172f9df`. The measured minimums are 5.82:1 for text (`--color-destructive` on `surface-3`) and 5.16:1 for the ring. They are pinned so that a later token change cannot regress the settings surfaces silently.

Create `test/components/rovingNav.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/ui/rovingNav.ts");

test("linear roving focus skips disabled items and wraps", async () => {
  const { stepLinear } = await load();
  const disabled = [false, true, false];
  assert.equal(stepLinear(0, "ArrowDown", disabled), 2);
  assert.equal(stepLinear(2, "ArrowDown", disabled), 0);
  assert.equal(stepLinear(0, "ArrowUp", disabled), 2);
  assert.equal(stepLinear(2, "ArrowRight", disabled), 0);
  assert.equal(stepLinear(2, "Home", disabled), 0);
  assert.equal(stepLinear(0, "End", disabled), 2);
  assert.equal(stepLinear(0, "Tab", disabled), 0);
  assert.equal(stepLinear(0, "ArrowDown", [true, true]), 0);
});
```

Create `test/components/routeChips.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("route chips", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-route-chips-test-" }, { withOptions: true }));
  const chips = await vite.ssrLoadModule("/components/settings/routing/RouteChips.tsx");
  const tr = (k, o) => (o ? `${k}${JSON.stringify(o)}` : k);

  await t.test("every state has words, never colour alone", () => {
    assert.equal(chips.routeStateLabel({ status: "ready" }, tr), "routes.state.ready");
    assert.equal(chips.routeStateLabel({ status: "off" }, tr), "routes.state.off");
    assert.equal(chips.routeStateLabel({ status: "needsModel", sizeBytes: 1329766560 }, tr), 'routes.state.download{"size":"1.3 GB"}');
    assert.equal(chips.routeStateLabel({ status: "needsModel" }, tr), "routes.state.chooseModel");
    assert.equal(chips.routeStateLabel({ status: "needsKey", provider: "Groq" }, tr), "routes.state.addKey");
    assert.equal(chips.routeStateLabel({ status: "needsKey", provider: "" }, tr), "routes.state.chooseProvider");
    assert.equal(chips.routeStateLabel({ status: "needsUrl" }, tr), "routes.state.addUrl");
    assert.equal(chips.routeStateLabel({ status: "unreachable", detail: "sealed" }, tr), "routes.state.sealed");
    assert.equal(chips.routeStateLabel({ status: "unreachable", detail: "retired" }, tr), "routes.state.retired");
    assert.equal(chips.routeStateLabel({ status: "unreachable", detail: "192.168.1.20" }, tr), 'routes.state.cantReach{"host":"192.168.1.20"}');
    assert.equal(chips.routeStateLabel({ status: "unreachable" }, tr), "routes.state.cantReachUnknown");
  });

  await t.test("the state chip carries a glyph and data-state for styling", () => {
    const html = renderToStaticMarkup(React.createElement(chips.RouteStateChip, { state: { status: "needsKey", provider: "Groq" } }));
    assert.match(html, /data-state="needsKey"/);
    assert.match(html, /<svg/);
    assert.match(html, /routes\.state\.addKey/);
  });

  await t.test("the destination chip shows ring shape, provider and model", () => {
    const remote = renderToStaticMarkup(
      React.createElement(chips.RouteDestinationChip, { route: { locality: "remote", provider: "Groq", providerId: "groq", model: "gpt-oss-120b" } })
    );
    assert.match(remote, /data-locality="remote"/);
    assert.match(remote, /Groq · gpt-oss-120b/);
    const device = renderToStaticMarkup(
      React.createElement(chips.RouteDestinationChip, { route: { locality: "device", provider: null, providerId: null, model: "Qwen3.5 2B" } })
    );
    assert.match(device, /locality\.device · Qwen3\.5 2B/);
  });
});
```

Create `test/components/inferenceModeSelector.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("mode selector is a radio group that tells the truth about the current route", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-mode-selector-test-" }));
  const { InferenceModeSelector } = await vite.ssrLoadModule("/components/ui/SettingsSection.tsx");
  const modes = [
    { id: "providers", label: "Cloud", description: "d", icon: null },
    { id: "local", label: "Local", description: "d", icon: null },
    { id: "self-hosted", label: "Self-hosted", description: "d", icon: null, disabled: true, badge: "Soon" },
  ];
  const html = renderToStaticMarkup(
    React.createElement(InferenceModeSelector, {
      label: "Dictation runs on",
      modes,
      activeMode: "local",
      onSelect: () => {},
      routeState: { status: "needsModel", sizeBytes: 680000000 },
      stagedMode: "providers",
    })
  );
  assert.match(html, /role="radiogroup"[^>]*aria-label="Dictation runs on"/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 3);
  // The staged choice is the checked radio (R3 B); the applied one is labelled "Current".
  assert.match(html, /aria-checked="true"[^>]*tabindex="0"[^>]*>[\s\S]*?Cloud/);
  assert.match(html, /Local<\/span><span[^>]*>routes\.selection\.current/);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1, "one tab stop");
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /routes\.selection\.current/);
  assert.match(html, /routes\.state\.download/);
  assert.match(html, /routes\.selection\.staged/);
  assert.doesNotMatch(html, /common\.active/);
});
```

The third assertion depends on attribute order. Render the button with `role`, `aria-checked` and `tabIndex` as its first three props in that order so the regex is stable.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/rovingNav.test.js test/components/routeChips.test.js test/components/inferenceModeSelector.test.js`
Expected: FAIL. The modules are missing, and the selector has no `role="radiogroup"`.

- [ ] **Step 3: Implement**

1. Create `src/components/ui/rovingNav.ts`:

   ```ts
   // Roving-tabindex arrow handling for radio groups and option grids.
   // Pure, so keyboard behaviour is testable without a DOM.

   export type NavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

   export function stepLinear(index: number, key: string, disabled: readonly boolean[]): number {
     const n = disabled.length;
     if (n === 0 || disabled.every(Boolean)) return index;
     const enabled = (i: number) => !disabled[i];
     const scan = (from: number, dir: 1 | -1) => {
       let i = from;
       for (let step = 0; step < n; step++) {
         i = (i + dir + n) % n;
         if (enabled(i)) return i;
       }
       return index;
     };
     switch (key) {
       case "ArrowDown":
       case "ArrowRight":
         return scan(index, 1);
       case "ArrowUp":
       case "ArrowLeft":
         return scan(index, -1);
       case "Home":
         return scan(n - 1, 1);
       case "End":
         return scan(0, -1);
       default:
         return index;
     }
   }
   ```

2. Add to `src/components/icons/index.ts`, keeping alphabetical order:

   ```ts
   export const Laptop = createIcon("laptop", Lucide.Laptop);
   export const WifiOff = createIcon("wifi-off", Lucide.WifiOff);
   ```

3. Append to `src/lib/routes.ts`, after `ROUTE_SETTINGS_PATH`:

   ```ts
   export const SCOPE_ROUTE: Record<LlmRouteScope, RouteId> = {
     dictationCleanup: "dictationCleanup",
     dictationAgent: "voiceAssistant",
     dictationAgentVision: "assistantVision",
     dictationTranslation: "translation",
     noteFormatting: "noteFormatting",
     chatIntelligence: "chat",
   };

   export const STT_CONTEXT_ROUTE: Record<SttContext, RouteId> = {
     dictation: "dictationStt",
     meeting: "noteRecordingStt",
     upload: "uploadStt",
   };
   ```

   Move the `SttContext` and `LlmRouteScope` type declarations above these constants if TypeScript complains about use before declaration. Type aliases are hoisted, so it should not complain.

4. Create `src/components/settings/routing/RouteChips.tsx`:

   ```tsx
   import type { TFunction } from "i18next";
   import { useTranslation } from "react-i18next";
   import type { ResolvedRoute, RouteState } from "../../../lib/routes";
   import { providerDisplayLabel } from "../../../lib/locality";
   import { formatDecimalBytes } from "../../../utils/formatBytes";
   import { cn } from "../../lib/utils";
   import { CircleCheck, Download, KeyRound, Lock, Minus, Server, WifiOff } from "../../icons";
   import { LocalityRing } from "../../ui/LocalityRing";

   // Route chips (DESIGN.md "Settings · Routing"): a state is always glyph plus
   // words. Colour is a third, redundant cue.

   export function routeStateLabel(state: RouteState, t: TFunction | ((k: string, o?: object) => string)): string {
     switch (state.status) {
       case "ready":
         return t("routes.state.ready");
       case "off":
         return t("routes.state.off");
       case "needsModel":
         return state.sizeBytes
           ? t("routes.state.download", { size: formatDecimalBytes(state.sizeBytes) })
           : t("routes.state.chooseModel");
       case "needsKey":
         return state.provider ? t("routes.state.addKey") : t("routes.state.chooseProvider");
       case "needsUrl":
         return t("routes.state.addUrl");
       case "unreachable":
         if (state.detail === "sealed") return t("routes.state.sealed");
         if (state.detail === "retired") return t("routes.state.retired");
         return state.detail
           ? t("routes.state.cantReach", { host: state.detail })
           : t("routes.state.cantReachUnknown");
     }
   }

   const STATE_STYLE: Record<RouteState["status"], string> = {
     ready: "text-locality-device",
     off: "text-muted-foreground",
     needsModel: "text-foreground",
     needsKey: "text-destructive",
     needsUrl: "text-destructive",
     unreachable: "text-destructive",
   };

   function StateGlyph({ state }: { state: RouteState }) {
     const cls = "h-3 w-3 shrink-0";
     switch (state.status) {
       case "ready":
         return <CircleCheck className={cls} aria-hidden="true" />;
       case "off":
         return <Minus className={cls} aria-hidden="true" />;
       case "needsModel":
         return <Download className={cls} aria-hidden="true" />;
       case "needsKey":
         return <KeyRound className={cls} aria-hidden="true" />;
       case "needsUrl":
         return <Server className={cls} aria-hidden="true" />;
       case "unreachable":
         return state.detail === "sealed" ? (
           <Lock className={cls} aria-hidden="true" />
         ) : (
           <WifiOff className={cls} aria-hidden="true" />
         );
     }
   }

   export function RouteStateChip({ state, className }: { state: RouteState; className?: string }) {
     const { t } = useTranslation();
     const sealed = state.status === "unreachable" && state.detail === "sealed";
     return (
       <span
         data-state={state.status}
         className={cn(
           "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium tabular-nums",
           sealed ? "text-muted-foreground" : STATE_STYLE[state.status],
           className
         )}
       >
         <StateGlyph state={state} />
         {routeStateLabel(state, t)}
       </span>
     );
   }

   export function RouteDestinationChip({
     route,
     className,
   }: {
     route: Pick<ResolvedRoute, "locality" | "providerId" | "model">;
     className?: string;
   }) {
     const { t } = useTranslation();
     // Plan 01: provider names in UI go through providerDisplayLabel so
     // "Custom endpoint" and "Unknown provider" are localised.
     const providerName = route.providerId ? providerDisplayLabel(route.providerId, t) : null;
     const place =
       route.locality === "remote"
         ? (providerName ?? t("routes.place.chooseProvider"))
         : t(`locality.${route.locality}`);
     const ringLabel =
       route.locality === "remote"
         ? t("locality.remote", { provider: providerName ?? "" })
         : t(`locality.${route.locality}`);
     return (
       <span className={cn("inline-flex h-6 min-w-0 max-w-[260px] items-center gap-1.5 text-xs font-medium", className)}>
         <LocalityRing locality={route.locality} label={ringLabel} provider={providerName} size={16} />
         <span className="truncate" dir="auto">
           {route.model ? `${place} · ${route.model}` : place}
         </span>
       </span>
     );
   }
   ```

   `text-locality-device` exists because Plan 01 registers `--color-locality-device` in `@theme`, and it passes contrast in both themes. `text-destructive` is `#dc2626`, which is 4.83:1 on white. Do not use `text-success` or `text-warning` for text: they measure 3.3:1 and 3.2:1 on white.

5. Rework `InferenceModeSelector` in `src/components/ui/SettingsSection.tsx` (`:111-197`). Keep `InferenceModeOption`, and replace the component with:

   ```tsx
   export function InferenceModeSelector({
     label,
     modes,
     activeMode,
     onSelect,
     routeState,
     stagedMode = null,
   }: {
     label: string;
     modes: InferenceModeOption[];
     activeMode: InferenceMode;
     onSelect: (mode: InferenceMode) => void;
     routeState?: RouteState;
     stagedMode?: InferenceMode | null;
   }) {
     const { t } = useTranslation();
     const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
     const checkedId = stagedMode ?? activeMode;
     const checkedIndex = Math.max(0, modes.findIndex((m) => m.id === checkedId));
     const disabled = modes.map((m) => !!m.disabled);

     const onKeyDown = (event: React.KeyboardEvent, index: number) => {
       const next = stepLinear(index, event.key, disabled);
       if (next === index) return;
       event.preventDefault();
       refs.current[next]?.focus();
       onSelect(modes[next].id);
     };

     return (
       <SettingsPanel className="overflow-hidden">
         <div role="radiogroup" aria-label={label}>
           {modes.map((mode, index) => {
             const isChecked = checkedId === mode.id;
             const isCurrent = activeMode === mode.id;
             const isStaged = stagedMode === mode.id && stagedMode !== activeMode;
             const isDisabled = !!mode.disabled;
             return (
               <SettingsPanelRow
                 key={mode.id}
                 className={`transition-colors ${isDisabled ? "" : "hover:bg-foreground/3 dark:hover:bg-white/3"}`}
               >
                 <button
                   role="radio"
                   aria-checked={isChecked}
                   tabIndex={index === checkedIndex ? 0 : -1}
                   type="button"
                   aria-disabled={isDisabled || undefined}
                   ref={(el) => {
                     refs.current[index] = el;
                   }}
                   onClick={() => !isDisabled && onSelect(mode.id)}
                   onKeyDown={(e) => onKeyDown(e, index)}
                   className={`w-full flex items-center gap-3 text-start cursor-pointer group rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${isDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                 >
                   <div
                     className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                       isChecked
                         ? "bg-primary/10 dark:bg-primary/15"
                         : "bg-muted/60 dark:bg-surface-raised group-hover:bg-muted dark:group-hover:bg-surface-3"
                     }`}
                   >
                     <div className={`transition-colors ${isChecked ? "text-primary" : "text-muted-foreground"}`}>
                       {mode.icon}
                     </div>
                   </div>
                   <div className="flex-1 min-w-0">
                     <div className="flex flex-wrap items-center gap-2">
                       <span className="text-xs font-medium text-foreground">{mode.label}</span>
                       {isCurrent && !isDisabled && (
                         <span className="text-xs font-medium text-foreground bg-muted px-1.5 py-px rounded-sm">
                           {t("routes.selection.current")}
                         </span>
                       )}
                       {isCurrent && routeState && <RouteStateChip state={routeState} className="h-5 px-0" />}
                       {isStaged && (
                         <span className="text-xs font-medium text-locality-remote border border-dashed border-locality-remote px-1.5 py-px rounded-sm">
                           {t("routes.selection.staged")}
                         </span>
                       )}
                       {isDisabled && mode.badge && (
                         <span className="text-xs text-muted-foreground bg-muted/80 dark:bg-surface-3 px-1.5 py-px rounded-sm">
                           {mode.badge}
                         </span>
                       )}
                     </div>
                     <p className="text-xs text-muted-foreground/80 mt-0.5">{mode.description}</p>
                   </div>
                   <div
                     aria-hidden="true"
                     className={`w-4 h-4 rounded-full border-2 shrink-0 transition-colors ${
                       isChecked ? "border-primary bg-primary" : "border-border-hover dark:border-border-subtle"
                     }`}
                   >
                     {isChecked && (
                       <div className="w-full h-full flex items-center justify-center">
                         <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                       </div>
                     )}
                   </div>
                 </button>
               </SettingsPanelRow>
             );
           })}
         </div>
       </SettingsPanel>
     );
   }
   ```

   Imports to add to `SettingsSection.tsx`:
   - `import { stepLinear } from "./rovingNav";`
   - `import { RouteStateChip } from "../settings/routing/RouteChips";`
   - `import type { RouteState } from "../../lib/routes";`

   The orange radio dot stays, because selection is one of the three places orange is allowed.

6. Wire the four call sites. Each one adds a `label` and the applied route's state:

   | File:line | Route hook | `label` key |
   |---|---|---|
   | `SettingsPage.tsx:638` (inside `TranscriptionSection`) | `useResolvedRoute("dictationStt")` | `routes.runsOn` with `{ task: t("routes.names.dictationStt") }` |
   | `MeetingSettings.tsx:145` | `useResolvedRoute("noteRecordingStt")` | same, with `noteRecordingStt` |
   | `UploadSettings.tsx:124` | `useResolvedRoute("uploadStt")` | same, with `uploadStt` |
   | `InferenceConfigEditor.tsx:156` | `useResolvedRoute(SCOPE_ROUTE[scope])` | same, with `SCOPE_ROUTE[scope]` |

   Each passes `routeState={route.state}`. Example for `InferenceConfigEditor`:

   ```tsx
   const route = useResolvedRoute(SCOPE_ROUTE[scope as LlmRouteScope]);
   // …
   <InferenceModeSelector
     label={t("routes.runsOn", { task: t(`routes.names.${route.id}`) })}
     modes={modes}
     activeMode={effectiveMode}
     onSelect={handleModeSelect}
     routeState={route.state}
   />
   ```

7. In `src/components/ui/ModelCardList.tsx:172-176`, change `{t("common.active")}` to `{t("routes.selection.selected")}`. The card itself is replaced for local models in Task 10, but cloud model lists keep `ModelCardList`.

8. Write `/tmp/loqui-i18n-task-4.json` and merge it. The `en` block is:

   ```json
   {
     "routes": {
       "runsOn": "{{task}} runs on",
       "place": { "chooseProvider": "Choose a provider" },
       "selection": { "current": "Current", "selected": "Selected", "staged": "Staged, not active" },
       "state": {
         "ready": "Ready",
         "off": "Off",
         "download": "Download {{size}}",
         "chooseModel": "Choose a model",
         "addKey": "Add API key",
         "chooseProvider": "Choose a provider",
         "addUrl": "Add server URL",
         "sealed": "Paused · Sealed mode",
         "retired": "Service retired · choose again",
         "cantReach": "Can't reach {{host}}",
         "cantReachUnknown": "Can't reach the server"
       }
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/rovingNav.test.js test/components/routeChips.test.js test/components/inferenceModeSelector.test.js test/components/plumNight.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS.

Then manually check: in Settings → Speech-to-Text, Tab moves into the mode list once, ↑/↓ move the selection, and an empty local model shows "Current · Choose a model".

- [ ] **Step 5: Commit**

```bash
git add test/components/plumNight.test.js src/components/ui/rovingNav.ts src/components/settings/routing/RouteChips.tsx src/components/ui/SettingsSection.tsx src/components/ui/ModelCardList.tsx src/components/icons/index.ts src/lib/routes.ts src/components/SettingsPage.tsx src/components/settings/MeetingSettings.tsx src/components/settings/UploadSettings.tsx src/components/settings/InferenceConfigEditor.tsx src/locales test/components/rovingNav.test.js test/components/routeChips.test.js test/components/inferenceModeSelector.test.js
git commit -m "feat(settings): Route state chips and a radio-group mode selector"
```

---

