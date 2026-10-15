### Task 7: Routing page and the Patchbay switchboard (SET-R1 B)

This adds a new first item under AI Models, **Routing**, that answers "where does each task run?" in one view:
- 11 task jacks on the left and destinations on the right.
- Cables show where audio and text go: solid for this device, dotted for your server, dashed for a provider. Cables are decoration. The task and destination buttons are the canonical DOM.
- Picking a destination goes through Task 5's rules: local is instant with Undo, and remote is staged into the Apply bar.
- A footer meter counts what stays on this device.
- Below 720px of board width the cables hide and the columns stack ("falls back to the list").

**Files:**
- Create: `src/components/settings/routing/destinations.ts` (pure)
- Create: `src/components/settings/routing/Patchbay.tsx`
- Create: `src/components/settings/routing/RoutingSection.tsx`
- Modify: `src/components/SettingsPage.tsx`. Add `"routing"` to `SettingsSectionType` (`:111-112`), and a `case "routing"` in `renderSectionContent` (`:1625`) that renders `<RoutingSection onNavigateToPath={onNavigateToPath} />`.
- Modify: `src/lib/settingsPaths.ts`. Add `"routing"` to `SETTINGS_SECTIONS`, and add `routes: "routing"` to `SECTION_ALIASES`.
- Modify: `src/components/SettingsModal.tsx`. Add the sidebar item as the first in the `aiModels` group (`:50-96`).
- Modify: `src/components/ui/SidebarModal.tsx`:
  - Widen the dialog from `max-w-4xl` to `max-w-5xl` (`:121-135`).
  - Add the escape-claim rule to `DialogPrimitive.Content`.
- Modify: `src/components/icons/index.ts`. Add `Waypoints`.
- Modify: `src/index.css`. Append the `.patchbay-*` rules after the Plan 01 `.locality-ring` block.
- Modify: `src/locales/*/translation.json`
- Test: `test/components/patchbayDestinations.test.js`, `test/components/patchbay.test.js`

**Interfaces:**
- Consumes:
  - from Tasks 1–6: `ResolvedRoute`, `RouteSettingsSnapshot`, `useResolvedRoutes`, `ROUTE_IDS`, `ROUTE_KIND`, `targetFromSnapshot`, `RouteTarget`, `useRouteChange().request`, `useRouteDraftStore`, `currentRouteSnapshot`, `capabilityOf`, `providersFor`, `providerHost`, `RouteStateChip` and `RouteDestinationChip`;
  - from Plan 01: `providerDisplayName` (sorting only), `providerDisplayLabel` (every name shown) and `LocalityRing`.
- Produces:

  ```ts
  // destinations.ts
  export interface RouteDestination {
    id: string;                       // "device" | "network" | provider id
    locality: Locality;
    providerId: string | null;
    name: string;                     // display name; device/network names are translated by the UI
    host: string | null;              // "api.openai.com", "192.168.1.20:11434"
    url: string | null;               // network only: first self-hosted URL in use
    hasKey: boolean;                  // providers: saved and not rejected
  }
  export type Compatibility = { ok: true } | { ok: false; reasonKey: string; params?: Record<string, string> };
  export function routeDestinationId(snapshot: RouteSettingsSnapshot, route: ResolvedRoute): string;
  export function buildDestinations(snapshot: RouteSettingsSnapshot, routes: ResolvedRoute[]): RouteDestination[];
  export function checkCompatibility(routeId: RouteId, dest: RouteDestination): Compatibility;
  export function targetForDestination(snapshot: RouteSettingsSnapshot, routeId: RouteId, dest: RouteDestination): RouteTarget;
  export function privacyTally(routes: ResolvedRoute[]): { total: number; stay: number; network: number; remote: number };
  export function cablePath(from: { x: number; y: number }, to: { x: number; y: number }): string;
  // Patchbay.tsx
  export function PatchbayView(props: PatchbayViewProps): JSX.Element;   // presentational, SSR-testable
  export function Patchbay(props: { onNavigateToPath?: (path: string) => void }): JSX.Element;
  // RoutingSection.tsx
  export function RoutingSection(props: { onNavigateToPath?: (path: string) => void }): JSX.Element;
  ```

  `SidebarModal` gains this rule: while focus is inside an element with `data-escape-active="true"`, Escape is left to that element instead of closing the dialog. Task 13's search uses it too.

- [ ] **Step 1: Write the failing tests**

