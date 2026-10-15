### Task 6: Stage, review, apply in the editors (SET-R3 B UI, SET-Q10)

Switching a route to Cloud or Self-hosted no longer happens on click. Instead:
- The radio shows the staged choice with "Staged, not active".
- A dashed panel asks "Send dictation to a cloud provider?" and lets the user pick a provider, add a key or enter a URL.
- A sticky bar at the bottom of the modal says exactly what will leave the device, and holds the only primary button: Apply.

Switching to Local stays instant, with a toast that names the destination and an Undo. Cloud opens with no provider chosen, which fixes SET-13. Every mode toast names the destination and payload (SET-Q10).

**Files:**
- Create: `src/components/settings/routing/providerCatalog.ts` (pure)
- Create: `src/components/settings/routing/StagedRoutePanel.tsx`
- Create: `src/components/settings/routing/StagedRouteBar.tsx`
- Create: `src/components/settings/routing/useRouteChange.ts`
- Modify: `src/lib/routes.ts`. Export the key-field map as `PROVIDER_KEY_FIELDS`.
- Modify: `src/stores/routeDraftStore.ts`. Add `stagedTargetForMode` and `withDraftDiscard`.
- Modify: `src/components/ui/SidebarModal.tsx`. Add a `footer` slot rendered sticky at the bottom of the content column (`:243-259`).
- Modify: `src/components/SettingsModal.tsx`. Discard the draft on close, and render the bar.
- Modify the four mode handlers so they use `useRouteChange`, render the panel, and pass `stagedMode`:
  - `src/components/SettingsPage.tsx`: `handleTranscriptionModeSelect` (`:526-548`), plus `CLEANUP_MODE_TOAST_KEY` and `handleCleanupModeChange` (`:677-716`);
  - `src/components/settings/MeetingSettings.tsx:87-95`;
  - `src/components/settings/UploadSettings.tsx:68-75`;
  - `src/components/settings/InferenceConfigEditor.tsx:97-124`.
- Modify: `src/locales/*/translation.json`. Add `staging.*`, and delete the now-unused `settingsPage.transcription.toasts.{switchedProviders,switchedLocal,switchedSelfHosted}` and `settingsPage.aiModels.toasts.{switchedProviders,switchedLocal,switchedSelfHosted}`. Grep first, and delete only keys with no remaining `t(` reference.
- Test: `test/components/providerCatalog.test.js`, `test/components/stagedRoute.test.js`

