### Task 9: Keyring panel with health and Verify all (SET-R5 C, UI half)

The Routing page gains a **Keyring** below the Patchbay. It has one row per saved provider key, and each row shows:
- a status dot that is never colour alone (a labelled `role="img"`), or a spinner while checking;
- "Last verified 3 days ago" or "Never verified";
- the last error;
- which tasks are paused because of it;
- a per-row **Verify**;
- a "Remind in 90 days" switch.

**Verify all** runs the providers one after another with a visible per-row spinner. Verification is always a button, never automatic, and the tooltip says what it sends. A rejected key feeds `rejectedKeys` (Task 2), so the routes that use it turn into "Add API key" everywhere: the pill, the Patchbay and the editors.

**Files:**
- Create: `src/components/settings/routing/KeyringPanel.tsx`
- Modify: `src/components/settings/routing/RoutingSection.tsx`. Render `<KeyringPanel />` after the Patchbay.
- Modify: `src/locales/*/translation.json`
- Test: `test/components/keyringPanel.test.js`

**Interfaces:**
- Consumes:
  - `window.electronAPI.keyring.{list,verify,setReminder}` and `KeyringEntry` (Task 8);
  - `refreshRouteFacts` (Task 2);
  - `useResolvedRoutes`, `currentRouteSnapshot` and `routeDestinationId` (Tasks 2, 5, 7);
  - `providerHost` (Task 6);
  - `providerDisplayLabel` (Plan 01);
  - `formatRelativeTime(dateStr, t, locale)` (`src/utils/dateFormatting.ts:41`);
  - `Toggle` (`src/components/ui/toggle.tsx`, props `{ checked, onChange, disabled?, "aria-label"? }`);
  - `useRouteFactsStore` for `facts.sealed`.
- Produces:

  ```ts
  export function pausedTasksByProvider(routes: ResolvedRoute[], destinationOf: (r: ResolvedRoute) => string): Record<string, RouteId[]>;
  export function keyringStatusLine(entry: KeyringEntry, pausedTaskNames: string[], t: TFunction, locale: string): { text: string; tone: "muted" | "error" };
  export function KeyringPanelView(props: KeyringPanelViewProps): JSX.Element;
  export function KeyringPanel(): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/keyringPanel.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const { withI18nMock } = require("../lib/i18nTestMock");
const tr = (k, o) => (o ? `${k}${JSON.stringify(o)}` : k);

test("keyring panel", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-keyring-panel-test-" }, { withOptions: true }));
  const k = await vite.ssrLoadModule("/components/settings/routing/KeyringPanel.tsx");
  const entry = (o) => ({ provider: "groq", status: "verified", lastVerifiedAt: null, lastErrorCode: null, lastErrorStatus: null, reminderDueAt: null, ...o });

  await t.test("paused tasks are the routes that use a provider and are not ready", () => {
    const routes = [
      { id: "chat", state: { status: "needsKey", provider: "Groq" } },
      { id: "dictationStt", state: { status: "ready" } },
      { id: "translation", state: { status: "needsKey", provider: "Groq" } },
    ];
    const map = k.pausedTasksByProvider(routes, (r) => (r.id === "dictationStt" ? "device" : "groq"));
    assert.deepEqual(map, { groq: ["chat", "translation"] });
  });

  await t.test("status lines say when, what failed and what it breaks", () => {
    assert.deepEqual(k.keyringStatusLine(entry({ status: "unverified" }), [], tr, "en"), { text: "keyring.never", tone: "muted" });
    const rejected = k.keyringStatusLine(
      entry({ status: "rejected", lastVerifiedAt: Date.now() - 120000, lastErrorCode: "credentialsRejected", lastErrorStatus: 401 }),
      ["Chat"], tr, "en"
    );
    assert.equal(rejected.tone, "error");
    assert.match(rejected.text, /keyring\.rejected\{"status":401\}/);
    assert.match(rejected.text, /keyring\.paused\{"tasks":"Chat"\}/);
    assert.match(rejected.text, /keyring\.lastVerified.*minutesAgo/);
    const unreachable = k.keyringStatusLine(entry({ status: "unreachable", lastVerifiedAt: Date.now(), lastErrorCode: "timeout" }), [], tr, "en");
    assert.match(unreachable.text, /keyring\.unreachable\{"host":"api\.groq\.com"\}/);
  });

  await t.test("rows expose status in words, a named reminder switch and an explicit verify button", () => {
    const html = renderToStaticMarkup(React.createElement(k.KeyringPanelView, {
      entries: [entry({ provider: "groq", status: "rejected", lastErrorCode: "credentialsRejected", lastErrorStatus: 401, lastVerifiedAt: Date.now() }), entry({ provider: "openai", status: "unverified" })],
      paused: { groq: ["Chat"] },
      checking: "openai",
      progress: { current: 2, total: 2 },
      sealed: false,
      onVerify() {}, onVerifyAll() {}, onReminder() {},
    }));
    assert.match(html, /role="img"[^>]*aria-label="keyring\.status\.rejected"/);
    assert.match(html, /aria-label="keyring\.remindLabel\{&quot;provider&quot;:&quot;Groq&quot;\}"/);
    assert.match(html, /keyring\.verifyingAll\{&quot;current&quot;:2,&quot;total&quot;:2\}/);
    assert.match(html, /title="keyring\.verifyTooltip\{&quot;host&quot;:&quot;api\.groq\.com&quot;\}"/);
    assert.match(html, /data-provider="openai"[^>]*data-checking="true"/);
  });

  await t.test("sealed mode disables verification and says why", () => {
    const html = renderToStaticMarkup(React.createElement(k.KeyringPanelView, {
      entries: [entry({})], paused: {}, checking: null, progress: null, sealed: true,
      onVerify() {}, onVerifyAll() {}, onReminder() {},
    }));
    assert.match(html, /keyring\.sealed/);
    assert.ok((html.match(/disabled=""/g) ?? []).length >= 2);
  });

  await t.test("no saved keys says everything runs locally", () => {
    const html = renderToStaticMarkup(React.createElement(k.KeyringPanelView, {
      entries: [], paused: {}, checking: null, progress: null, sealed: false, onVerify() {}, onVerifyAll() {}, onReminder() {},
    }));
    assert.match(html, /keyring\.empty/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/components/keyringPanel.test.js`