Create `test/components/patchbayDestinations.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const SENDS = Object.fromEntries(
  ["dictationStt", "noteRecordingStt", "uploadStt", "dictationCleanup", "voiceAssistant", "assistantVision", "translation", "noteFormatting", "chat"].map((id) => [id, id])
);
const stt = (o = {}) => ({ mode: "local", localProvider: "whisper", localModel: "base", cloudProvider: "", cloudModel: "", cloudBaseUrl: "", remoteUrl: "", remoteModel: "", ...o });
const llm = (o = {}) => ({ mode: "local", provider: "qwen", model: "q", remoteUrl: "", cloudBaseUrl: "", ...o });

function snapshot() {
  return {
    stt: { dictation: stt(), meeting: stt(), upload: stt({ mode: "providers", cloudProvider: "openai", cloudModel: "gpt-4o-mini-transcribe" }) },
    llm: {
      dictationCleanup: llm(), dictationAgent: llm(), dictationAgentVision: llm(),
      dictationTranslation: llm({ mode: "self-hosted", remoteUrl: "http://192.168.1.20:11434/v1", model: "llama3.1:8b" }),
      noteFormatting: llm(), chatIntelligence: llm({ mode: "providers", provider: "groq", model: "openai/gpt-oss-120b" }),
    },
    enabled: { cleanup: false, voiceAssistant: true, screenContext: false, visionOverride: false, translation: true, speakerId: true },
    savedKeys: new Set(["openai", "anthropic"]),
    rejectedKeys: new Set(["anthropic"]),
    installedModels: null,
    models: {},
    speakerIdModelsReady: true,
    searchModelReady: true,
    sealed: false,
    sends: SENDS,
  };
}

test("patchbay destinations", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-patchbay-dest-test-" });
  const { resolveRoutes } = await vite.ssrLoadModule("/lib/routes.ts");
  const d = await vite.ssrLoadModule("/components/settings/routing/destinations.ts");
  const s = snapshot();
  const routes = resolveRoutes(s);
  const dests = d.buildDestinations(s, routes);
  const byId = Object.fromEntries(dests.map((x) => [x.id, x]));

  await t.test("device and network always exist, then providers in use or with a saved key", () => {
    assert.deepEqual(dests.map((x) => x.id), ["device", "network", "anthropic", "groq", "openai"]);
    assert.equal(byId.network.host, "192.168.1.20:11434");
    assert.equal(byId.network.url, "http://192.168.1.20:11434/v1");
    assert.equal(byId.openai.host, "api.openai.com");
    assert.equal(byId.groq.hasKey, false);
    assert.equal(byId.anthropic.hasKey, false, "a rejected key is not a usable key");
    assert.equal(byId.openai.hasKey, true);
  });

  await t.test("each route maps to the destination it uses", () => {
    const at = (id) => d.routeDestinationId(s, routes.find((r) => r.id === id));
    assert.equal(at("dictationStt"), "device");
    assert.equal(at("uploadStt"), "openai");
    assert.equal(at("translation"), "network");
    assert.equal(at("chat"), "groq");
  });

  await t.test("compatibility explains every refusal", () => {
    assert.deepEqual(d.checkCompatibility("dictationStt", byId.device), { ok: true });
    assert.equal(d.checkCompatibility("dictationStt", byId.anthropic).ok, false);
    assert.equal(d.checkCompatibility("dictationStt", byId.anthropic).reasonKey, "patchbay.no.capability");
    assert.equal(d.checkCompatibility("assistantVision", byId.device).reasonKey, "patchbay.no.visionCloudOnly");
    assert.equal(d.checkCompatibility("noteRecordingStt", byId.network).reasonKey, "patchbay.no.meetingServer");
    assert.equal(d.checkCompatibility("speakerId", byId.device).reasonKey, "patchbay.locked.speakerId");
    assert.deepEqual(d.checkCompatibility("chat", byId.openai), { ok: true });
  });

  await t.test("targets: device is local, network reuses a server of the same kind, providers are bare", () => {
    assert.deepEqual(d.targetForDestination(s, "chat", byId.device), { mode: "local" });
    assert.deepEqual(d.targetForDestination(s, "noteFormatting", byId.network), { mode: "self-hosted", remoteUrl: "http://192.168.1.20:11434/v1" });
    assert.deepEqual(
      d.targetForDestination(s, "dictationStt", byId.network),
      { mode: "self-hosted", remoteUrl: "" },
      "an LLM server is never offered as a speech server"
    );
    assert.deepEqual(d.targetForDestination(s, "dictationCleanup", byId.openai), { mode: "providers", provider: "openai" });
  });

  await t.test("the tally counts what stays on this device; off routes send nothing", () => {
    assert.deepEqual(d.privacyTally(routes), { total: 11, stay: 8, network: 1, remote: 2 });
  });

  await t.test("cables are horizontal-tangent cubic Béziers", () => {
    assert.equal(d.cablePath({ x: 10, y: 20 }, { x: 310, y: 80 }), "M 10 20 C 130 20, 190 80, 310 80");
  });
});
```

The tally is 8 stay, 1 network and 2 remote. That is 6 device routes, plus the off cleanup route, plus assistant vision, which is off because screen context is off. Translation is on the network. Upload (OpenAI) and chat (Groq) are remote.

