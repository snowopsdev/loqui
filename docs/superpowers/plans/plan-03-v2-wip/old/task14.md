### Task 14: Honest copy and labels (SET-Q15, SET-Q19, SET-Q22, SET-Q23, SET-Q24)

Five small fixes:
- **Q15.** The screen-context description names where screenshots go, computed from the `assistantVision` route.
- **Q19.** Self-hosted inputs are properly labelled and get a **Test** button that lists the server's models.
- **Q22.** "Fully private" becomes "Runs on this device. Nothing leaves it.", the local Whisper tab is labelled "Whisper" instead of "OpenAI", and "Oruk" is explained.
- **Q23.** Dictionary import and export get text labels, and auto-learn moves inline.
- **Q24.** "Review dictation setup" becomes a text link below the engine controls.

**Plan 02 overlap:**
- Plan 02's SET-Q11 changes the placeholder in `SelfHostedPanel.tsx:22`. Keep its value.
- Plan 02's SET-Q6 may already have translated "Review dictation setup / Open setup" (`SettingsPage.tsx:627-633`). If those keys exist, reuse them for the link instead of adding `settingsPage.transcription.reviewSetupLink`.

**Files:**
- Create: `src/components/settings/screenContextCopy.ts`
- Modify: `src/components/settings/DictationAgentSettings.tsx`. The screen-context row description is around `:160-170`.
- Modify: `src/components/SelfHostedPanel.tsx` (52 lines)
- Create: `src/helpers/selfHostedProbe.js`, an unauthenticated model-list probe in main. Also modify `src/helpers/ipcHandlers.js`, `preload.js`, `src/types/electron.ts` and `src/preview/browserPreview.ts` to expose `probeSelfHosted`.
- Modify: `docs/PRIVACY.md`. Add a sentence to the connection-check row (`:51`).
- Modify: `src/helpers/localASROrganization.ts:8-13`
- Modify: `src/components/TranscriptionModelPicker.tsx`. Add the Oruk hint under the local tabs (`:1309-1314`).
- Create: `src/components/DictionaryHeaderActions.tsx`
- Modify: `src/components/DictionaryView.tsx`. Replace the list header actions (`:259-279`), and label the in-field import button (`:190-196`).
- Modify: `src/components/SettingsPage.tsx`. In `TranscriptionSection`, move the review card (`:620-635`) below the pickers as a link.
- Modify: `src/locales/*/translation.json`. Update the four `*.localDesc` values and add new keys.
- Test: `test/components/screenContextCopy.test.js`, `test/components/selfHostedPanel.test.js`, `test/components/dictionaryHeaderActions.test.js`, `test/components/settingsCopy.test.js`, `test/helpers/selfHostedProbe.test.js`

**Interfaces:**
- Consumes:
  - `useResolvedRoute("assistantVision")` (Task 2);
  - A new `window.electronAPI.probeSelfHosted(baseUrl) → Promise<{ ok: true; count: number } | { ok: false; code: "invalidUrl" | "httpsRequired" | "network" | "timeout" | "http"; status?: number }>`.
    - Do **not** reuse `personalInference.models`. Without an `inferenceScope` it resolves `credentialRef` to `custom:dictationCleanup`, then sends the user's stored Bearer key to whatever URL was typed.
    - This probe sends no headers at all.
  - `useSettings()`'s `autoLearnCorrections` and `setAutoLearnCorrections` (`src/hooks/useSettings.ts:159-174`).
- Produces:

  ```ts
  export function screenContextCopy(route: Pick<ResolvedRoute, "locality" | "providerId" | "model">, t: (k: string, o?: Record<string, unknown>) => string): string;
  export function DictionaryHeaderActions(props: { onClearAll(): void; onExport(): void; onImport(): void; autoLearn: boolean; onAutoLearnChange(v: boolean): void }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/components/screenContextCopy.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const tr = (k, o) => `${k}${o ? JSON.stringify(o) : ""}`;

test("screen-context copy says where the screenshot goes", async () => {
  const { screenContextCopy } = await import("../../src/components/settings/screenContextCopy.ts");
  assert.equal(
    screenContextCopy({ locality: "device", providerId: null, model: "Qwen3.5 2B" }, tr),
    'dictationAgent.screenContext.goesToDevice{"model":"Qwen3.5 2B"}'
  );
  assert.equal(screenContextCopy({ locality: "network", providerId: null, model: null }, tr), "dictationAgent.screenContext.goesToServer");
  assert.equal(
    screenContextCopy({ locality: "remote", providerId: "anthropic", model: "Claude Sonnet" }, tr),
    'dictationAgent.screenContext.goesToProvider{"provider":"Anthropic"}'
  );
  assert.equal(
    screenContextCopy({ locality: "device", providerId: null, model: null }, tr),
    "dictationAgent.screenContext.goesToDeviceNoModel"
  );
});
```