**Interfaces:**
- Consumes, from Task 5: `RouteTarget`, `previewRoute`, `applyBlocker`, `routeChangeMessage`, `useRouteDraftStore`, `requestRouteChange`, `applyDraft` and `currentRouteSnapshot`.
- Consumes, from Task 4: `RouteDestinationChip`, `InferenceModeSelector`'s `stagedMode` prop, and `ApiKeyInput` (`src/components/ui/ApiKeyInput.tsx`, props `{ apiKey, setApiKey, label?, ariaLabel?, placeholder?, helpText? }`).
- Consumes `useToast().toast` (`src/components/ui/useToast.ts:44`) with `actions: ToastActionConfig[]` (`{ label, onClick, dismissOnClick? }`). Plan 04 migrates this call site to `notify()` (spec §5.3).
- Produces:

  ```ts
  // providerCatalog.ts
  export type ProviderCapability = "speech" | "text" | "vision";
  export function capabilityOf(id: RouteId): ProviderCapability | null;   // null for support routes
  export function providersForRoute(id: RouteId): string[];               // provider ids that can run this task; "custom" last where allowed
  export function providerHost(providerId: string): string | null;        // e.g. "api.openai.com", for copy
  // routeDraftStore.ts (additive)
  export function stagedTargetForMode(mode: InferenceMode, current: RouteTarget): RouteTarget;
  export function withDraftDiscard(onOpenChange: (open: boolean) => void): (open: boolean) => void;
  // useRouteChange.ts
  export function useRouteChange(): {
    request: (id: RouteId, target: RouteTarget) => void;   // instant+toast for local, stage otherwise
    apply: () => RouteChangeOutcome | null;                  // toast on success
    sends: Record<SendsKey, string>;
  };
  // StagedRouteBar.tsx
  export function StagedRouteBarView(props: { preview: ResolvedRoute; host: string | null; blocker: ApplyBlocker | null; onApply: () => void; onDiscard: () => void }): JSX.Element;
  export function StagedRouteBar(): JSX.Element | null;
  // StagedRoutePanel.tsx
  export function StagedRoutePanelView(props: StagedRoutePanelViewProps): JSX.Element;   // see code
  export function StagedRoutePanel(props: { routeId: RouteId }): JSX.Element | null;
  // src/lib/routes.ts (additive)
  export const PROVIDER_KEY_FIELDS: Record<string, keyof SettingsState>;   // the former KEY_FIELDS plus corti: "cortiApiKey"
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/components/providerCatalog.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

test("provider catalog", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-provider-catalog-test-" });
  const c = await vite.ssrLoadModule("/components/settings/routing/providerCatalog.ts");

  await t.test("capabilities follow the route kind", () => {
    assert.equal(c.capabilityOf("uploadStt"), "speech");
    assert.equal(c.capabilityOf("chat"), "text");
    assert.equal(c.capabilityOf("assistantVision"), "vision");
    assert.equal(c.capabilityOf("semanticSearch"), null);
  });

  await t.test("dictation offers every registry speech provider plus custom, never text-only services", () => {
    const speech = c.providersForRoute("dictationStt");
    assert.ok(speech.includes("openai") && speech.includes("deepgram"));
    assert.ok(!speech.includes("anthropic") && !speech.includes("codex"));
    assert.equal(speech.at(-1), "custom");
  });

  await t.test("note recording offers only the streaming providers main runs; upload drops realtime-only ones", () => {
    const notes = c.providersForRoute("noteRecordingStt");
    assert.ok(notes.every((p) => ["openai", "assemblyai", "deepgram", "corti", "tinfoil"].includes(p)));
    assert.ok(!notes.includes("custom"));
    const upload = c.providersForRoute("uploadStt");
    assert.ok(!upload.includes("deepgram") && !upload.includes("assemblyai"));
    assert.ok(upload.includes("openai"));
  });

  await t.test("vision providers are the ones with a vision-capable model", () => {
    const vision = c.providersForRoute("assistantVision");
    assert.ok(vision.includes("openai"));
    assert.ok(!vision.includes("codex"));
    assert.ok(!vision.includes("custom"));
    assert.deepEqual(c.providersForRoute("semanticSearch"), []);
  });

  await t.test("hosts are known for registry providers", () => {
    assert.equal(c.providerHost("openai"), "api.openai.com");
    assert.equal(c.providerHost("custom"), null);
  });
});
```