Create `test/components/patchbay.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("patchbay view", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-patchbay-view-test-" }, { withOptions: true }));
  const { PatchbayView } = await vite.ssrLoadModule("/components/settings/routing/Patchbay.tsx");
  const ids = ["dictationStt", "noteRecordingStt", "uploadStt", "dictationCleanup", "voiceAssistant", "assistantVision", "translation", "noteFormatting", "chat", "speakerId", "semanticSearch"];
  const kind = (id) => (id.endsWith("Stt") ? "speech" : id === "speakerId" || id === "semanticSearch" ? "support" : "text");
  const routes = ids.map((id) => ({
    id, kind: kind(id), locality: id === "chat" ? "remote" : "device", provider: id === "chat" ? "Groq" : null,
    providerId: id === "chat" ? "groq" : null,
    model: "M", state: id === "chat" ? { status: "needsKey", provider: "Groq" } : { status: "ready" },
    sends: id === "chat" ? "x" : null, settingsPath: "llms/x",
  }));
  const destinations = [
    { id: "device", locality: "device", providerId: null, name: "device", host: null, url: null, hasKey: true },
    { id: "network", locality: "network", providerId: null, name: "network", host: null, url: null, hasKey: true },
    { id: "anthropic", locality: "remote", providerId: "anthropic", name: "Anthropic", host: "api.anthropic.com", url: null, hasKey: true },
    { id: "groq", locality: "remote", providerId: "groq", name: "Groq", host: "api.groq.com", url: null, hasKey: false },
  ];
  const base = {
    routes,
    destinations,
    destinationOf: (r) => (r.id === "chat" ? "groq" : "device"),
    selectedId: null,
    stagedRouteId: null,
    message: null,
    wide: true,
    onSelectTask() {},
    onPickDestination() {},
    onOpenSettings() {},
  };

  await t.test("every task and destination is a real button; cables are hidden from assistive tech", () => {
    const html = renderToStaticMarkup(React.createElement(PatchbayView, base));
    assert.equal((html.match(/data-task="/g) ?? []).length, 11);
    assert.equal((html.match(/data-destination="/g) ?? []).length, 4);
    assert.match(html, /role="group"[^>]*aria-label="patchbay\.tasks"/);
    assert.match(html, /role="group"[^>]*aria-label="patchbay\.destinations"/);
    assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*class="patchbay-cables"/);
    assert.match(html, /data-task="speakerId"[^>]*aria-disabled="true"/);
    assert.match(html, /patchbay\.locked\.speakerId/);
  });

  await t.test("selecting a task marks compatible and incompatible destinations with reasons", () => {
    const html = renderToStaticMarkup(React.createElement(PatchbayView, { ...base, selectedId: "dictationStt" }));
    assert.match(html, /data-task="dictationStt"[^>]*aria-pressed="true"/);
    assert.match(html, /data-destination="anthropic"[^>]*data-compat="no"[^>]*aria-disabled="true"/);
    assert.match(html, /data-destination="groq"[^>]*data-compat="ok"/);
  });

  await t.test("the meter counts what stays on this device and names what leaves", () => {
    const html = renderToStaticMarkup(React.createElement(PatchbayView, base));
    assert.match(html, /role="img"[^>]*aria-label="patchbay\.meter\.label\{&quot;count&quot;:10,&quot;total&quot;:11\}"/);
    assert.match(html, /patchbay\.leaves\.item\{&quot;task&quot;:&quot;routes\.names\.chat&quot;,&quot;destination&quot;:&quot;Groq&quot;\}/);
  });

  await t.test("narrow boards drop the cables and keep the list", () => {
    const html = renderToStaticMarkup(React.createElement(PatchbayView, { ...base, wide: false }));
    assert.doesNotMatch(html, /patchbay-cables/);
    assert.match(html, /data-layout="list"/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/patchbayDestinations.test.js test/components/patchbay.test.js`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement**

1. Add `export const Waypoints = createIcon("waypoints", Lucide.Waypoints);` to `src/components/icons/index.ts`.