Create `test/components/selfHostedPanel.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("self-hosted inputs are labelled and the panel can test the server", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-self-hosted-test-" }));
  const SelfHostedPanel = (await vite.ssrLoadModule("/components/SelfHostedPanel.tsx")).default;
  const html = renderToStaticMarkup(React.createElement(SelfHostedPanel, {
    service: "reasoning", url: "http://192.168.1.20:11434/v1", onUrlChange() {}, model: "", onModelChange() {},
  }));
  const fors = [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(fors.length, 2);
  for (const id of fors) assert.ok(html.includes(`id="${id}"`), `input for ${id}`);
  assert.match(html, /settingsPage\.selfHosted\.test/);
  assert.doesNotMatch(html, /192\.168\.1\.126/, "no personal LAN IP placeholder");
});
```

Create `test/components/dictionaryHeaderActions.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("dictionary actions have visible words and auto-learn is inline", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-dictionary-actions-test-" }));
  const { DictionaryHeaderActions } = await vite.ssrLoadModule("/components/DictionaryHeaderActions.tsx");
  const html = renderToStaticMarkup(React.createElement(DictionaryHeaderActions, {
    onClearAll() {}, onExport() {}, onImport() {}, autoLearn: true, onAutoLearnChange() {},
  }));
  assert.match(html, />dictionary\.importAction</);
  assert.match(html, />dictionary\.exportAction</);
  assert.match(html, />dictionary\.clearAll</);
  assert.match(html, /role="switch"[^>]*aria-checked="true"/);
  assert.match(html, /settingsPage\.dictionary\.autoLearnTitle/);
});
```

Create `test/helpers/selfHostedProbe.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { probeSelfHosted } = require("../../src/helpers/selfHostedProbe.js");

test("the probe lists models without sending any credential", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ data: [{ id: "a" }, { id: "b" }] }) };
  };
  assert.deepEqual(await probeSelfHosted("http://192.168.1.20:11434/v1/", fetchImpl), { ok: true, count: 2 });
  assert.equal(calls[0].url, "http://192.168.1.20:11434/v1/models");
  assert.equal(calls[0].init.headers, undefined, "no Authorization header, ever");
});

test("the probe classifies failures and refuses plain http to public hosts", async () => {
  assert.deepEqual(await probeSelfHosted("not a url", async () => ({})), { ok: false, code: "invalidUrl" });
  assert.deepEqual(await probeSelfHosted("http://example.com/v1", async () => ({})), { ok: false, code: "httpsRequired" });
  assert.deepEqual(
    await probeSelfHosted("http://localhost:8178", async () => ({ ok: false, status: 404, json: async () => ({}) })),
    { ok: false, code: "http", status: 404 }
  );
  assert.deepEqual(
    await probeSelfHosted("http://localhost:8178", async () => { throw new Error("ECONNREFUSED"); }),
    { ok: false, code: "network" }
  );
});
```

Create `test/components/settingsCopy.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const en = JSON.parse(fs.readFileSync(path.join(root, "src/locales/en/translation.json"), "utf8"));

test("local mode no longer claims 'fully private'", () => {
  const values = [
    en.settingsPage.transcription.modes.localDesc,
    en.settingsPage.aiModels.modes.localDesc,
    en.agentMode.settings.modes.localDesc,
    en.dictationAgent.modes.localDesc,
  ];
  for (const v of values) {
    assert.doesNotMatch(v, /fully private/i);
    assert.match(v, /Nothing leaves/);
  }
});

test("the local Whisper family is labelled Whisper, not OpenAI", async () => {
  const { LOCAL_ASR_ORGANIZATIONS } = await import("../../src/helpers/localASROrganization.ts");
  assert.equal(LOCAL_ASR_ORGANIZATIONS.find((o) => o.id === "whisper").name, "Whisper");
});

test("'Review dictation setup' is a link below the engine controls", () => {
  const src = fs.readFileSync(path.join(root, "src/components/SettingsPage.tsx"), "utf8");
  const section = src.slice(src.indexOf("function TranscriptionSection"), src.indexOf("function AiModelsSection"));
  assert.ok(!section.includes(">Review dictation setup<"), "no hard-coded English");
  const picker = section.indexOf('renderTranscriptionPicker("local")');
  const link = section.indexOf("onClick={startOnboarding}");
  assert.ok(picker > 0 && link > picker, "the link follows the engine controls");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/selfHostedProbe.test.js test/components/screenContextCopy.test.js test/components/selfHostedPanel.test.js test/components/dictionaryHeaderActions.test.js test/components/settingsCopy.test.js`