Create `test/components/stagedRoute.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("staged route UI", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-staged-route-test-" }, { withOptions: true }));
  const bar = await vite.ssrLoadModule("/components/settings/routing/StagedRouteBar.tsx");
  const panel = await vite.ssrLoadModule("/components/settings/routing/StagedRoutePanel.tsx");
  const draft = await vite.ssrLoadModule("/stores/routeDraftStore.ts");

  const preview = {
    id: "dictationStt", kind: "speech", locality: "remote", provider: "OpenAI", providerId: "openai", model: "GPT-4o Mini Transcribe",
    state: { status: "ready" }, sends: "your audio and dictionary words", settingsPath: "stt/dictation",
  };

  await t.test("the bar says what leaves the device and Apply is the only primary action", () => {
    const html = renderToStaticMarkup(React.createElement(bar.StagedRouteBarView, { preview, host: "api.openai.com", blocker: null, onApply() {}, onDiscard() {} }));
    assert.match(html, /role="region"/);
    assert.match(html, /OpenAI · GPT-4o Mini Transcribe/);
    assert.match(html, /dir="ltr"[^>]*>api\.openai\.com</, "the bar names the host that receives the data");
    assert.match(html, /staging\.leaves\{&quot;payload&quot;:&quot;your audio and dictionary words&quot;\}/);
    assert.match(html, /staging\.apply/);
    assert.match(html, /<kbd[^>]*>.*↵<\/kbd>/);
    assert.doesNotMatch(html, /data-variant="live"/, "Apply is never orange");
    assert.doesNotMatch(html, /disabled=""/);
  });

  await t.test("a blocked apply is disabled and says why", () => {
    const html = renderToStaticMarkup(React.createElement(bar.StagedRouteBarView, {
      preview: { ...preview, state: { status: "needsKey", provider: "OpenAI" } }, host: null, blocker: "needsKey", onApply() {}, onDiscard() {},
    }));
    assert.match(html, /disabled=""/);
    assert.match(html, /role="status"[^>]*>[^<]*staging\.blocked\.needsKey\{&quot;provider&quot;:&quot;OpenAI&quot;\}/);
  });

  await t.test("the cloud panel offers providers with key status and no pre-armed choice", () => {
    const html = renderToStaticMarkup(React.createElement(panel.StagedRoutePanelView, {
      routeId: "dictationStt",
      target: { mode: "providers", provider: "" },
      providers: [{ id: "openai", name: "OpenAI", hasKey: true }, { id: "groq", name: "Groq", hasKey: false }],
      onTarget() {},
      keyField: null,
    }));
    assert.match(html, /staging\.cloud\.title/);
    assert.match(html, /role="group"[^>]*aria-label="staging\.provider"/);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 0, "no provider is chosen for the user");
    assert.match(html, /staging\.keySaved/);
    assert.match(html, /staging\.noKey/);
  });

  await t.test("upload shows the shared dictation server instead of an editable URL", () => {
    const html = renderToStaticMarkup(React.createElement(panel.StagedRoutePanelView, {
      routeId: "uploadStt",
      target: { mode: "self-hosted", remoteUrl: "http://192.168.1.5:8178" },
      providers: [],
      onTarget() {},
      keyField: null,
    }));
    assert.match(html, /staging\.url\.sharedWithDictation/);
    assert.doesNotMatch(html, /<input/);
  });

  await t.test("the server panel labels its URL field and explains plain http", () => {
    const html = renderToStaticMarkup(React.createElement(panel.StagedRoutePanelView, {
      routeId: "translation",
      target: { mode: "self-hosted", remoteUrl: "http://192.168.1.20:11434/v1" },
      providers: [],
      onTarget() {},
      keyField: null,
    }));
    assert.match(html, /<label[^>]*for="staged-url-translation"/);
    assert.match(html, /id="staged-url-translation"/);
    assert.match(html, /staging\.url\.http/);
    assert.match(html, /placeholder="http:\/\/localhost:11434\/v1"/);
  });

  await t.test("choosing Cloud never pre-arms a provider; choosing Self-hosted keeps the known URL", () => {
    assert.deepEqual(draft.stagedTargetForMode("providers", { mode: "local" }), { mode: "providers", provider: "" });
    assert.deepEqual(draft.stagedTargetForMode("self-hosted", { mode: "self-hosted", remoteUrl: "http://a:1" }), { mode: "self-hosted", remoteUrl: "http://a:1" });
    assert.deepEqual(draft.stagedTargetForMode("self-hosted", { mode: "local" }), { mode: "self-hosted", remoteUrl: "" });
    assert.deepEqual(draft.stagedTargetForMode("local", { mode: "providers", provider: "x" }), { mode: "local" });
  });

  await t.test("closing the modal discards the draft", () => {
    draft.useRouteDraftStore.getState().stage({ routeId: "chat", target: { mode: "providers", provider: "groq" } });
    const seen = [];
    const handler = draft.withDraftDiscard((open) => seen.push(open));
    handler(true);
    assert.ok(draft.useRouteDraftStore.getState().draft, "opening keeps it");
    handler(false);
    assert.equal(draft.useRouteDraftStore.getState().draft, null);
    assert.deepEqual(seen, [true, false]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/providerCatalog.test.js test/components/stagedRoute.test.js`
Expected: FAIL. The modules and exports are missing.

- [ ] **Step 3: Implement**

1. In `src/lib/routes.ts`, rename `KEY_FIELDS` to `PROVIDER_KEY_FIELDS`, export it, add `corti: "cortiApiKey"`, and keep the existing Corti client-id/secret line in `buildRouteSnapshot`. `buildRouteSnapshot` iterates it unchanged.