2. Create `src/components/settings/routing/destinations.ts`:

   ```ts
   import { providerDisplayName, type Locality } from "../../../lib/locality";
   import type { ResolvedRoute, RouteId, RouteSettingsSnapshot } from "../../../lib/routes";
   import { targetFromSnapshot, type RouteTarget } from "../../../lib/routeTargets";
   import { capabilityOf, providerHost, providersForRoute } from "./providerCatalog";

   export interface RouteDestination {
     id: string;
     locality: Locality;
     providerId: string | null;
     name: string;
     host: string | null;
     url: string | null;
     hasKey: boolean;
   }

   export type Compatibility =
     | { ok: true }
     | { ok: false; reasonKey: string; params?: Record<string, string> };

   function hostOf(url: string): string | null {
     try {
       return new URL(url).host || null;
     } catch {
       return null;
     }
   }

   export function routeDestinationId(s: RouteSettingsSnapshot, route: ResolvedRoute): string {
     if (route.locality === "device") return "device";
     if (route.locality === "network") return "network";
     const target = targetFromSnapshot(s, route.id);
     return target.mode === "providers" && target.provider ? target.provider : "unknown";
   }

   export function buildDestinations(s: RouteSettingsSnapshot, routes: ResolvedRoute[]): RouteDestination[] {
     const serverUrl =
       [...Object.values(s.stt).map((i) => i.remoteUrl), ...Object.values(s.llm).map((i) => i.remoteUrl)]
         .map((u) => u.trim())
         .find((u) => u && hostOf(u)) ?? null;
     const providerIds = new Set<string>();
     for (const route of routes) {
       const id = routeDestinationId(s, route);
       if (id !== "device" && id !== "network" && id !== "unknown") providerIds.add(id);
     }
     // savedKeys also holds internal credential ids such as "corti:speech"; skip them.
     for (const id of s.savedKeys) if (!id.includes(":")) providerIds.add(id);
     const providers = [...providerIds]
       .map<RouteDestination>((id) => ({
         id,
         locality: "remote",
         providerId: id,
         name: providerDisplayName(id),
         host: providerHost(id),
         url: null,
         hasKey: id === "custom" || (s.savedKeys.has(id) && !s.rejectedKeys.has(id)),
       }))
       .sort((a, b) => a.name.localeCompare(b.name));
     return [
       { id: "device", locality: "device", providerId: null, name: "device", host: null, url: null, hasKey: true },
       {
         id: "network",
         locality: "network",
         providerId: null,
         name: "network",
         host: serverUrl ? hostOf(serverUrl) : null,
         url: serverUrl,
         hasKey: true,
       },
       ...providers,
     ];
   }

   export function checkCompatibility(routeId: RouteId, dest: RouteDestination): Compatibility {
     if (routeId === "speakerId" || routeId === "semanticSearch") {
       return { ok: false, reasonKey: `patchbay.locked.${routeId}` };
     }
     if (routeId === "assistantVision" && dest.locality !== "remote") {
       return { ok: false, reasonKey: "patchbay.no.visionCloudOnly" };
     }
     if (dest.id === "device") return { ok: true };
     if (dest.id === "network") {
       // Note recording's self-hosted option is not available yet (MeetingSettings.tsx:89).
       return routeId === "noteRecordingStt"
         ? { ok: false, reasonKey: "patchbay.no.meetingServer" }
         : { ok: true };
     }
     if (dest.providerId && providersForRoute(routeId).includes(dest.providerId)) return { ok: true };
     return { ok: false, reasonKey: "patchbay.no.capability", params: { provider: dest.name } };
   }

   export function targetForDestination(s: RouteSettingsSnapshot, routeId: RouteId, dest: RouteDestination): RouteTarget {
     if (dest.id === "device") return { mode: "local" };
     if (dest.id === "network") {
       const current = targetFromSnapshot(s, routeId);
       if (current.mode === "self-hosted" && current.remoteUrl) return { mode: "self-hosted", remoteUrl: current.remoteUrl };
       // Only reuse a server that serves the same kind of task: speech audio must
       // never be pointed at an LLM server, or chat at a Whisper server.
       const pool =
         capabilityOf(routeId) === "speech"
           ? Object.values(s.stt).map((i) => i.remoteUrl)
           : Object.values(s.llm).map((i) => i.remoteUrl);
       return { mode: "self-hosted", remoteUrl: pool.map((u) => u.trim()).find((u) => u && hostOf(u)) ?? "" };
     }
     return { mode: "providers", provider: dest.providerId ?? dest.id };
   }

   export function privacyTally(routes: ResolvedRoute[]) {
     let stay = 0;
     let network = 0;
     let remote = 0;
     for (const r of routes) {
       if (r.sends === null) stay++;
       else if (r.locality === "network") network++;
       else remote++;
     }
     return { total: routes.length, stay, network, remote };
   }

   export function cablePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
     return `M ${from.x} ${from.y} C ${from.x + 120} ${from.y}, ${to.x - 120} ${to.y}, ${to.x} ${to.y}`;
   }
   ```