Expected: FAIL. The modules are missing, the labels lack `for`, the copy still says "Fully private", the tab is still "OpenAI", and the card still comes first.

- [ ] **Step 3: Implement**

1. **Q15.** Create `src/components/settings/screenContextCopy.ts`:

   ```ts
   import { providerDisplayLabel } from "../../lib/locality";
   import type { ResolvedRoute } from "../../lib/routes";

   // SET-Q15: name the screenshot's destination, from the assistantVision route.
   export function screenContextCopy(
     route: Pick<ResolvedRoute, "locality" | "providerId" | "model">,
     t: (k: string, o?: Record<string, unknown>) => string
   ): string {
     if (route.locality === "remote") {
       return t("dictationAgent.screenContext.goesToProvider", { provider: providerDisplayLabel(route.providerId, t) });
     }
     if (route.locality === "network") return t("dictationAgent.screenContext.goesToServer");
     return route.model
       ? t("dictationAgent.screenContext.goesToDevice", { model: route.model })
       : t("dictationAgent.screenContext.goesToDeviceNoModel");
   }
   ```

   In `DictationAgentSettings.tsx`, add `const visionRoute = useResolvedRoute("assistantVision");`. Then replace `t("dictationAgent.screenContext.enableDescription")` in the screen-context `SettingsRow` with `screenContextCopy(visionRoute, t)`, and keep the `unsupported` branch. The route is computed even while screen context is off (Task 1, clarification 3), so the copy is right before the user turns it on.