2. Create `src/components/settings/routing/providerCatalog.ts`:

   ```ts
   import modelRegistryData from "../../../models/modelRegistryData.json";
   import { MEETING_STREAMING_PROVIDER_IDS } from "../../../helpers/meetingTranscriptionRouting.js";
   import { STREAMING_ONLY_PROVIDERS } from "../../../helpers/transcriptionRoute";
   import type { RouteId } from "../../../lib/routes";

   // Which providers can serve which kind of task. Speech comes from the
   // transcription registry; text mirrors ReasoningModelSelector's
   // CLOUD_PROVIDER_IDS (src/components/ReasoningModelSelector.tsx:47-60);
   // vision is every text provider with a vision-capable model in the registry.

   export type ProviderCapability = "speech" | "text" | "vision";

   const TEXT_PROVIDER_IDS = [
     "openai", "anthropic", "gemini", "groq", "openrouter", "tinfoil", "corti",
     "codex", "bedrock", "azure", "vertex",
   ];

   interface RegistryProvider { id: string; baseUrl?: string; models?: { supportsVision?: boolean }[] }
   const textRegistry = [
     ...(modelRegistryData.cloudProviders as RegistryProvider[]),
     ...(modelRegistryData.enterpriseProviders as RegistryProvider[]),
   ];
   const speechRegistry = modelRegistryData.transcriptionProviders as RegistryProvider[];

   export function capabilityOf(id: RouteId): ProviderCapability | null {
     if (id === "dictationStt" || id === "noteRecordingStt" || id === "uploadStt") return "speech";
     if (id === "assistantVision") return "vision";
     if (id === "speakerId" || id === "semanticSearch") return null;
     return "text";
   }

   export function providersForRoute(id: RouteId): string[] {
     const capability = capabilityOf(id);
     if (capability === null) return [];
     if (capability === "speech") {
       const speech = speechRegistry.map((p) => p.id);
       // Note recording only runs the streaming clients main supports
       // (meetingTranscriptionRouting.js) and has no custom endpoint.
       if (id === "noteRecordingStt") return speech.filter((p) => MEETING_STREAMING_PROVIDER_IDS.includes(p));
       // Upload is batch-only, so realtime-only providers cannot serve it.
       if (id === "uploadStt") return [...speech.filter((p) => !STREAMING_ONLY_PROVIDERS.has(p)), "custom"];
       return [...speech, "custom"];
     }
     if (capability === "vision") {
       return textRegistry.filter((p) => p.models?.some((m) => m.supportsVision)).map((p) => p.id);
     }
     return [...TEXT_PROVIDER_IDS, "custom"];
   }

   const KNOWN_HOSTS: Record<string, string> = {
     anthropic: "api.anthropic.com",
     gemini: "generativelanguage.googleapis.com",
     openrouter: "openrouter.ai",
     codex: "chatgpt.com",
   };

   export function providerHost(providerId: string): string | null {
     if (providerId === "custom") return null;
     const baseUrl = [...speechRegistry, ...textRegistry].find((p) => p.id === providerId && p.baseUrl)?.baseUrl;
     if (baseUrl) {
       try {
         return new URL(baseUrl).host;
       } catch {
         /* fall through */
       }
     }
     return KNOWN_HOSTS[providerId] ?? null;
   }
   ```

3. Add to `src/stores/routeDraftStore.ts`:

   ```ts
   import type { InferenceMode } from "../types/electron";

   // Cloud never opens on a provider the user did not pick (SET-13).
   export function stagedTargetForMode(mode: InferenceMode, current: RouteTarget): RouteTarget {
     if (mode === "local") return { mode: "local" };
     if (mode === "self-hosted") {
       return { mode: "self-hosted", remoteUrl: current.mode === "self-hosted" ? current.remoteUrl : "" };
     }
     return { mode: "providers", provider: "" };
   }

   // Closing Settings never applies a pending change.
   export function withDraftDiscard(onOpenChange: (open: boolean) => void): (open: boolean) => void {
     return (open) => {
       if (!open) useRouteDraftStore.getState().discard();
       onOpenChange(open);
     };
   }
   ```

4. Create `src/components/settings/routing/useRouteChange.ts`:

   ```ts
   import { useCallback, useMemo } from "react";
   import { useTranslation } from "react-i18next";
   import { routeSendsCopy, type RouteId } from "../../../lib/routes";
   import { routeChangeMessage, type RouteTarget } from "../../../lib/routeTargets";
   import { applyDraft, requestRouteChange, type RouteChangeOutcome } from "../../../stores/routeDraftStore";
   import { useToast } from "../../ui/useToast";

   export function useRouteChange() {
     const { t } = useTranslation();
     const { toast } = useToast();
     const sends = useMemo(() => routeSendsCopy(t), [t]);

     const announce = useCallback(
       (outcome: RouteChangeOutcome) => {
         if (!outcome.applied) return;
         const message = routeChangeMessage(outcome.route, t);
         toast({
           title: message.title,
           description: message.description,
           variant: "success",
           duration: 7000,
           actions: outcome.undo
             ? [{ label: t("routes.toast.undo"), onClick: outcome.undo, dismissOnClick: true }]
             : undefined,
         });
       },
       [t, toast]
     );

     const request = useCallback(
       (id: RouteId, target: RouteTarget) => {
         const result = requestRouteChange(id, target, sends);
         if (result !== "staged") announce(result);
       },
       [sends, announce]
     );

     const apply = useCallback(() => {
       const outcome = applyDraft(sends);
       if (outcome) announce(outcome);
       return outcome;
     }, [sends, announce]);

     return { request, apply, sends };
   }
   ```