3. Create `src/components/settings/routing/Patchbay.tsx`. The view is pure props, and the container wires hooks and measures cables:

   ```tsx
   import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
   import { useTranslation } from "react-i18next";
   import { providerDisplayLabel } from "../../../lib/locality";
   import { useResolvedRoutes, type ResolvedRoute, type RouteId } from "../../../lib/routes";
   import { currentRouteSnapshot, useRouteDraftStore } from "../../../stores/routeDraftStore";
   import { ChevronRight, Lock } from "../../icons";
   import { LocalityRing } from "../../ui/LocalityRing";
   import { RouteDestinationChip, RouteStateChip } from "./RouteChips";
   import {
     buildDestinations,
     cablePath,
     checkCompatibility,
     privacyTally,
     routeDestinationId,
     targetForDestination,
     type RouteDestination,
   } from "./destinations";
   import { useRouteChange } from "./useRouteChange";

   export interface PatchbayViewProps {
     routes: ResolvedRoute[];
     destinations: RouteDestination[];
     destinationOf: (route: ResolvedRoute) => string;
     selectedId: RouteId | null;
     stagedRouteId: RouteId | null;
     message: string | null;
     wide: boolean;
     cables?: { id: RouteId; d: string; locality: string; paused: boolean; staged: boolean }[];
     boardRef?: React.Ref<HTMLDivElement>;
     onSelectTask: (id: RouteId) => void;
     onPickDestination: (dest: RouteDestination) => void;
     onOpenSettings: (route: ResolvedRoute) => void;
   }

   const GROUPS: { key: "speech" | "text" | "support"; kind: ResolvedRoute["kind"] }[] = [
     { key: "speech", kind: "speech" },
     { key: "text", kind: "text" },
     { key: "support", kind: "support" },
   ];

   export function PatchbayView(props: PatchbayViewProps) {
     const { t } = useTranslation();
     const { routes, destinations, selectedId, wide } = props;
     const selected = routes.find((r) => r.id === selectedId) ?? null;
     const tally = privacyTally(routes);
     const leaving = routes.filter((r) => r.sends !== null);
     const destName = (d: RouteDestination) =>
       d.id === "device"
         ? t("locality.device")
         : d.id === "network"
           ? t("locality.network")
           : providerDisplayLabel(d.providerId, t);

     return (
       <div className="space-y-3">
         <p role="status" aria-live="polite" className="text-xs text-muted-foreground min-h-4">
           {props.message ??
             (selected
               ? t("patchbay.hint.pickDestination", { task: t(`routes.names.${selected.id}`) })
               : t("patchbay.hint.idle"))}
         </p>
         <div
           ref={props.boardRef}
           data-layout={wide ? "board" : "list"}
           data-escape-active={selectedId ? "true" : "false"}
           className="patchbay-board relative"
         >
           {wide && (
             <svg aria-hidden="true" className="patchbay-cables">
               {(props.cables ?? []).map((c) => (
                 <path
                   key={c.id}
                   d={c.d}
                   data-locality={c.locality}
                   data-paused={c.paused ? "true" : "false"}
                   data-staged={c.staged ? "true" : "false"}
                   data-dim={selectedId && selectedId !== c.id ? "true" : "false"}
                 />
               ))}
             </svg>
           )}
           <div role="group" aria-label={t("patchbay.tasks")} className="patchbay-tasks">
             {GROUPS.map((group) => (
               <div key={group.key} className="space-y-1">
                 <p className="text-[11px] font-semibold text-muted-foreground px-1">{t(`routes.groups.${group.key}`)}</p>
                 {routes
                   .filter((r) => r.kind === group.kind)
                   .map((route) => {
                     const locked = route.kind === "support";
                     return (
                       <div key={route.id} className="flex items-center gap-1">
                         <button
                           type="button"
                           data-task={route.id}
                           aria-pressed={selectedId === route.id}
                           aria-disabled={locked || undefined}
                           title={locked ? t(`patchbay.locked.${route.id}`) : undefined}
                           onClick={() => props.onSelectTask(route.id)}
                           data-staged={props.stagedRouteId === route.id ? "true" : "false"}
                           className="patchbay-task"
                         >
                           <span className="min-w-0 flex-1 text-start">
                             <span className="block text-xs font-semibold text-foreground truncate">
                               {t(`routes.names.${route.id}`)}
                             </span>
                             <RouteDestinationChip route={route} className="h-5" />
                           </span>
                           {locked ? (
                             <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                               <Lock className="h-3 w-3" aria-hidden="true" />
                               <span className="sr-only">{t(`patchbay.locked.${route.id}`)}</span>
                             </span>
                           ) : (
                             <RouteStateChip state={route.state} />
                           )}
                           <span className="patchbay-jack" data-jack={`task:${route.id}`} data-locality={route.locality} aria-hidden="true" />
                         </button>
                         <button
                           type="button"
                           onClick={() => props.onOpenSettings(route)}
                           aria-label={t("patchbay.openSettings", { task: t(`routes.names.${route.id}`) })}
                           className="h-7 w-7 shrink-0 rounded-md grid place-items-center text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                         >
                           <ChevronRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                         </button>
                       </div>
                     );
                   })}
               </div>
             ))}
           </div>
           <div role="group" aria-label={t("patchbay.destinations")} className="patchbay-destinations">
             {destinations.map((dest) => {
               const compat = selected ? checkCompatibility(selected.id, dest) : null;
               const count = routes.filter((r) => r.state.status !== "off" && props.destinationOf(r) === dest.id).length;
               return (
                 <button
                   key={dest.id}
                   type="button"
                   data-destination={dest.id}
                   data-compat={compat ? (compat.ok ? "ok" : "no") : undefined}
                   aria-disabled={compat && compat.ok === false ? true : undefined}
                   title={compat && compat.ok === false ? t(compat.reasonKey, compat.params) : undefined}
                   data-locality={dest.locality}
                   onClick={() => props.onPickDestination(dest)}
                   className="patchbay-destination"
                 >
                   <span className="patchbay-jack" data-jack={`dest:${dest.id}`} data-locality={dest.locality} aria-hidden="true" />
                   <span className="flex items-center justify-between gap-2">
                     <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                       <LocalityRing
                         locality={dest.locality}
                         label={dest.locality === "remote" ? t("locality.remote", { provider: destName(dest) }) : destName(dest)}
                         provider={dest.locality === "remote" ? destName(dest) : null}
                         size={16}
                       />
                       {destName(dest)}
                     </span>
                     <span className="text-[11px] text-muted-foreground">{t("patchbay.taskCount", { count })}</span>
                   </span>
                   {dest.host && (
                     <span className="block font-mono text-[11px] text-muted-foreground truncate" dir="ltr">
                       {dest.host}
                     </span>
                   )}
                   <span className="block text-[11px] text-muted-foreground">
                     {dest.locality === "device"
                       ? t("patchbay.dest.nothingLeaves")
                       : dest.locality === "network"
                         ? dest.url?.startsWith("http:")
                           ? t("patchbay.dest.unencrypted")
                           : t("patchbay.dest.yourServer")
                         : dest.hasKey
                           ? t("patchbay.dest.keySaved")
                           : t("patchbay.dest.noKey")}
                   </span>
                   {compat && compat.ok === false && <span className="sr-only">{t(compat.reasonKey, compat.params)}</span>}
                 </button>
               );
             })}
           </div>
         </div>
         <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 sm:grid-cols-[minmax(240px,1fr)_1.4fr]">
           <div>
             <div
               role="img"
               aria-label={t("patchbay.meter.label", { count: tally.stay, total: tally.total })}
               className="flex gap-1"
             >
               {routes.map((r) => (
                 <span
                   key={r.id}
                   className="patchbay-meter-seg"
                   data-locality={r.sends === null ? "device" : r.locality}
                 />
               ))}
             </div>
             <p className="mt-2 text-xs">
               {t("patchbay.meter.headline", { count: tally.stay, total: tally.total })}
               {tally.network > 0 && ` · ${t("patchbay.meter.network", { count: tally.network })}`}
             </p>
           </div>
           <p className="text-xs text-muted-foreground">
             {leaving.length === 0
               ? t("patchbay.leaves.none")
               : `${t("patchbay.leaves.prefix")} ${leaving
                   .map((r) =>
                     t("patchbay.leaves.item", {
                       task: t(`routes.names.${r.id}`),
                       destination: r.locality === "network" ? t("locality.network") : providerDisplayLabel(r.providerId, t),
                     })
                   )
                   .join(" · ")}`}
           </p>
         </div>
       </div>
     );
   }

   export function Patchbay({ onNavigateToPath }: { onNavigateToPath?: (path: string) => void }) {
     const { t } = useTranslation();
     const routes = useResolvedRoutes();
     const { request, sends } = useRouteChange();
     const draft = useRouteDraftStore((s) => s.draft);
     const [selectedId, setSelectedId] = useState<RouteId | null>(null);
     const [message, setMessage] = useState<string | null>(null);
     const [wide, setWide] = useState(true);
     const [cables, setCables] = useState<PatchbayViewProps["cables"]>([]);
     const boardRef = useRef<HTMLDivElement>(null);

     // `routes` changes whenever settings or facts change; rebuild the snapshot with it.
     // eslint-disable-next-line react-hooks/exhaustive-deps
     const snapshot = useMemo(() => currentRouteSnapshot(sends), [sends, routes]);
     const destinations = useMemo(() => buildDestinations(snapshot, routes), [snapshot, routes]);
     const destinationOf = useCallback((r: ResolvedRoute) => routeDestinationId(snapshot, r), [snapshot]);

     const measure = useCallback(() => {
       const board = boardRef.current;
       if (!board) return;
       const box = board.getBoundingClientRect();
       setWide(box.width >= 720);
       const center = (el: Element | null) => {
         if (!el) return null;
         const r = el.getBoundingClientRect();
         return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
       };
       const rtl = getComputedStyle(board).direction === "rtl";
       setCables(
         routes
           .filter((r) => r.state.status !== "off")
           .map((r) => {
             const destId = draft?.routeId === r.id ? null : destinationOf(r);
             const from = center(board.querySelector(`[data-jack="task:${r.id}"]`));
             const to = center(board.querySelector(`[data-jack="dest:${destId ?? "network"}"]`));
             if (!from || !to || !destId) return null;
             const [a, b] = rtl ? [to, from] : [from, to];
             return {
               id: r.id,
               d: cablePath(a, b),
               locality: r.locality,
               paused: r.state.status !== "ready",
               staged: false,
             };
           })
           .filter((c): c is NonNullable<typeof c> => c !== null)
       );
     }, [routes, draft, destinationOf]);

     useLayoutEffect(() => {
       measure();
       const board = boardRef.current;
       if (!board || typeof ResizeObserver === "undefined") return;
       const observer = new ResizeObserver(() => measure());
       observer.observe(board);
       return () => observer.disconnect();
     }, [measure]);

     const onSelectTask = (id: RouteId) => {
       const route = routes.find((r) => r.id === id)!;
       if (route.kind === "support") {
         setMessage(t(`patchbay.locked.${id}`));
         return;
       }
       setMessage(null);
       setSelectedId((cur) => (cur === id ? null : id));
     };

     const onPickDestination = (dest: RouteDestination) => {
       if (!selectedId) {
         setMessage(t("patchbay.hint.pickTaskFirst"));
         return;
       }
       const route = routes.find((r) => r.id === selectedId)!;
       const compat = checkCompatibility(selectedId, dest);
       if (compat.ok === false) {
         setMessage(t(compat.reasonKey, compat.params));
         return;
       }
       if (destinationOf(route) === dest.id && route.state.status !== "off") {
         setMessage(
           t("patchbay.hint.already", {
             task: t(`routes.names.${route.id}`),
             destination:
               dest.id === "device"
                 ? t("locality.device")
                 : dest.id === "network"
                   ? t("locality.network")
                   : providerDisplayLabel(dest.providerId, t),
           })
         );
         return;
       }
       request(selectedId, targetForDestination(snapshot, selectedId, dest));
       setSelectedId(null);
       setMessage(null);
     };

     return (
       <div
         onKeyDown={(e) => {
           if (e.key === "Escape" && selectedId) {
             setSelectedId(null);
             setMessage(null);
           }
         }}
       >
         <PatchbayView
           routes={routes}
           destinations={destinations}
           destinationOf={destinationOf}
           selectedId={selectedId}
           stagedRouteId={draft?.routeId ?? null}
           message={message}
           wide={wide}
           cables={cables}
           boardRef={boardRef}
           onSelectTask={onSelectTask}
           onPickDestination={onPickDestination}
           onOpenSettings={(route) => onNavigateToPath?.(route.settingsPath)}
         />
       </div>
     );
   }
   ```

   The staged change itself is shown by the modal-level Apply bar (Task 6). The task row shows a dashed outline through `data-staged`.