Expected: FAIL. The module is missing.

- [ ] **Step 3: Implement**

1. Create `src/components/settings/routing/KeyringPanel.tsx`:

   ```tsx
   import { useCallback, useEffect, useMemo, useState } from "react";
   import type { TFunction } from "i18next";
   import { useTranslation } from "react-i18next";
   import { providerDisplayLabel } from "../../../lib/locality";
   import { routeSendsCopy, useResolvedRoutes, type ResolvedRoute, type RouteId } from "../../../lib/routes";
   import { currentRouteSnapshot } from "../../../stores/routeDraftStore";
   import { refreshRouteFacts, useRouteFactsStore } from "../../../stores/routeFactsStore";
   import type { KeyringEntry } from "../../../types/electron";
   import { formatRelativeTime } from "../../../utils/dateFormatting";
   import { Loader2 } from "../../icons";
   import { Button } from "../../ui/button";
   import { Toggle } from "../../ui/toggle";
   import { routeDestinationId } from "./destinations";
   import { providerHost } from "./providerCatalog";

   type Tr = TFunction | ((k: string, o?: Record<string, unknown>) => string);

   export function pausedTasksByProvider(
     routes: Pick<ResolvedRoute, "id" | "state">[],
     destinationOf: (r: Pick<ResolvedRoute, "id" | "state">) => string
   ): Record<string, RouteId[]> {
     const map: Record<string, RouteId[]> = {};
     for (const r of routes) {
       if (r.state.status !== "needsKey") continue;
       const dest = destinationOf(r);
       (map[dest] ??= []).push(r.id);
     }
     return map;
   }

   export function keyringStatusLine(entry: KeyringEntry, pausedTaskNames: string[], t: Tr, locale: string) {
     if (!entry.lastVerifiedAt) return { text: t("keyring.never"), tone: "muted" as const };
     const when = formatRelativeTime(new Date(entry.lastVerifiedAt).toISOString(), t, locale);
     const parts = [t("keyring.lastVerified", { when })];
     if (entry.status === "rejected") parts.push(t("keyring.rejected", { status: entry.lastErrorStatus ?? 401 }));
     if (entry.status === "unreachable") parts.push(t("keyring.unreachable", { host: providerHost(entry.provider) ?? entry.provider }));
     if (pausedTaskNames.length && entry.status === "rejected") {
       parts.push(t("keyring.paused", { tasks: pausedTaskNames.join(", ") }));
     }
     return { text: parts.join(" · "), tone: entry.status === "rejected" ? ("error" as const) : ("muted" as const) };
   }

   const DOT: Record<KeyringEntry["status"], string> = {
     verified: "bg-locality-device",
     unverified: "bg-warning",
     rejected: "bg-destructive",
     unreachable: "bg-warning",
   };

   export interface KeyringPanelViewProps {
     entries: KeyringEntry[];
     paused: Record<string, string[]>;           // provider → translated task names
     checking: string | null;
     progress: { current: number; total: number } | null;
     sealed: boolean;
     onVerify: (provider: string) => void;
     onVerifyAll: () => void;
     onReminder: (provider: string, enabled: boolean) => void;
   }

   export function KeyringPanelView(props: KeyringPanelViewProps) {
     const { t, i18n } = useTranslation();
     const busy = props.checking !== null;
     return (
       <section aria-labelledby="keyring-title" className="rounded-lg border border-border/70 overflow-hidden">
         <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
           <div>
             <h3 id="keyring-title" className="text-sm font-semibold">{t("keyring.title")}</h3>
             <p className="text-xs text-muted-foreground">{t("keyring.subtitle")}</p>
             {props.sealed && <p className="mt-1 text-xs text-muted-foreground">{t("keyring.sealed")}</p>}
           </div>
           <Button
             size="sm"
             variant="outline"
             onClick={props.onVerifyAll}
             disabled={busy || props.sealed || props.entries.length === 0}
             title={t("keyring.verifyAllTooltip")}
           >
             {props.progress ? t("keyring.verifyingAll", props.progress) : t("keyring.verifyAll")}
           </Button>
         </div>
         {props.entries.length === 0 ? (
           <p className="px-4 py-3 text-xs text-muted-foreground">{t("keyring.empty")}</p>
         ) : (
           <ul>
             {props.entries.map((entry) => {
               const name = providerDisplayLabel(entry.provider, t);
               const checking = props.checking === entry.provider;
               const line = keyringStatusLine(entry, props.paused[entry.provider] ?? [], t, i18n.language);
               const host = providerHost(entry.provider) ?? entry.provider;
               return (
                 <li
                   key={entry.provider}
                   data-provider={entry.provider}
                   data-checking={checking ? "true" : "false"}
                   className="grid grid-cols-[20px_1fr_auto] items-center gap-3 border-b border-border/50 px-4 py-2.5 last:border-b-0"
                 >
                   {checking ? (
                     <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label={t("keyring.checking")} />
                   ) : (
                     <span role="img" aria-label={t(`keyring.status.${entry.status}`)} className={`h-2 w-2 rounded-full ${DOT[entry.status]}`} />
                   )}
                   <div className="min-w-0">
                     <p className="text-xs font-semibold">{name}</p>
                     <p className={`text-xs ${line.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                       {checking ? t("keyring.checking") : line.text}
                     </p>
                   </div>
                   <div className="flex items-center gap-3">
                     <Button
                       size="sm"
                       variant="ghost"
                       onClick={() => props.onVerify(entry.provider)}
                       disabled={busy || props.sealed}
                       title={t("keyring.verifyTooltip", { host })}
                     >
                       {t("keyring.verify")}
                     </Button>
                     <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                       <Toggle
                         checked={entry.reminderDueAt !== null}
                         onChange={(on) => props.onReminder(entry.provider, on)}
                         aria-label={t("keyring.remindLabel", { provider: name })}
                       />
                       <span aria-hidden="true">{t("keyring.remind")}</span>
                     </label>
                   </div>
                 </li>
               );
             })}
           </ul>
         )}
       </section>
     );
   }

   export function KeyringPanel() {
     const { t } = useTranslation();
     const routes = useResolvedRoutes();
     const sealed = useRouteFactsStore((s) => s.facts.sealed);
     const [entries, setEntries] = useState<KeyringEntry[]>([]);
     const [checking, setChecking] = useState<string | null>(null);
     const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
     const api = window.electronAPI?.keyring;

     const load = useCallback(async () => {
       try {
         setEntries((await api?.list()) ?? []);
       } catch {
         setEntries([]);
       }
     }, [api]);
     useEffect(() => {
       void load();
     }, [load, routes]); // a key saved elsewhere changes routes; reload so it appears

     const paused = useMemo(() => {
       const snapshot = currentRouteSnapshot(routeSendsCopy(t));
       const byProvider = pausedTasksByProvider(routes, (r) => routeDestinationId(snapshot, r as ResolvedRoute));
       return Object.fromEntries(
         Object.entries(byProvider).map(([p, ids]) => [p, ids.map((id) => t(`routes.names.${id}`))])
       );
     }, [routes, t]);

     const verifyOne = async (provider: string) => {
       setChecking(provider);
       try {
         const next = await api!.verify(provider);
         setEntries((cur) => cur.map((e) => (e.provider === provider ? next : e)));
       } finally {
         setChecking(null);
       }
     };

     const onVerify = async (provider: string) => {
       await verifyOne(provider);
       await refreshRouteFacts();
     };

     const onVerifyAll = async () => {
       const queue = entries.map((e) => e.provider);
       for (let i = 0; i < queue.length; i++) {
         setProgress({ current: i + 1, total: queue.length });
         await verifyOne(queue[i]);
       }
       setProgress(null);
       await refreshRouteFacts();
     };

     const onReminder = async (provider: string, enabled: boolean) => {
       const next = await api!.setReminder(provider, enabled);
       setEntries((cur) => cur.map((e) => (e.provider === provider ? next : e)));
     };

     return (
       <KeyringPanelView
         entries={entries}
         paused={paused}
         checking={checking}
         progress={progress}
         sealed={sealed}
         onVerify={(p) => void onVerify(p)}
         onVerifyAll={() => void onVerifyAll()}
         onReminder={(p, on) => void onReminder(p, on)}
       />
     );
   }
   ```

   The spinner uses `animate-spin`, which runs only while a row is being checked (the loop is gated to its active state). Reduced motion already stops the transform globally, and the "Checking…" text still announces the state.

   `bg-warning` is used for a non-text dot only. That needs 3:1, and `#d97706` is 3.2:1 on white.

