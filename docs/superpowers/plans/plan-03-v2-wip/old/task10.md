### Task 10: Cartridge model cards with radio semantics (SET-R4 B, SET-Q8, SET-Q9)

Local models become **cartridges**: a 2-column grid of cards, each showing:
- the name;
- three 5-pip meters (Speed, Quality, Memory use), always labelled in words;
- size and context;
- the state: Ready, Download, Downloading with a real `role="progressbar"`, or Too large for this device;
- "In use by" chips that show which tasks already use the model.

The grid is a `role="radiogroup"` with one tab stop:
- Arrows move through the grid (←/→ swap in RTL, ↑/↓ move a row, Home/End).
- Enter or Space selects a downloaded model, or starts the download of one that isn't.
- The card's action button is reachable as the next tab stop.
- Sorting is Recommended first, then by size ascending, collapsed after 5 with "Show all 13" (Q8).
- Download buttons use the outline variant except on the Recommended card (Q9).

This supersedes Plan 02's SET-Q2 (keyboard-selectable model cards) for local models. Plan 02's markup is replaced, but its accessible names are kept.

Pips are estimates derived from size unless the registry carries curated `speedTier` and `qualityTier` values. They are labelled "estimate".

**Files:**
- Create: `src/components/ui/cartridgeMath.ts` (pure)
- Modify: `src/components/ui/rovingNav.ts`. Add `stepGrid`.
- Create: `src/components/ui/ModelCartridgeGrid.tsx`
- Modify: `src/models/ModelRegistry.ts:7-28`. Add optional `speedTier?: number; qualityTier?: number;` to `ModelDefinition`.
- Modify: `src/components/LocalModelPicker.tsx:360-385`. Replace `ModelCardList` with `ModelCartridgeGrid`.
- Modify: `src/components/TranscriptionModelPicker.tsx`. Replace the two `LocalModelCard` lists in `renderLocalModels` (`:1032-1080`) and the Parakeet renderer (`:1105-1160`) with `ModelCartridgeGrid`, and delete `LocalModelCard` (`:76-~200`) once it has no callers.
- Modify: `src/helpers/ipcHandlers.js`, `preload.js` and `src/types/electron.ts`. Add `getTotalMemory`.
- Modify: `src/locales/*/translation.json`
- Test: `test/components/rovingNav.test.js` (extend), `test/components/cartridgeMath.test.js`, `test/components/modelCartridgeGrid.test.js`

**Interfaces:**
- Consumes:
  - `useResolvedRoutes` for "In use by" (Task 2);
  - `formatDecimalBytes` (Task 3);
  - `stepLinear` file (Task 4);
  - `Button` variants `default` (the ink capsule) and `outline` (Plan 01);
  - the existing `LocalModelPicker` handlers `selectModel`, `handleDownload`, `handleDelete` and `cancelDownload`;
  - the existing `TranscriptionModelPicker` handlers passed to `LocalModelCard` today.
- Produces:

  ```ts
  // rovingNav.ts (additive)
  export function stepGrid(index: number, key: string, opts: { columns: number; count: number; rtl: boolean }): number;
  // cartridgeMath.ts
  export interface CartridgeModel {
    id: string; name: string; sizeBytes?: number; contextLength?: number; recommended?: boolean;
    isDownloaded: boolean; isDownloading: boolean; isCancelling?: boolean; progress?: number;   // 0–100
    speedTier?: number; qualityTier?: number; badge?: string;                                  // e.g. "25 languages"
  }
  export type Fit = "comfortable" | "tight" | "tooLarge" | "unknown";
  export function estimateTiers(m: Pick<CartridgeModel, "sizeBytes" | "speedTier" | "qualityTier">): { speed: number | null; quality: number | null; memory: number | null; estimated: boolean };
  export function estimateRamBytes(sizeBytes: number): number;                 // sizeBytes × 1.15
  export function fitFor(sizeBytes: number | undefined, totalMemoryBytes: number | null): Fit;
  export function sortForDisplay<T extends Pick<CartridgeModel, "recommended" | "sizeBytes">>(models: T[]): T[];
  export function visibleModels<T extends Pick<CartridgeModel, "id">>(sorted: T[], selectedId: string, expanded: boolean, limit?: number): T[];
  // ModelCartridgeGrid.tsx
  export interface ModelCartridgeGridProps {
    label: string; models: CartridgeModel[]; selectedId: string; totalMemoryBytes: number | null;
    usedBy?: Record<string, string[]>;   // model id → translated task names
    onSelect(id: string): void; onDownload(id: string): void; onCancel?(id: string): void; onDelete?(id: string): void;
  }
  export function ModelCartridgeGrid(props: ModelCartridgeGridProps): JSX.Element;
  // preload
  getTotalMemory: () => Promise<number>;   // os.totalmem(), bytes
  ```