2. **Q19.** Rewrite `src/components/SelfHostedPanel.tsx`. Keep the props, and keep Plan 02's placeholder if it already changed. Otherwise use `http://localhost:8178` for transcription and `http://localhost:11434/v1` for reasoning:

   ```tsx
   import { useId, useState } from "react";
   import { useTranslation } from "react-i18next";
   import { Button } from "./ui/button";
   import { Input } from "./ui/input";

   interface SelfHostedPanelProps {
     service: "transcription" | "reasoning";
     url: string;
     onUrlChange: (url: string) => void;
     model?: string;
     onModelChange?: (model: string) => void;
   }

   type TestState = { kind: "idle" } | { kind: "testing" } | { kind: "ok"; count: number } | { kind: "fail"; host: string };

   export default function SelfHostedPanel({ service, url, onUrlChange, model, onModelChange }: SelfHostedPanelProps) {
     const { t } = useTranslation();
     const urlId = useId();
     const modelId = useId();
     const [test, setTest] = useState<TestState>({ kind: "idle" });
     const placeholderUrl = service === "transcription" ? "http://localhost:8178" : "http://localhost:11434/v1";

     const runTest = async () => {
       let host = url;
       try {
         host = new URL(url.trim()).host;
       } catch {
         setTest({ kind: "fail", host: url });
         return;
       }
       setTest({ kind: "testing" });
       // Main's probe sends no credentials (see selfHostedProbe.js).
       const result = await window.electronAPI?.probeSelfHosted?.(url.trim()).catch(() => null);
       setTest(result?.ok ? { kind: "ok", count: result.count } : { kind: "fail", host });
     };

     return (
       <div className="border border-border rounded-lg p-3 space-y-2.5">
         <div className="space-y-1.5">
           <label htmlFor={urlId} className="block text-xs font-medium text-foreground">
             {t("settingsPage.selfHosted.serverUrl")}
           </label>
           <div className="flex gap-2">
             <Input id={urlId} dir="ltr" value={url} onChange={(e) => { onUrlChange(e.target.value); setTest({ kind: "idle" }); }} placeholder={placeholderUrl} className="h-8 text-sm" />
             <Button size="sm" variant="outline" onClick={() => void runTest()} disabled={!url.trim() || test.kind === "testing"}>
               {test.kind === "testing" ? t("settingsPage.selfHosted.testing") : t("settingsPage.selfHosted.test")}
             </Button>
           </div>
           <p role="status" aria-live="polite" className={`text-xs ${test.kind === "fail" ? "text-destructive" : "text-muted-foreground"}`}>
             {test.kind === "ok" && t("settingsPage.selfHosted.testOk", { count: test.count })}
             {test.kind === "fail" && t("settingsPage.selfHosted.testFail", { host: test.host })}
           </p>
         </div>
         {onModelChange && (
           <div className="space-y-1.5">
             <label htmlFor={modelId} className="block text-xs font-medium text-foreground">
               {t("common.model")}
             </label>
             <Input id={modelId} dir="ltr" value={model ?? ""} onChange={(e) => onModelChange(e.target.value)} placeholder="whisper-large-v3-turbo" className="h-8 text-sm" />
           </div>
         )}
       </div>
     );
   }
   ```

   Create `src/helpers/selfHostedProbe.js`:

   ```js
   const { isPrivateHost } = require("./providerConnectionTest");

   // "Test" for a self-hosted server: GET <base>/models with no headers, so no
   // stored key can ever reach an address the user is still typing.
   async function probeSelfHosted(baseUrl, fetchImpl = fetch, timeoutMs = 8000) {
     let url;
     try {
       url = new URL(String(baseUrl).trim());
     } catch {
       return { ok: false, code: "invalidUrl" };
     }
     if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, code: "invalidUrl" };
     if (url.protocol === "http:" && !isPrivateHost(url.hostname)) return { ok: false, code: "httpsRequired" };
     const endpoint = `${url.href.replace(/\/+$/, "")}/models`;
     const controller = new AbortController();
     const timer = setTimeout(() => controller.abort(), timeoutMs);
     try {
       const res = await fetchImpl(endpoint, { method: "GET", signal: controller.signal });
       if (!res.ok) return { ok: false, code: "http", status: res.status };
       const body = await res.json().catch(() => ({}));
       return { ok: true, count: Array.isArray(body?.data) ? body.data.length : 0 };
     } catch (error) {
       return { ok: false, code: error?.name === "AbortError" ? "timeout" : "network" };
     } finally {
       clearTimeout(timer);
     }
   }

   module.exports = { probeSelfHosted };
   ```

   `isPrivateHost` is defined in `providerConnectionTest.js:54` but not exported (`:335` exports only `resolveProviderRequest` and `testProviderConnection`). Change `:335` to `module.exports = { isPrivateHost, resolveProviderRequest, testProviderConnection };` so the probe and the connection test share one private-host rule.

   Wire it up:
   - In `ipcHandlers.js`, next to `test-provider-connection`, add `ipcMain.handle("probe-self-hosted", (_e, baseUrl) => require("./selfHostedProbe").probeSelfHosted(baseUrl));`.
   - In `preload.js`, add `probeSelfHosted: (baseUrl) => ipcRenderer.invoke("probe-self-hosted", baseUrl),`.
   - In `src/types/electron.ts`, add the `probeSelfHosted?` signature from Interfaces.
   - In `browserPreview.ts`, add a stub that resolves `{ ok: false, code: "network" }`.
   - Plan 07's egress inventory test will list this file. Add it to the sealed-mode allowlist when Plan 07 lands, because it is a user-initiated request to the user's own server.

   In `docs/PRIVACY.md`, append to the connection-check row: "Testing a self-hosted server sends an unauthenticated model-list request to the address you entered."

   A whisper.cpp transcription server may not implement `/models`. In that case the call throws and the copy says "Couldn't list models at {{host}}", which is honest without claiming the server is down.

3. **Q22.**
   - In `src/helpers/localASROrganization.ts:10`, change `{ id: "whisper", name: "OpenAI" }` to `{ id: "whisper", name: "Whisper" }`.
   - In `TranscriptionModelPicker.tsx`, directly after the local `<ProviderTabs … />` (`:1309-1314`), add:

     ```tsx
     {internalLocalProvider === "oruk" && (
       <p className="mt-1 text-xs text-muted-foreground">{t("transcription.families.orukHint")}</p>
     )}
     ```