2. In `RoutingSection.tsx`, after the Patchbay block, add `<KeyringPanel />` (import it from `./KeyringPanel`).

3. Write `/tmp/loqui-i18n-task-9.json` and merge it. The `en` block is below. `keyring.reminder.*` already exists from Task 8, so merge into the same object.

   ```json
   {
     "keyring": {
       "title": "Keyring",
       "subtitle": "Saved provider keys and whether they still work. Results stay on this device.",
       "verify": "Verify",
       "verifyAll": "Verify all",
       "verifyingAll": "Verifying {{current}} of {{total}}…",
       "verifyTooltip": "Sends your saved key to {{host}} to list models.",
       "verifyAllTooltip": "Contacts each provider below with its saved key, one at a time.",
       "checking": "Checking…",
       "never": "Never verified",
       "lastVerified": "Last verified {{when}}",
       "rejected": "Rejected ({{status}}). Replace the key.",
       "unreachable": "Couldn't reach {{host}}. Key kept, not verified.",
       "paused": "Paused: {{tasks}}",
       "remind": "Remind in 90 days",
       "remindLabel": "Remind me to rotate the {{provider}} key in 90 days",
       "sealed": "Sealed mode is on, so verification is paused.",
       "empty": "No saved provider keys. Tasks that need one show “Add API key” in Routing.",
       "status": {
         "verified": "Verified",
         "unverified": "Not verified yet",
         "rejected": "Rejected",
         "unreachable": "Couldn't verify"
       }
     }
   }
   ```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/components/keyringPanel.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

Then check manually against card R5 C (`05-settings.html:1351-1359`):
- Save a bogus Groq key, then press Verify. The row turns "Rejected (401)", and Chat on Groq shows "Add API key" in the Patchbay.
- Verify all walks through the rows one by one.
- Toggling "Remind in 90 days" survives an app restart.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/routing/KeyringPanel.tsx src/components/settings/routing/RoutingSection.tsx src/locales test/components/keyringPanel.test.js
git commit -m "feat(keyring): Keyring panel with health, Verify all and reminders"
```

---