4. Create `src/components/settings/routing/RoutingSection.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { useRouteDraftStore } from "../../../stores/routeDraftStore";
   import { SectionHeader } from "../../ui/SettingsSection";
   import { Patchbay } from "./Patchbay";
   import { StagedRoutePanel } from "./StagedRoutePanel";

   export function RoutingSection({ onNavigateToPath }: { onNavigateToPath?: (path: string) => void }) {
     const { t } = useTranslation();
     const draft = useRouteDraftStore((s) => s.draft);
     return (
       <div className="space-y-6">
         <div>
           <SectionHeader title={t("patchbay.title")} description={t("patchbay.description")} />
           <Patchbay onNavigateToPath={onNavigateToPath} />
           {/* A staged pick needs its provider, key or URL right here; the Apply bar alone is a dead end. */}
           {draft && (
             <div className="mt-3">
               <StagedRoutePanel routeId={draft.routeId} />
             </div>
           )}
         </div>
       </div>
     );
   }
   ```

   Task 9 appends the keyring below the Patchbay.

5. Append to `src/index.css`, after the `.locality-ring` block:

   ```css
   /* Patchbay (DESIGN.md "Settings · Routing"). The list is the DOM; cables
      are decoration. Shape carries locality: solid device, dotted network,
      dashed remote. */
   .patchbay-board[data-layout="board"] {
     display: grid;
     grid-template-columns: minmax(250px, 300px) minmax(48px, 1fr) minmax(240px, 300px);
   }
   .patchbay-board[data-layout="board"] .patchbay-tasks { grid-column: 1; }
   .patchbay-board[data-layout="board"] .patchbay-destinations { grid-column: 3; }
   .patchbay-board[data-layout="list"] { display: grid; gap: 1rem; }
   .patchbay-board[data-layout="list"] .patchbay-jack { display: none; }
   .patchbay-tasks, .patchbay-destinations { display: grid; gap: 0.75rem; align-content: start; }
   .patchbay-destinations { gap: 0.5rem; }
   .patchbay-task, .patchbay-destination {
     position: relative;
     display: flex;
     width: 100%;
     align-items: center;
     gap: 0.5rem;
     min-height: 44px;
     padding: 0.25rem 1.25rem 0.25rem 0.625rem;
     border-radius: 10px;
     border: 1px solid var(--color-border);
     background: var(--color-card);
     text-align: start;
   }
   .patchbay-destination {
     display: block;
     min-height: 62px;
     padding: 0.5rem 0.75rem 0.5rem 1rem;
   }
   .patchbay-destination[data-locality="remote"] { border-style: dashed; }
   .patchbay-task[aria-pressed="true"] { border-color: var(--color-ring); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-ring) 20%, transparent); }
   .patchbay-task[data-staged="true"] { border: 1.5px dashed var(--color-locality-remote); }
   .patchbay-task[aria-disabled="true"] { background: var(--color-muted); color: var(--color-muted-foreground); }
   .patchbay-destination[data-compat="ok"] { border: 2px solid var(--color-ring); }
   .patchbay-destination[data-compat="no"] { opacity: 0.45; }
   .patchbay-task:focus-visible, .patchbay-destination:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px; }
   .patchbay-jack {
     position: absolute;
     top: 50%;
     width: 18px;
     height: 18px;
     margin-top: -9px;
     border-radius: 9999px;
     border: 2.5px solid var(--color-locality-device);
     background: var(--color-background);
   }
   .patchbay-task .patchbay-jack { inset-inline-end: -9px; }
   .patchbay-destination .patchbay-jack { inset-inline-start: -9px; }
   .patchbay-jack[data-locality="network"] { border-color: var(--color-locality-network); border-style: dotted; }
   .patchbay-jack[data-locality="remote"] { border-color: var(--color-locality-remote); border-style: dashed; }
   .patchbay-cables {
     position: absolute;
     inset: 0;
     width: 100%;
     height: 100%;
     overflow: visible;
     pointer-events: none;
   }
   .patchbay-cables path {
     fill: none;
     stroke: var(--color-locality-device);
     stroke-width: 2.4;
     stroke-linecap: round;
     animation: patchbay-cable-in var(--motion-base) var(--motion-ease-enter) both;
     transition: opacity var(--motion-fast) var(--motion-ease-std);
   }
   .patchbay-cables path[data-locality="network"] { stroke: var(--color-locality-network); stroke-dasharray: 0.5 5; }
   .patchbay-cables path[data-locality="remote"] { stroke: var(--color-locality-remote); stroke-dasharray: 6 5; }
   .patchbay-cables path[data-paused="true"] { opacity: 0.55; stroke-dasharray: 2 6; }
   .patchbay-cables path[data-dim="true"] { opacity: 0.16; }
   .patchbay-meter-seg { flex: 1; height: 6px; border-radius: 3px; background: var(--color-locality-device); }
   .patchbay-meter-seg[data-locality="network"] { background: var(--color-locality-network); }
   .patchbay-meter-seg[data-locality="remote"] {
     background: repeating-linear-gradient(135deg, var(--color-locality-remote) 0 3px, transparent 3px 5px);
     outline: 1px solid var(--color-locality-remote);
     outline-offset: -1px;
   }
   @keyframes patchbay-cable-in { from { opacity: 0; } }
   ```

   This is opacity-only, so reduced motion needs no override: the existing policy keeps opacity feedback. No loop runs. The mock's "flowing" dashes are not shipped, because the app has no live-request signal to gate them on, and a loop must be gated to its active state (§4).