5. Create `src/components/settings/routing/StagedRouteBar.tsx`:

   ```tsx
   import { useEffect, useMemo } from "react";
   import { useTranslation } from "react-i18next";
   import type { ResolvedRoute } from "../../../lib/routes";
   import { applyBlocker, previewRoute, type ApplyBlocker, type RouteTarget } from "../../../lib/routeTargets";
   import { currentRouteSnapshot, useRouteDraftStore } from "../../../stores/routeDraftStore";
   import { useRouteFactsStore } from "../../../stores/routeFactsStore";
   import { useSettingsStore } from "../../../stores/settingsStore";
   import { providerDisplayLabel } from "../../../lib/locality";
   import { Button } from "../../ui/button";
   import { providerHost } from "./providerCatalog";
   import { RouteDestinationChip } from "./RouteChips";
   import { useRouteChange } from "./useRouteChange";

   const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

   export function StagedRouteBarView({
     preview,
     host,
     blocker,
     onApply,
     onDiscard,
   }: {
     preview: ResolvedRoute;
     host: string | null;
     blocker: ApplyBlocker | null;
     onApply: () => void;
     onDiscard: () => void;
   }) {
     const { t } = useTranslation();
     const payload = preview.sends ?? t(`routes.sends.${preview.id}`);
     return (
       <div
         role="region"
         aria-label={t("staging.region")}
         className="sticky bottom-0 z-20 -mx-6 mt-6 flex flex-wrap items-center gap-3 border-t border-border/70 bg-background/90 px-6 py-3 backdrop-blur-md"
       >
         <div className="min-w-0 flex-1 text-xs">
           <div className="flex min-w-0 flex-wrap items-center gap-1.5">
             <span className="font-medium">{t(`routes.names.${preview.id}`)} →</span>
             <RouteDestinationChip route={preview} />
             {host && (
               <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">
                 {host}
               </span>
             )}
           </div>
           <p className="mt-0.5 font-medium text-locality-remote">
             {preview.locality === "network"
               ? t("staging.leavesToServer", { payload })
               : t("staging.leaves", { payload })}
           </p>
           <p role="status" aria-live="polite" className="mt-0.5 text-destructive">
             {blocker
               ? t(`staging.blocked.${blocker}`, {
                   provider: preview.providerId ? providerDisplayLabel(preview.providerId, t) : "",
                 })
               : ""}
           </p>
         </div>
         <div className="flex shrink-0 items-center gap-2">
           <Button size="sm" variant="outline" onClick={onDiscard}>
             {t("staging.discard")}
           </Button>
           <Button size="sm" onClick={onApply} disabled={blocker !== null}>
             {t("staging.apply")}
             <kbd aria-hidden="true" className="ms-1.5 font-mono text-[11px] opacity-70" dir="ltr">
               {isMac ? "⌘↵" : "Ctrl ↵"}
             </kbd>
           </Button>
         </div>
       </div>
     );
   }

   export function StagedRouteBar() {
     const draft = useRouteDraftStore((s) => s.draft);
     const discard = useRouteDraftStore((s) => s.discard);
     const settings = useSettingsStore();
     const facts = useRouteFactsStore((s) => s.facts);
     const { apply, sends } = useRouteChange();

     const preview = useMemo(
       () => (draft ? previewRoute(currentRouteSnapshot(sends), draft.routeId, draft.target) : null),
       // settings and facts are dependencies so the preview follows key saves and sealed changes.
       // eslint-disable-next-line react-hooks/exhaustive-deps
       [draft, sends, settings, facts]
     );
     const blocker = draft && preview ? applyBlocker(preview, draft.target) : null;
     const host = draft ? draftHost(draft.target) : null;

     useEffect(() => {
       if (!draft) return;
       const onKey = (event: KeyboardEvent) => {
         // Only inside the Settings dialog, so ⌘↵ elsewhere (chat, notes) never applies a route.
         if (!(event.target instanceof Element) || !event.target.closest('[role="dialog"]')) return;
         if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !blocker) {
           event.preventDefault();
           apply();
         }
       };
       document.addEventListener("keydown", onKey);
       return () => document.removeEventListener("keydown", onKey);
     }, [draft, blocker, apply]);

     // Unmounting Settings (ControlPanel removes the modal) also drops the draft.
     useEffect(() => () => useRouteDraftStore.getState().discard(), []);

     if (!draft || !preview) return null;
     return <StagedRouteBarView preview={preview} host={host} blocker={blocker} onApply={apply} onDiscard={discard} />;
   }

   // The receiving host, shown in the bar so the user sees exactly where data goes.
   function draftHost(target: RouteTarget): string | null {
     const hostOf = (url: string) => {
       try {
         return new URL(url.trim()).host || null;
       } catch {
         return null;
       }
     };
     if (target.mode === "self-hosted") return hostOf(target.remoteUrl);
     if (target.mode === "providers") {
       return target.provider === "custom" ? hostOf(target.baseUrl ?? "") : providerHost(target.provider);
     }
     return null;
   }
   ```

   The default `Button` variant is the ink capsule from Plan 01 (D1), never `live`. Apply is the only default-variant button inside the bar.