- [ ] **Step 1: Write the failing tests**

Append to `test/components/rovingNav.test.js`:

```js
test("grid roving focus moves by row and swaps left/right in RTL", async () => {
  const { stepGrid } = await import("../../src/components/ui/rovingNav.ts");
  const ltr = { columns: 2, count: 5, rtl: false };
  assert.equal(stepGrid(0, "ArrowRight", ltr), 1);
  assert.equal(stepGrid(1, "ArrowLeft", ltr), 0);
  assert.equal(stepGrid(0, "ArrowDown", ltr), 2);
  assert.equal(stepGrid(3, "ArrowDown", ltr), 4, "clamps to the last card in a short final row");
  assert.equal(stepGrid(4, "ArrowDown", ltr), 4);
  assert.equal(stepGrid(2, "ArrowUp", ltr), 0);
  assert.equal(stepGrid(0, "ArrowUp", ltr), 0);
  assert.equal(stepGrid(3, "Home", ltr), 0);
  assert.equal(stepGrid(0, "End", ltr), 4);
  const rtl = { columns: 2, count: 5, rtl: true };
  assert.equal(stepGrid(0, "ArrowLeft", rtl), 1, "in RTL, left moves toward the inline end");
  assert.equal(stepGrid(1, "ArrowRight", rtl), 0);
});
```

Create `test/components/cartridgeMath.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/ui/cartridgeMath.ts");
const GB = 1_000_000_000;

test("tiers come from curated data when present, otherwise from size, and say so", async () => {
  const { estimateTiers } = await load();
  assert.deepEqual(estimateTiers({ sizeBytes: 1.3 * GB }), { speed: 4, quality: 3, memory: 1, estimated: true });
  assert.deepEqual(estimateTiers({ sizeBytes: 2.7 * GB }), { speed: 3, quality: 4, memory: 2, estimated: true });
  assert.deepEqual(estimateTiers({ sizeBytes: 5.5 * GB }), { speed: 2, quality: 5, memory: 4, estimated: true });
  assert.deepEqual(estimateTiers({ sizeBytes: 5.5 * GB, speedTier: 3, qualityTier: 4 }), { speed: 3, quality: 4, memory: 4, estimated: false });
  assert.deepEqual(estimateTiers({}), { speed: null, quality: null, memory: null, estimated: true });
});

test("fit compares the RAM estimate with this device", async () => {
  const { fitFor, estimateRamBytes } = await load();
  assert.equal(estimateRamBytes(1 * GB), 1.15 * GB);
  assert.equal(fitFor(1.3 * GB, 16 * GB), "comfortable");
  assert.equal(fitFor(7 * GB, 16 * GB), "tight");
  assert.equal(fitFor(12 * GB, 16 * GB), "tooLarge");
  assert.equal(fitFor(1 * GB, null), "unknown");
  assert.equal(fitFor(undefined, 16 * GB), "unknown");
});

test("sort puts Recommended first, then smaller models; collapse keeps the selection visible", async () => {
  const { sortForDisplay, visibleModels } = await load();
  const models = [
    { id: "9b", sizeBytes: 5.5 * GB },
    { id: "2b", sizeBytes: 1.3 * GB, recommended: true },
    { id: "x", sizeBytes: undefined },
    { id: "4b", sizeBytes: 2.7 * GB },
    { id: "0.8b", sizeBytes: 0.8 * GB },
  ];
  assert.deepEqual(sortForDisplay(models).map((m) => m.id), ["2b", "0.8b", "4b", "9b", "x"]);
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}` }));
  assert.deepEqual(visibleModels(many, "m0", false).map((m) => m.id), ["m0", "m1", "m2", "m3", "m4"]);
  assert.deepEqual(visibleModels(many, "m7", false).map((m) => m.id), ["m0", "m1", "m2", "m3", "m4", "m7"]);
  assert.equal(visibleModels(many, "m0", true).length, 8);
});
```

Create `test/components/modelCartridgeGrid.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const { withI18nMock } = require("../lib/i18nTestMock");
const GB = 1_000_000_000;