6. Wire the section:
   - `SettingsSectionType`: `"general" | "hotkeys" | "routing" | "speechToText" | "llms" | "privacyData" | "system"`.
   - `renderSectionContent`: add `case "routing": return <RoutingSection onNavigateToPath={onNavigateToPath} />;` directly after the `hotkeys` case and before `case "speechToText":`. Task 12's structure test relies on this order.
   - `settingsPaths.ts`: insert `"routing"` after `"hotkeys"` in `SETTINGS_SECTIONS`, and add `routes: "routing"` to `SECTION_ALIASES`.
   - `SettingsModal.tsx` sidebar items: insert this before the `speechToText` item:

     ```tsx
     {
       id: "routing",
       label: t("settingsModal.sections.routing.label"),
       icon: Waypoints,
       description: t("settingsModal.sections.routing.description"),
       group: t("settingsModal.groups.aiModels"),
     },
     ```

     Import `Waypoints` from `./icons`.

7. In `src/components/ui/SidebarModal.tsx`:
   - Change `max-w-4xl` to `max-w-5xl` on the dialog content (`:121-135`).
   - Extend the existing `onEscapeKeyDown` on `DialogPrimitive.Content` (`SidebarModal.tsx:123-125`, which guards hotkey capture). Keep that guard:

     ```tsx
     onEscapeKeyDown={(e) => {
       if (document.querySelector("[data-capturing]")) e.preventDefault();
       // A widget with a transient state (Patchbay selection, search query)
       // claims Escape while that state exists; the dialog closes on the next press.
       const active = document.activeElement;
       if (active instanceof Element && active.closest('[data-escape-active="true"]')) e.preventDefault();
     }}
     ```