6. Create `src/components/settings/routing/StagedRoutePanel.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { providerDisplayLabel } from "../../../lib/locality";
   import { PROVIDER_KEY_FIELDS, type RouteId } from "../../../lib/routes";
   import type { RouteTarget } from "../../../lib/routeTargets";
   import { useRouteDraftStore } from "../../../stores/routeDraftStore";
   import { useSettingsStore, type SettingsState } from "../../../stores/settingsStore";
   import { useRouteFactsStore } from "../../../stores/routeFactsStore";
   import ApiKeyInput from "../../ui/ApiKeyInput";
   import { Input } from "../../ui/input";
   import { providersForRoute } from "./providerCatalog";

   export interface StagedProviderOption { id: string; name: string; hasKey: boolean }
   export interface StagedRoutePanelViewProps {
     routeId: RouteId;
     target: RouteTarget;
     providers: StagedProviderOption[];
     onTarget: (target: RouteTarget) => void;
     keyField: { value: string; onChange: (value: string) => void } | null;
   }

   function urlHint(url: string): "empty" | "invalid" | "http" | "ok" {
     if (!url.trim()) return "empty";
     try {
       const u = new URL(url.trim());
       if (u.protocol === "http:") return "http";
       return u.protocol === "https:" ? "ok" : "invalid";
     } catch {
       return "invalid";
     }
   }

   export function StagedRoutePanelView({ routeId, target, providers, onTarget, keyField }: StagedRoutePanelViewProps) {
     const { t } = useTranslation();
     if (target.mode === "local") return null;
     const task = t(`routes.names.${routeId}`);
     const payload = t(`routes.sends.${routeId}`);
     const urlValue = target.mode === "self-hosted" ? target.remoteUrl : (target.baseUrl ?? "");
     const showUrl = target.mode === "self-hosted" || target.provider === "custom";
     const urlId = `staged-url-${routeId}`;
     const hint = urlHint(urlValue);
     const setUrl = (value: string) =>
       onTarget(target.mode === "self-hosted" ? { mode: "self-hosted", remoteUrl: value } : { ...target, baseUrl: value });

     return (
       <div className="rounded-lg border border-dashed border-locality-remote/70 bg-locality-remote/5 px-4 py-3 text-xs space-y-3">
         <div>
           <p className="text-sm font-semibold text-foreground">
             {target.mode === "self-hosted" ? t("staging.server.title", { task }) : t("staging.cloud.title", { task })}
           </p>
           <p className="mt-1 text-muted-foreground">
             {target.mode === "self-hosted" ? t("staging.server.body", { payload }) : t("staging.cloud.body", { payload })}
           </p>
         </div>
         {target.mode === "providers" && (
           <div role="group" aria-label={t("staging.provider")} className="flex flex-wrap gap-1.5">
             {providers.map((p) => (
               <button
                 key={p.id}
                 type="button"
                 aria-pressed={target.provider === p.id}
                 onClick={() => onTarget({ mode: "providers", provider: p.id })}
                 className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                   target.provider === p.id ? "border-primary bg-primary/10" : "border-border bg-background"
                 }`}
               >
                 {p.name}
                 <span className="text-muted-foreground">{p.hasKey ? t("staging.keySaved") : t("staging.noKey")}</span>
               </button>
             ))}
           </div>
         )}
         {keyField && (
           <ApiKeyInput apiKey={keyField.value} setApiKey={keyField.onChange} label={t("staging.addKey")} />
         )}
         {showUrl && routeId === "uploadStt" && target.mode === "self-hosted" && (
           <p className="text-muted-foreground" dir="auto">
             {t("staging.url.sharedWithDictation", { url: urlValue || "—" })}
           </p>
         )}
         {showUrl && !(routeId === "uploadStt" && target.mode === "self-hosted") && (
           <div className="space-y-1.5">
             <label htmlFor={urlId} className="block text-xs font-medium text-foreground">
               {target.mode === "self-hosted" ? t("settingsPage.selfHosted.serverUrl") : t("staging.baseUrl")}
             </label>
             <Input
               id={urlId}
               dir="ltr"
               value={urlValue}
               onChange={(e) => setUrl(e.target.value)}
               placeholder="http://localhost:11434/v1"
               className="h-8 text-sm"
             />
             <p className={hint === "invalid" ? "text-destructive" : "text-muted-foreground"}>{t(`staging.url.${hint}`)}</p>
           </div>
         )}
       </div>
     );
   }

   export function StagedRoutePanel({ routeId }: { routeId: RouteId }) {
     const { t } = useTranslation();
     const draft = useRouteDraftStore((s) => s.draft);
     const stage = useRouteDraftStore((s) => s.stage);
     const settings = useSettingsStore();
     const extra = useRouteFactsStore((s) => s.facts.extraCredentials);
     if (!draft || draft.routeId !== routeId || draft.target.mode === "local") return null;
     const providers = providersForRoute(routeId).map((id) => {
       const field = PROVIDER_KEY_FIELDS[id];
       return {
         id,
         name: providerDisplayLabel(id, t),
         hasKey: id === "custom" ? true : field ? !!settings[field] : extra.has(id),
       };
     });
     const chosen = draft.target.mode === "providers" ? draft.target.provider : "";
     const field = chosen ? (PROVIDER_KEY_FIELDS[chosen] as keyof SettingsState | undefined) : undefined;
     const keyField =
       field && !settings[field]
         ? {
             value: String(settings[field] ?? ""),
             onChange: (value: string) => settings.updateApiKeys({ [field]: value }),
           }
         : null;
     return (
       <StagedRoutePanelView
         routeId={routeId}
         target={draft.target}
         providers={providers}
         onTarget={(target) => stage({ routeId, target })}
         keyField={keyField}
       />
     );
   }
   ```

   Saving a key here does not change any route: keys are global, and the draft still needs Apply.

7. In `src/components/ui/SidebarModal.tsx`:
   - Add `footer?: React.ReactNode` to the props (`:20-34`).
   - Inside the content column (`:243-259`), render `{footer}` after `{children}`, within the same scrolling container, so its `sticky bottom-0` pins to the visible bottom edge.

8. In `src/components/SettingsModal.tsx`:
   - Pass `onOpenChange={withDraftDiscard(onOpenChange)}` to `SidebarModal`.
   - Pass `footer={<StagedRouteBar />}`.

9. Replace each mode handler with the draft flow. For `TranscriptionSection` in `SettingsPage.tsx:526-548`:

   ```tsx
   const { request, sends } = useRouteChange();
   const draft = useRouteDraftStore((s) => s.draft);
   const stagedMode = draft?.routeId === "dictationStt" ? draft.target.mode : null;
   const handleTranscriptionModeSelect = (mode: InferenceMode) => {
     if (!isModeAllowed(mode)) return;
     if (mode === "local") {
       useRouteDraftStore.getState().discard();
       if (mode !== effectiveTranscriptionMode) request("dictationStt", { mode: "local" });
       return;
     }
     if (mode === effectiveTranscriptionMode) {
       useRouteDraftStore.getState().discard(); // re-selecting the applied mode cancels the draft
       return;
     }
     const current = targetFromSnapshot(currentRouteSnapshot(sends), "dictationStt");
     request("dictationStt", stagedTargetForMode(mode, current));
   };
   ```

   Then pass `stagedMode={stagedMode}` to `<InferenceModeSelector>` and render `<StagedRoutePanel routeId="dictationStt" />` directly below it. The `toast` prop of `TranscriptionSection` becomes unused for mode switches, but keep it if other code in the section uses it.

   Make the identical change in `MeetingSettings.tsx:87-95` (route `noteRecordingStt`, and keep `if (mode === "self-hosted") return;`) and `UploadSettings.tsx:68-75` (route `uploadStt`).

   In `InferenceConfigEditor.tsx:97-124`, replace the body of `handleModeSelect` with the same flow, using `SCOPE_ROUTE[scope]` as the route. The old patch logic (clear the provider when it is invalid for local mode, call `llamaServerStop` for self-hosted) now lives in `writeRouteTarget` (Task 5). Keep calling `onModeChange?.(mode)` after a local apply, so callers that react to it keep working. Add `stagedMode` and `<StagedRoutePanel routeId={SCOPE_ROUTE[scope]} />`.

   For the `dictationAgentVision` scope (`allowedModes={["providers"]}` at `DictationAgentSettings.tsx:212`), there is only one mode, so the selector is hidden (`modes.length > 1`) and nothing changes.

10. Delete `CLEANUP_MODE_TOAST_KEY` and `handleCleanupModeChange` (`SettingsPage.tsx:677-716`), and remove `onModeChange={handleCleanupModeChange}` at `:733`. The route toast replaces them.

11. Write `/tmp/loqui-i18n-task-6.json` and merge it. The `en` block is below. Then delete the six `switched*` keys listed under Files from every locale (a short `node -e` with `delete`, or edit each file), but only after `grep -rn "switchedProviders\|switchedLocal\|switchedSelfHosted" src` shows no remaining references.

    ```json
    {
      "staging": {
        "region": "Pending route change",
        "provider": "Provider",
        "keySaved": "key saved",
        "noKey": "no key",
        "addKey": "API key",
        "baseUrl": "Endpoint URL",
        "cloud": {
          "title": "Send {{task}} to a cloud provider?",
          "body": "This sends {{payload}} to the provider you pick. Nothing is sent until you apply."
        },
        "server": {
          "title": "Send {{task}} to your own server?",
          "body": "This sends {{payload}} to the address below, not to Loqui. Nothing is sent until you apply."
        },
        "url": {
          "empty": "Paste or type the base URL.",
          "invalid": "That does not look like a URL yet.",
          "http": "http:// is not encrypted. Fine on your own network.",
          "ok": "Looks good.",
          "sharedWithDictation": "Audio upload uses the dictation server: {{url}}. Change it in Speech-to-Text › Dictation."
        },
        "leaves": "Sends {{payload}} off this device",
        "leavesToServer": "Sends {{payload}} to your server",
        "blocked": {
          "needsKey": "{{provider}} needs an API key first.",
          "chooseProvider": "Choose a provider to review what will be sent.",
          "needsUrl": "Enter a valid server URL.",
          "needsModel": "Download the model first.",
          "sealed": "Sealed mode is on. Cloud routes are paused."
        },
        "discard": "Discard",
        "apply": "Apply"
      }
    }
    ```

    The `{{payload}}` noun phrases come from `routes.sends.*` and are lower-case mid-sentence. In each language, word the sentence so the payload is not at the start.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/providerCatalog.test.js test/components/stagedRoute.test.js test/stores/routeDraftStore.test.js test/components/inferenceModeSelector.test.js && npm run typecheck && npm run lint && npm run i18n:check`

The `PROVIDER_KEY_FIELDS` key for Corti text is `corti` → `cortiApiKey`. Speech Corti ("corti:speech") has no inline key field: the staged panel shows "no key" and the bar's blocker tells the user to add the client credentials in the provider editor. That flow is listed in the open questions.
Expected: PASS.

Then check manually in the app (`npm run native:electron && npm run dev`):
- STT → Cloud shows the dashed panel, no provider is highlighted, and the bar reads "Choose a provider…" with Apply disabled.
- Pick OpenAI without a key, and the key field appears. Save a key, and Apply enables. Apply, and the toast reads "Dictation now sends your audio and dictionary words to OpenAI." with Undo.
- Choosing Local is instant and toasts "Dictation now runs on this device."
- Esc closes Settings, and reopening shows no draft.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/routing src/stores/routeDraftStore.ts src/lib/routes.ts src/components/ui/SidebarModal.tsx src/components/SettingsModal.tsx src/components/SettingsPage.tsx src/components/settings/MeetingSettings.tsx src/components/settings/UploadSettings.tsx src/components/settings/InferenceConfigEditor.tsx src/locales test/components/providerCatalog.test.js test/components/stagedRoute.test.js
git commit -m "feat(settings): Stage remote route changes behind a review bar"
```

---