test("cartridge grid", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-cartridge-test-" }, { withOptions: true }));
  const { ModelCartridgeGrid } = await vite.ssrLoadModule("/components/ui/ModelCartridgeGrid.tsx");
  const models = [
    { id: "qwen-2b", name: "Qwen3.5 2B", sizeBytes: 1.3 * GB, contextLength: 32768, recommended: true, isDownloaded: true, isDownloading: false },
    { id: "qwen-4b", name: "Qwen3.5 4B", sizeBytes: 2.7 * GB, contextLength: 32768, isDownloaded: false, isDownloading: true, progress: 42 },
    { id: "qwen-9b", name: "Qwen3.5 9B", sizeBytes: 5.5 * GB, isDownloaded: false, isDownloading: false },
    { id: "big", name: "Huge 70B", sizeBytes: 40 * GB, isDownloaded: false, isDownloading: false },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `extra${i}`, name: `Extra ${i}`, sizeBytes: (6 + i) * GB, isDownloaded: false, isDownloading: false })),
  ];
  const render = (over = {}) =>
    renderToStaticMarkup(React.createElement(ModelCartridgeGrid, {
      label: "Language model",
      models,
      selectedId: "qwen-2b",
      totalMemoryBytes: 16 * GB,
      usedBy: { "qwen-2b": ["Chat", "Cleanup"] },
      onSelect() {}, onDownload() {}, onCancel() {}, onDelete() {},
      ...over,
    }));

  await t.test("a radiogroup with one tab stop on the checked card", () => {
    const html = render();
    assert.match(html, /role="radiogroup"[^>]*aria-label="Language model"/);
    assert.match(html, /role="radio"[^>]*aria-checked="true"[^>]*tabindex="0"[^>]*data-model="qwen-2b"/);
    assert.equal((html.match(/role="radio"[^>]*tabindex="0"/g) ?? []).length, 1);
  });

  await t.test("meters are labelled in words and marked as estimates", () => {
    const html = render();
    assert.match(html, /role="img"[^>]*aria-label="cartridge\.meter\{&quot;label&quot;:&quot;cartridge\.speed&quot;,&quot;value&quot;:4\}"/);
    assert.match(html, /cartridge\.estimate/);
  });

  await t.test("recommended download is the default button, others are outline", () => {
    const html = render({ models: models.map((m) => ({ ...m, isDownloaded: false, isDownloading: false })) });
    // Button renders data-variant before spreading props (button.tsx:139-142).
    assert.match(html, /data-variant="default"[^>]*data-model-action="qwen-2b"/);
    assert.match(html, /data-variant="outline"[^>]*data-model-action="qwen-9b"/);
  });

  await t.test("downloads report progress accessibly", () => {
    assert.match(render(), /role="progressbar"[^>]*aria-valuenow="42"/);
  });

  await t.test("a model too large for this device cannot be downloaded and says why", () => {
    const html = render({ selectedId: "qwen-2b" });
    // "big" is beyond the first five, so expand by selecting it.
    const expanded = render({ selectedId: "big" });
    assert.match(expanded, /data-model="big"[^>]*aria-disabled="true"/);
    assert.match(expanded, /cartridge\.tooLarge/);
    assert.match(html, /cartridge\.showAll\{&quot;count&quot;:8\}/);
  });

  await t.test("in-use chips name the tasks", () => {
    const html = render();
    assert.match(html, /cartridge\.inUseBy/);
    assert.match(html, />Chat</);
    assert.match(html, />Cleanup</);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/rovingNav.test.js test/components/cartridgeMath.test.js test/components/modelCartridgeGrid.test.js`
Expected: FAIL. `stepGrid` is not a function, and the modules are missing.

- [ ] **Step 3: Implement**

1. Append `stepGrid` to `src/components/ui/rovingNav.ts`:

   ```ts
   export function stepGrid(index: number, key: string, opts: { columns: number; count: number; rtl: boolean }): number {
     const { columns, count, rtl } = opts;
     if (count === 0) return index;
     const last = count - 1;
     const forward = rtl ? "ArrowLeft" : "ArrowRight";
     const backward = rtl ? "ArrowRight" : "ArrowLeft";
     switch (key) {
       case forward:
         return Math.min(last, index + 1);
       case backward:
         return Math.max(0, index - 1);
       case "ArrowDown":
         return Math.min(last, index + columns);
       case "ArrowUp":
         return index - columns >= 0 ? index - columns : index;
       case "Home":
         return 0;
       case "End":
         return last;
       default:
         return index;
     }
   }
   ```

2. Create `src/components/ui/cartridgeMath.ts`:

   ```ts
   // Pure helpers for model cartridges (SET-R4 B). Tiers are estimates from
   // file size unless the registry carries curated speedTier/qualityTier.

   export interface CartridgeModel {
     id: string;
     name: string;
     sizeBytes?: number;
     contextLength?: number;
     recommended?: boolean;
     isDownloaded: boolean;
     isDownloading: boolean;
     isCancelling?: boolean;
     progress?: number;
     speedTier?: number;
     qualityTier?: number;
     badge?: string;
   }

   export type Fit = "comfortable" | "tight" | "tooLarge" | "unknown";

   const GB = 1_000_000_000;
   const bucket = (bytes: number, edges: number[]) => {
     const i = edges.findIndex((edge) => bytes <= edge * GB);
     return i === -1 ? edges.length + 1 : i + 1;
   };

   export function estimateTiers(m: Pick<CartridgeModel, "sizeBytes" | "speedTier" | "qualityTier">) {
     const size = m.sizeBytes;
     const memory = size ? bucket(size, [1.5, 3, 5, 8]) : null;
     const sizeSpeed = size ? 6 - bucket(size, [1, 2, 4, 8]) : null;
     const sizeQuality = size ? Math.min(5, bucket(size, [1, 2, 4, 8]) + 1) : null;
     const curated = m.speedTier !== undefined && m.qualityTier !== undefined;
     return {
       speed: m.speedTier ?? sizeSpeed,
       quality: m.qualityTier ?? sizeQuality,
       memory,
       estimated: !curated,
     };
   }

   export function estimateRamBytes(sizeBytes: number): number {
     return sizeBytes * 1.15;
   }

   export function fitFor(sizeBytes: number | undefined, totalMemoryBytes: number | null): Fit {
     if (!sizeBytes || !totalMemoryBytes) return "unknown";
     const share = estimateRamBytes(sizeBytes) / totalMemoryBytes;
     if (share < 0.4) return "comfortable";
     return share <= 0.7 ? "tight" : "tooLarge";
   }

   export function sortForDisplay<T extends Pick<CartridgeModel, "recommended" | "sizeBytes">>(models: T[]): T[] {
     return models
       .map((m, i) => ({ m, i }))
       .sort((a, b) => {
         if (!!a.m.recommended !== !!b.m.recommended) return a.m.recommended ? -1 : 1;
         const sa = a.m.sizeBytes ?? Number.POSITIVE_INFINITY;
         const sb = b.m.sizeBytes ?? Number.POSITIVE_INFINITY;
         return sa === sb ? a.i - b.i : sa - sb;
       })
       .map(({ m }) => m);
   }

   export function visibleModels<T extends Pick<CartridgeModel, "id">>(
     sorted: T[],
     selectedId: string,
     expanded: boolean,
     limit = 5
   ): T[] {
     if (expanded || sorted.length <= limit) return sorted;
     const head = sorted.slice(0, limit);
     const selected = sorted.find((m) => m.id === selectedId);
     return selected && !head.includes(selected) ? [...head, selected] : head;
   }
   ```

   Check the numbers against the tests:
   - Speed buckets are ≤1, ≤2, ≤4 and ≤8 GB. The bucket index for 1.3 GB is 2, so speed is 6 − 2 = 4. 2.7 GB gives index 3, so speed 3. 5.5 GB gives index 4, so speed 2.
   - Quality is the bucket index + 1: 3, 4 and 5.
   - Memory edges are 1.5, 3, 5 and 8 GB: 1.3 GB gives 1, 2.7 GB gives 2, and 5.5 GB gives 4.

3. Create `src/components/ui/ModelCartridgeGrid.tsx`:

   ```tsx
   import { useRef, useState } from "react";
   import { useTranslation } from "react-i18next";
   import { formatDecimalBytes } from "../../utils/formatBytes";
   import { Download, Trash2, X } from "../icons";
   import { Button } from "./button";
   import {
     estimateRamBytes,
     estimateTiers,
     fitFor,
     sortForDisplay,
     visibleModels,
     type CartridgeModel,
   } from "./cartridgeMath";
   import { stepGrid } from "./rovingNav";

   export interface ModelCartridgeGridProps {
     label: string;
     models: CartridgeModel[];
     selectedId: string;
     totalMemoryBytes: number | null;
     usedBy?: Record<string, string[]>;
     onSelect: (id: string) => void;
     onDownload: (id: string) => void;
     onCancel?: (id: string) => void;
     onDelete?: (id: string) => void;
   }

   function Pips({ label, value }: { label: string; value: number }) {
     const { t } = useTranslation();
     return (
       <>
         <span className="text-[11px] text-muted-foreground">{label}</span>
         <span role="img" aria-label={t("cartridge.meter", { label, value })} className="flex gap-0.5">
           {[1, 2, 3, 4, 5].map((n) => (
             <span key={n} className={`h-2.5 w-1.5 rounded-sm ${n <= value ? "bg-foreground/70" : "bg-border"}`} />
           ))}
         </span>
       </>
     );
   }

   export function ModelCartridgeGrid(props: ModelCartridgeGridProps) {
     const { t, i18n } = useTranslation();
     const [expanded, setExpanded] = useState(false);
     const refs = useRef<(HTMLDivElement | null)[]>([]);
     const sorted = sortForDisplay(props.models);
     const shown = visibleModels(sorted, props.selectedId, expanded);
     const checkedIndex = Math.max(0, shown.findIndex((m) => m.id === props.selectedId));
     const [focusIndex, setFocusIndex] = useState(checkedIndex);
     const tabIndexFor = (i: number) => (i === (focusIndex < shown.length ? focusIndex : checkedIndex) ? 0 : -1);
     const rtl = (i18n.dir?.() ?? "ltr") === "rtl";

     const activate = (m: CartridgeModel, tooLarge: boolean) => {
       if (m.isDownloaded) props.onSelect(m.id);
       else if (!m.isDownloading && !tooLarge) props.onDownload(m.id);
     };

     return (
       <div className="space-y-2">
         {/* Always two columns so the arrow-key model (stepGrid columns: 2) matches the layout. */}
         <div role="radiogroup" aria-label={props.label} className="grid grid-cols-2 gap-2.5">
           {shown.map((m, i) => {
             const tiers = estimateTiers(m);
             const fit = fitFor(m.sizeBytes, props.totalMemoryBytes);
             const tooLarge = fit === "tooLarge" && !m.isDownloaded;
             const checked = m.id === props.selectedId;
             const usedBy = props.usedBy?.[m.id] ?? [];
             const reasonId = `cartridge-reason-${m.id}`;
             return (
               <div
                 key={m.id}
                 className={`relative rounded-[10px] border bg-card p-3 transition-[border-color,translate] duration-150 hover:-translate-y-px dark:hover:translate-y-0 ${
                   checked ? "border-2 border-ring p-[11px]" : "border-border"
                 } ${tooLarge ? "opacity-70" : ""}`}
               >
                 <div
                   role="radio"
                   aria-checked={checked}
                   tabIndex={tabIndexFor(i)}
                   data-model={m.id}
                   aria-disabled={tooLarge || undefined}
                   aria-describedby={reasonId}
                   ref={(el) => {
                     refs.current[i] = el;
                   }}
                   onFocus={() => setFocusIndex(i)}
                   onClick={() => activate(m, tooLarge)}
                   onKeyDown={(e) => {
                     if (e.key === " " || e.key === "Enter") {
                       e.preventDefault();
                       activate(m, tooLarge);
                       return;
                     }
                     const next = stepGrid(i, e.key, { columns: 2, count: shown.length, rtl });
                     if (next !== i) {
                       e.preventDefault();
                       refs.current[next]?.focus();
                     }
                   }}
                   className="cursor-pointer rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                 >
                   <div className="flex items-center justify-between gap-2">
                     <span className="text-sm font-semibold">{m.name}</span>
                     {m.recommended && <span className="text-[11px] font-medium text-muted-foreground">{t("common.recommended")}</span>}
                   </div>
                   <div className="mt-2 grid grid-cols-[82px_1fr] items-center gap-x-2 gap-y-1">
                     {tiers.speed !== null && <Pips label={t("cartridge.speed")} value={tiers.speed} />}
                     {tiers.quality !== null && <Pips label={t("cartridge.quality")} value={tiers.quality} />}
                     {tiers.memory !== null && <Pips label={t("cartridge.memory")} value={tiers.memory} />}
                   </div>
                   <p id={reasonId} className="mt-2 text-[11px] text-muted-foreground">
                     {[
                       m.sizeBytes ? formatDecimalBytes(m.sizeBytes) : null,
                       m.contextLength ? t("cartridge.context", { k: Math.round(m.contextLength / 1024) }) : null,
                       m.badge ?? null,
                       tooLarge
                         ? t("cartridge.tooLarge", {
                             needs: formatDecimalBytes(estimateRamBytes(m.sizeBytes!)),
                             total: formatDecimalBytes(props.totalMemoryBytes!),
                           })
                         : fit === "tight"
                           ? t("cartridge.tight")
                           : null,
                       !m.isDownloaded && !m.isDownloading && !tooLarge ? t("cartridge.notDownloaded") : null,
                     ]
                       .filter(Boolean)
                       .join(" · ")}
                   </p>
                 </div>
                 <div className="mt-2 flex items-center justify-between gap-2">
                   {m.isDownloading ? (
                     <div className="flex flex-1 items-center gap-2">
                       <div
                         role="progressbar"
                         aria-valuenow={Math.round(m.progress ?? 0)}
                         aria-valuemin={0}
                         aria-valuemax={100}
                         aria-label={t("cartridge.downloading", { name: m.name })}
                         className="h-1.5 flex-1 overflow-hidden rounded-full border border-border bg-muted"
                       >
                         <div className="h-full bg-foreground/70" style={{ width: `${m.progress ?? 0}%` }} />
                       </div>
                       {props.onCancel && (
                         <Button
                           size="sm"
                           variant="outline"
                           tabIndex={tabIndexFor(i)}
                           data-model-action={m.id}
                           disabled={m.isCancelling}
                           onClick={() => props.onCancel!(m.id)}
                           aria-label={t("cartridge.cancel", { name: m.name })}
                         >
                           <X size={12} aria-hidden="true" />
                         </Button>
                       )}
                     </div>
                   ) : m.isDownloaded ? (
                     <>
                       <span className="text-xs font-medium text-locality-device">{t("routes.state.ready")}</span>
                       {props.onDelete && (
                         <Button
                           size="sm"
                           variant="ghost"
                           tabIndex={tabIndexFor(i)}
                           data-model-action={m.id}
                           onClick={() => props.onDelete!(m.id)}
                           aria-label={t("cartridge.delete", { name: m.name })}
                         >
                           <Trash2 size={12} aria-hidden="true" />
                         </Button>
                       )}
                     </>
                   ) : (
                     <Button
                       size="sm"
                       variant={m.recommended ? "default" : "outline"}
                       tabIndex={tabIndexFor(i)}
                       data-model-action={m.id}
                       disabled={tooLarge}
                       onClick={() => props.onDownload(m.id)}
                     >
                       <Download size={12} className="me-1" aria-hidden="true" />
                       {t("cartridge.download")}
                     </Button>
                   )}
                 </div>
                 {checked && usedBy.length > 0 && (
                   <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                     <span className="text-muted-foreground">{t("cartridge.inUseBy")}</span>
                     {usedBy.map((task) => (
                       <span key={task} className="rounded-full bg-muted px-1.5 py-px font-semibold">{task}</span>
                     ))}
                   </div>
                 )}
               </div>
             );
           })}
         </div>
         <div className="flex items-center justify-between gap-2">
           <p className="text-[11px] text-muted-foreground">{t("cartridge.estimate")}</p>
           {!expanded && sorted.length > shown.length && (
             <Button size="sm" variant="ghost" onClick={() => setExpanded(true)}>
               {t("cartridge.showAll", { count: sorted.length })}
             </Button>
           )}
         </div>
       </div>
     );
   }
   ```

   The pips use `bg-foreground/70`, never orange. Orange is only the selected border (`border-ring`, D1).

4. **Total memory IPC.**
   - In `src/helpers/ipcHandlers.js`, next to `get-model-cache-root` (`:8314`), add `ipcMain.handle("get-total-memory", () => require("os").totalmem());`.
   - In `preload.js`, add `getTotalMemory: () => ipcRenderer.invoke("get-total-memory"),` next to `getModelCacheRoot`.
   - In `src/types/electron.ts`, add `getTotalMemory?: () => Promise<number>;` to `electronAPI`.

   Plan 05 (ONB-R3 C "Detected for you") may add a hardware probe. If it lands first with a total-RAM field, use that and drop this channel.

5. **Wire `LocalModelPicker`** (`:360-385`). Replace `<ModelCardList … />` with:

   ```tsx
   <ModelCartridgeGrid
     label={t("cartridge.groupLabel")}
     models={models.map((model) => ({
       id: model.id,
       name: model.name,
       sizeBytes: model.sizeBytes,
       contextLength: model.contextLength,
       recommended: model.recommended,
       speedTier: model.speedTier,
       qualityTier: model.qualityTier,
       badge: model.imported ? t(`localModels.status.${model.loadStatus || "untested"}`) : undefined,
       isDownloaded: downloadedModels.has(model.id) || !!model.isDownloaded || !!model.downloaded,
       isDownloading: isDownloadingModel(model.id),
       isCancelling: isCancellingModel(model.id),
       progress: downloads[model.id]?.progress,
     }))}
     selectedId={selectedModel}
     totalMemoryBytes={totalMemory}
     usedBy={usedBy}
     onSelect={selectModel}
     onDownload={handleDownload}
     onCancel={cancelDownload}
     onDelete={handleDelete}
   />
   ```

   Add these above the return:

   ```tsx
   const [totalMemory, setTotalMemory] = useState<number | null>(null);
   useEffect(() => {
     window.electronAPI?.getTotalMemory?.().then(setTotalMemory, () => setTotalMemory(null));
   }, []);
   const routes = useResolvedRoutes();
   const usedBy = useMemo(() => {
     const map: Record<string, string[]> = {};
     for (const m of models) {
       const tasks = routes.filter((r) => r.locality === "device" && r.model === m.name).map((r) => t(`routes.names.${r.id}`));
       if (tasks.length) map[m.id] = tasks;
     }
     return map;
   }, [models, routes, t]);
   ```

   - If `LocalModel` (`:25`) lacks `contextLength`, `speedTier` or `qualityTier`, add them as optional. The registry `ModelDefinition` carries them.
   - `downloads[model.id]?.progress` is the same status object the in-flight progress bars read at `:343-349`.
   - After a download completes or a delete succeeds, call `void refreshRouteFacts()` (Task 2) in the existing completion paths (`onDownloadComplete` and the delete confirm handler).

6. **Wire `TranscriptionModelPicker`.** Add the `totalMemory` and `usedBy` hooks from step 5 near the two `useModelDownload` calls (`:820-842`). Use `localModels.map(m => WHISPER_MODEL_INFO[m.model]?.name)` and the Parakeet equivalent for `usedBy`, or build `usedBy` from both renderers' `modelsToRender` names. Then replace the `<div className="space-y-0.5">{modelsToRender.map(… <LocalModelCard …/> …)}</div>` block in each renderer.

   Whisper renderer (`:1043-1080`):

   ```tsx
   <ModelCartridgeGrid
     label={t("cartridge.speechGroupLabel")}
     models={modelsToRender.map((model) => {
       const info = WHISPER_MODEL_INFO[model.model];
       return {
         id: model.model,
         name: info?.name ?? model.model,
         // size_mb is only reported once a file exists; fall back to the registry.
         sizeBytes: (model.size_mb ?? info?.sizeMb) ? (model.size_mb ?? info!.sizeMb) * 1_000_000 : undefined,
         recommended: info?.recommended,
         isDownloaded: model.downloaded ?? false,
         isDownloading: isDownloadingModel(model.model),
         isCancelling: isCancellingModel(model.model),
         progress: whisperDownloads[model.model]?.progress,
       };
     })}
     selectedId={selectedLocalModel}
     totalMemoryBytes={totalMemory}
     usedBy={usedBy}
     onSelect={handleWhisperModelSelect}
     onDelete={handleDelete}
     onDownload={(modelId) =>
       downloadModel(modelId, (downloadedId) => {
         setLocalModels((prev) =>
           prev.map((m) => (m.model === downloadedId ? { ...m, downloaded: true } : m))
         );
         handleWhisperModelSelect(downloadedId);
         void refreshRouteFacts();
       })
     }
     onCancel={cancelDownload}
   />
   ```

   Parakeet renderer (`:1121-1160`):

   ```tsx
   <ModelCartridgeGrid
     label={t("cartridge.speechGroupLabel")}
     models={modelsToRender.map((model) => {
       const info = PARAKEET_MODEL_INFO[model.model];
       return {
         id: model.model,
         name: info?.name ?? model.model,
         // size_mb is only reported once a file exists; fall back to the registry.
         sizeBytes:
           model.size_bytes ??
           (info?.expectedSizeBytes ?? ((model.size_mb ?? info?.sizeMb) ? (model.size_mb ?? info!.sizeMb) * 1_000_000 : undefined)),
         recommended: info?.recommended,
         isDownloaded: model.downloaded ?? false,
         isDownloading: isDownloadingParakeetModel(model.model),
         isCancelling: isCancellingParakeetModel(model.model),
         progress: parakeetDownloads[model.model]?.progress,
       };
     })}
     selectedId={selectedLocalModel}
     totalMemoryBytes={totalMemory}
     usedBy={usedBy}
     onSelect={handleParakeetModelSelect}
     onDelete={handleParakeetDelete}
     onDownload={(modelId) =>
       downloadParakeetModel(modelId, (downloadedId) => {
         setParakeetModels((prev) =>
           prev.map((m) => (m.model === downloadedId ? { ...m, downloaded: true } : m))
         );
         handleParakeetModelSelect(downloadedId);
         void refreshRouteFacts();
       })
     }
     onCancel={cancelParakeetDownload}
   />
   ```

   The callbacks are the bodies the `LocalModelCard` props receive today, with `modelId` taken as a parameter. The "installing" phase (`whisperDownloads[id]?.phase === "installing"`) keeps the card in its downloading state, because `isDownloadingModel` stays true until installation finishes. Then delete `LocalModelCard` and its props interface (`:56-~200`). `npm run lint` flags an unused import if anything is left over.

7. Write `/tmp/loqui-i18n-task-10.json` and merge it. The `en` block is:

   ```json
   {
     "cartridge": {
       "groupLabel": "Language model",
       "speechGroupLabel": "Speech model",
       "speed": "Speed",
       "quality": "Quality",
       "memory": "Memory use",
       "meter": "{{label}} {{value}} of 5",
       "estimate": "Pips are estimates from file size unless measured. Nothing is uploaded.",
       "context": "{{k}}k context",
       "tight": "Tight on this device",
       "tooLarge": "Too large for this device: needs about {{needs}}, this device has {{total}}",
       "notDownloaded": "Not downloaded. Press Enter to download.",
       "download": "Download",
       "downloading": "Downloading {{name}}",
       "cancel": "Cancel downloading {{name}}",
       "delete": "Delete {{name}}",
       "inUseBy": "In use by",
       "showAll_one": "Show all {{count}}",
       "showAll_other": "Show all {{count}}"
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/rovingNav.test.js test/components/cartridgeMath.test.js test/components/modelCartridgeGrid.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

Then check manually against card R4 B (`05-settings.html:1086-1097`), in both locales:
- In LLMs → Chat → Local, the grid shows up to 5 cards with Recommended first. Tab lands once on the checked card, and arrows move.
- In Arabic, ← moves to the next card.
- Enter on an undownloaded card starts its download, and the progress bar announces.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/rovingNav.ts src/components/ui/cartridgeMath.ts src/components/ui/ModelCartridgeGrid.tsx src/models/ModelRegistry.ts src/components/LocalModelPicker.tsx src/components/TranscriptionModelPicker.tsx src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/locales test/components/rovingNav.test.js test/components/cartridgeMath.test.js test/components/modelCartridgeGrid.test.js
git commit -m "feat(settings): Cartridge model cards with radio semantics"
```

---