8. Write `/tmp/loqui-i18n-task-7.json` and merge it. The `en` block is below. `taskCount` and `meter.*` need every plural category per locale (Global Constraints).

   ```json
   {
     "settingsModal": { "sections": { "routing": { "label": "Routing", "description": "Where each task runs" } } },
     "patchbay": {
       "title": "Routing",
       "description": "Every task, and where it runs right now. Moves to this device apply instantly; moves to a server or provider wait for you to apply them.",
       "tasks": "Tasks",
       "destinations": "Destinations",
       "openSettings": "Open {{task}} settings",
       "hint": {
         "idle": "Choose a task, then where it should run.",
         "pickDestination": "Send {{task}} to… choose a highlighted destination.",
         "pickTaskFirst": "Choose a task first, then where it should run.",
         "already": "{{task}} already runs on {{destination}}."
       },
       "locked": {
         "speakerId": "Locked to this device: speaker identification needs your recordings on-device.",
         "semanticSearch": "Locked to this device: embeddings stay local, so search never sends your notes anywhere."
       },
       "no": {
         "capability": "{{provider}} can't run this task in Loqui.",
         "visionCloudOnly": "Screenshots can only go to a cloud vision model today.",
         "meetingServer": "Note recording can't use your own server yet."
       },
       "dest": {
         "nothingLeaves": "Nothing leaves",
         "yourServer": "Your own server",
         "unencrypted": "http, not encrypted",
         "keySaved": "API key saved",
         "noKey": "No API key yet"
       },
       "taskCount_one": "{{count}} task",
       "taskCount_other": "{{count}} tasks",
       "meter": {
         "label_one": "{{count}} of {{total}} task stays on this device",
         "label_other": "{{count}} of {{total}} tasks stay on this device",
         "headline_one": "{{count}} of {{total}} task stays on this device",
         "headline_other": "{{count}} of {{total}} tasks stay on this device",
         "network_one": "{{count}} on your server",
         "network_other": "{{count}} on your server"
       },
       "leaves": {
         "none": "Nothing leaves this device.",
         "prefix": "Leaves this device:",
         "item": "{{task}} → {{destination}}"
       }
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/patchbayDestinations.test.js test/components/patchbay.test.js test/lib/settingsPaths.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

Then check manually in the app, light and Plum Night, comparing against card R1 B (`05-settings.html:197-221`):
- Routing lists 11 tasks.
- Click Chat, then "This device": it applies instantly with an Undo toast.
- Click Chat, then a provider: the Apply bar appears.
- Click Dictation, and Anthropic dims with a reason.
- Esc clears the selection without closing Settings. A second Esc closes it.
- Narrow the window until the cables disappear.
- With reduced motion on, there is no motion beyond fades.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/routing src/components/SettingsPage.tsx src/components/SettingsModal.tsx src/components/ui/SidebarModal.tsx src/lib/settingsPaths.ts src/components/icons/index.ts src/index.css src/locales test/components/patchbayDestinations.test.js test/components/patchbay.test.js
git commit -m "feat(settings): Routing page with the Patchbay switchboard"
```

---