4. **Q23.** Create `src/components/DictionaryHeaderActions.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { Download, Upload } from "./icons";
   import { Toggle } from "./ui/toggle";

   export function DictionaryHeaderActions(props: {
     onClearAll: () => void;
     onExport: () => void;
     onImport: () => void;
     autoLearn: boolean;
     onAutoLearnChange: (value: boolean) => void;
   }) {
     const { t } = useTranslation();
     const action = "inline-flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground transition-colors";
     return (
       <div className="flex flex-wrap items-center gap-3">
         <label className="inline-flex items-center gap-2 text-xs text-foreground/60">
           <Toggle checked={props.autoLearn} onChange={props.onAutoLearnChange} aria-label={t("settingsPage.dictionary.autoLearnTitle")} />
           <span aria-hidden="true">{t("settingsPage.dictionary.autoLearnTitle")}</span>
         </label>
         <button type="button" onClick={props.onImport} className={action}>
           <Upload size={12} aria-hidden="true" />
           <span>{t("dictionary.importAction")}</span>
         </button>
         <button type="button" onClick={props.onExport} className={action}>
           <Download size={12} aria-hidden="true" />
           <span>{t("dictionary.exportAction")}</span>
         </button>
         <button type="button" onClick={props.onClearAll} className="text-xs text-foreground/60 hover:text-destructive transition-colors">
           {t("dictionary.clearAll")}
         </button>
       </div>
     );
   }
   ```

   In `DictionaryView.tsx`:
   - Replace the action cluster at `:259-279` (the `<div className="flex items-center gap-3">` with Clear all and Export) with `<DictionaryHeaderActions onClearAll={() => setConfirmClear(true)} onExport={handleExport} onImport={() => setShowBulkImport(true)} autoLearn={autoLearnCorrections} onAutoLearnChange={setAutoLearnCorrections} />`.
   - Get `autoLearnCorrections` and `setAutoLearnCorrections` from `useSettings()`, the same hook `SettingsPage` uses (`useSettings.ts:159-174`).
   - On the in-field Upload icon button (`:190-196`), add `title={t("dictionary.importWords")}`. It already has an `aria-label`.

5. **Q24.** In `TranscriptionSection` (`SettingsPage.tsx:620-635`):
   - Delete the review card `<div className="flex items-center justify-between gap-3 rounded-lg border …">…</div>`.
   - After `{effectiveTranscriptionMode === "local" && renderTranscriptionPicker("local")}` (and any self-hosted block that follows), add:

     ```tsx
     <button
       type="button"
       onClick={startOnboarding}
       className="text-xs text-link underline-offset-2 hover:underline"
     >
       {t("settingsPage.transcription.reviewSetupLink")}
     </button>
     ```

   `text-link` is Plan 01's `--color-link` role. Keep the comment above the old card ("Local decoding still serves meetings…") with the code it describes.

6. Write `/tmp/loqui-i18n-task-14.json` and merge it. The `en` block below overwrites the four `localDesc` values. `testOk` needs every plural category per locale.

   ```json
   {
     "settingsPage": {
       "transcription": {
         "modes": { "localDesc": "Runs on this device. Nothing leaves it." },
         "reviewSetupLink": "Review dictation setup"
       },
       "aiModels": { "modes": { "localDesc": "Runs on this device. Nothing leaves it." } },
       "selfHosted": {
         "test": "Test",
         "testing": "Testing…",
         "testOk_one": "Connected · {{count}} model",
         "testOk_other": "Connected · {{count}} models",
         "testFail": "Couldn't list models at {{host}}. Check the address and that the server is running."
       }
     },
     "agentMode": { "settings": { "modes": { "localDesc": "Runs on this device. Nothing leaves it." } } },
     "dictationAgent": {
       "modes": { "localDesc": "Runs a local model on this device. Nothing leaves it." },
       "screenContext": {
         "goesToDevice": "Captures the display your cursor is on and sends it to {{model}} on this device. Loqui never saves or logs it.",
         "goesToDeviceNoModel": "Captures the display your cursor is on for a model on this device. Loqui never saves or logs it.",
         "goesToServer": "Captures the display your cursor is on and sends it to your own server. Loqui never saves or logs it.",
         "goesToProvider": "Captures the display your cursor is on and sends it to {{provider}}. Loqui never saves or logs it."
       }
     },
     "transcription": {
       "families": { "orukHint": "Oruk is a Parakeet model fine-tuned for multilingual dictation. It runs on this device." }
     },
     "dictionary": { "importAction": "Import", "exportAction": "Export" }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/helpers/selfHostedProbe.test.js test/components/screenContextCopy.test.js test/components/selfHostedPanel.test.js test/components/dictionaryHeaderActions.test.js test/components/settingsCopy.test.js test/components/orukeetOrganization.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS. `orukeetOrganization.test.js` still passes, because it does not assert the Whisper label.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/selfHostedProbe.js src/helpers/providerConnectionTest.js src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/preview/browserPreview.ts docs/PRIVACY.md test/helpers/selfHostedProbe.test.js src/components/settings/screenContextCopy.ts src/components/settings/DictationAgentSettings.tsx src/components/SelfHostedPanel.tsx src/helpers/localASROrganization.ts src/components/TranscriptionModelPicker.tsx src/components/DictionaryHeaderActions.tsx src/components/DictionaryView.tsx src/components/SettingsPage.tsx src/locales test/components/screenContextCopy.test.js test/components/selfHostedPanel.test.js test/components/dictionaryHeaderActions.test.js test/components/settingsCopy.test.js
git commit -m "fix(settings): Name destinations, label inputs and soften privacy claims"
```

---

