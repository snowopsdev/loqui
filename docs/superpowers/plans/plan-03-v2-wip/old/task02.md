### Task 2: Route graph, part 2: main-process facts, hooks and route copy (§5.1)

This task completes the contract: `useResolvedRoutes()` and `useResolvedRoute(id)` over `settingsStore`, with readiness facts from existing preload calls. It also adds the i18n merge script every later task uses.

**Files:**
- Create: `src/stores/routeFactsStore.ts`
- Modify: `src/lib/routes.ts`. Append the hooks and `routeSendsCopy`.
- Modify: `src/types/electron.ts`. Add the optional `privacy?` namespace inside the `electronAPI` interface, directly after `downloadSearchModel` (`:675`).
- Create: `scripts/merge-locale-keys.js`
- Create: `test/lib/i18nTestMock.js`, a shared `react-i18next` stub for Vite SSR renderer tests, used by every later task.
- Modify: `src/locales/*/translation.json`. Add a new top-level `routes` object.
- Test: `test/stores/routeFactsStore.test.js`, `test/lib/routesHooks.test.js`, `test/scripts/mergeLocaleKeys.test.js`

**Interfaces:**
- Consumes, from Task 1: `RouteFacts`, `buildRouteSnapshot`, `resolveRoutes`, `ROUTE_IDS`, `SendsKey` and `localSttModelKey`.
- Consumes these existing preload calls:
  - `listWhisperModels()` → `{ models: { model, downloaded }[] }`
  - `listParakeetModels()` → `{ models: { model, downloaded }[] }`
  - `modelGetAll()` → `{ id, isDownloaded }[]`
  - `getDiarizationModelStatus?()` → `{ modelsDownloaded }`
  - `getSearchModelStatus()` → `{ downloaded }`
  - `personalInference.codexStatus()` → `{ account? }`
  - `personalInference.credentialStatus(ref)` → `{ configured }`
  - `keyring?.list()`, added in Task 8
  - `privacy?.getSealed()` and `privacy?.onSealedChange(cb)`, from Plan 07
- Produces:

  ```ts
  // src/stores/routeFactsStore.ts
  export const EMPTY_ROUTE_FACTS: RouteFacts;
  export interface RouteFactsApi { /* structural subset of window.electronAPI, see code */ }
  export async function loadRouteFacts(api: RouteFactsApi | undefined): Promise<RouteFacts>;
  export const useRouteFactsStore: UseBoundStore<StoreApi<{ facts: RouteFacts; loaded: boolean }>>;
  export function refreshRouteFacts(): Promise<void>;
  export function ensureRouteFactsSubscribed(): void;
  // src/lib/routes.ts
  export function routeSendsCopy(t: (key: string) => string): Record<SendsKey, string>;
  // test/lib/i18nTestMock.js
  function reactI18nextMock(opts?: { withOptions?: boolean; t?: string }): string;   // ESM source for the mock
  function withI18nMock(serverOptions: object, mockOpts?: { withOptions?: boolean; t?: string }): object;
  export function useResolvedRoutes(): ResolvedRoute[];
  export function useResolvedRoute(id: RouteId): ResolvedRoute;
  ```

  Plus these i18n keys:
  - `routes.names.<RouteId>` (11)
  - `routes.subtitles.<RouteId>` (11)
  - `routes.sends.<SendsKey>` (10: the 9 sending routes plus `voiceAssistantWithScreen`)
  - `routes.groups.{speech,text,support}`
- Later tasks call `refreshRouteFacts()` after any download, delete or key verification.

- [ ] **Step 1: Write the failing tests**

Create `test/stores/routeFactsStore.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const fullApi = (over = {}) => ({
  listWhisperModels: async () => ({ success: true, models: [{ model: "base", downloaded: true }, { model: "small", downloaded: false }] }),
  listParakeetModels: async () => ({ success: true, models: [{ model: "parakeet-unified-en-0.6b", downloaded: true }] }),
  modelGetAll: async () => [{ id: "qwen3.5-2b-q4_k_m", isDownloaded: true }, { id: "qwen3.5-9b", isDownloaded: false }],
  getDiarizationModelStatus: async () => ({ available: true, modelsDownloaded: false }),
  getSearchModelStatus: async () => ({ downloaded: true }),
  personalInference: {
    codexStatus: async () => ({ available: true, account: { type: "chatgpt" } }),
    credentialStatus: async (ref) => ({ configured: ref === "bedrock" }),
  },
  keyring: { list: async () => [{ provider: "groq", hasKey: true, status: "rejected" }, { provider: "openai", hasKey: true, status: "verified" }] },
  privacy: { getSealed: async () => true },
  ...over,
});

test("route facts", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-route-facts-test-" });
  const store = await vite.ssrLoadModule("/stores/routeFactsStore.ts");

  await t.test("loads every fact from existing preload calls", async () => {
    const facts = await store.loadRouteFacts(fullApi());
    assert.deepEqual([...facts.installedModels].sort(), ["llm:qwen3.5-2b-q4_k_m", "sherpa:parakeet-unified-en-0.6b", "whisper:base"]);
    assert.deepEqual([...facts.extraCredentials].sort(), ["bedrock", "codex"]);
    assert.deepEqual([...facts.rejectedKeys], ["groq"]);
    assert.equal(facts.speakerIdModelsReady, false);
    assert.equal(facts.searchModelReady, true);
    assert.equal(facts.sealed, true);
  });

  await t.test("a failing preload call leaves the fact unknown instead of claiming a missing model", async () => {
    const facts = await store.loadRouteFacts(fullApi({
      modelGetAll: async () => { throw new Error("Available in the Loqui desktop app"); },
      getSearchModelStatus: async () => { throw new Error("nope"); },
    }));
    assert.equal(facts.installedModels, null);
    assert.equal(facts.searchModelReady, null);
    assert.equal(facts.speakerIdModelsReady, false);
  });

  await t.test("no preload at all yields empty, unknown facts and an unsealed state", async () => {
    assert.deepEqual(await store.loadRouteFacts(undefined), store.EMPTY_ROUTE_FACTS);
    const missing = await store.loadRouteFacts({});
    assert.equal(missing.installedModels, null);
    assert.equal(missing.sealed, false);
  });

  await t.test("refresh keeps only the newest result", async () => {
    let release;
    const slow = new Promise((r) => (release = r));
    globalThis.window.electronAPI = fullApi({ privacy: { getSealed: () => slow } });
    const first = store.refreshRouteFacts();
    globalThis.window.electronAPI = fullApi({ privacy: { getSealed: async () => false } });
    await store.refreshRouteFacts();
    release(true);
    await first;
    assert.equal(store.useRouteFactsStore.getState().facts.sealed, false);
    assert.equal(store.useRouteFactsStore.getState().loaded, true);
  });
});
```

Create `test/lib/routesHooks.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("./rendererTestHarness");
const { withI18nMock } = require("./i18nTestMock");

test("useResolvedRoutes renders all 11 routes from the settings store", async (t) => {
  // zustand 5 renders the store's *initial* state on the server
  // (useSyncExternalStore's getServerSnapshot), so seed localStorage before
  // the store module is created instead of calling setState.
  // migrateProviderSettings re-derives transcriptionMode from these two, so seed all three.
  installBrowserGlobals(t, {
    initialStorage: {
      transcriptionMode: "providers",
      useLocalWhisper: "false",
      cloudTranscriptionMode: "byok",
      cloudTranscriptionProvider: "openai",
    },
  });
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-routes-hooks-test-" }));
  const routes = await vite.ssrLoadModule("/lib/routes.ts");

  function Probe() {
    const list = routes.useResolvedRoutes();
    const dictation = routes.useResolvedRoute("dictationStt");
    return React.createElement(
      "ol",
      { "data-dictation": dictation.state.status },
      list.map((r) => React.createElement("li", { key: r.id, "data-state": r.state.status }, r.id))
    );
  }

  // No OpenAI key is hydrated in tests (keys come from main), so dictation needs one.
  const html = renderToStaticMarkup(React.createElement(Probe));
  assert.equal((html.match(/<li /g) ?? []).length, 11);
  assert.match(html, /data-dictation="needsKey"/);
  assert.ok(html.indexOf("dictationStt") < html.indexOf("semanticSearch"));
});

test("route copy covers every sending route and nothing else", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-routes-copy-test-" });
  const routes = await vite.ssrLoadModule("/lib/routes.ts");
  const copy = routes.routeSendsCopy((k) => `T:${k}`);
  assert.equal(Object.keys(copy).length, 10);
  assert.equal(copy.voiceAssistantWithScreen, "T:routes.sends.voiceAssistantWithScreen");
  assert.equal(copy.uploadStt, "T:routes.sends.uploadStt");
  assert.equal("speakerId" in copy, false);
});

test("every locale names every route and its payload", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "../../src/locales");
  for (const lang of fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "translation.json")))) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, lang, "translation.json"), "utf8"));
    assert.equal(Object.keys(json.routes.names).length, 11, `${lang} names`);
    assert.equal(Object.keys(json.routes.subtitles).length, 11, `${lang} subtitles`);
    assert.equal(Object.keys(json.routes.sends).length, 10, `${lang} sends`);
  }
});
```

Create `test/scripts/mergeLocaleKeys.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

test("merges nested keys into every locale and refuses incomplete fragments", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-merge-locales-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const lang of ["en", "de"]) {
    fs.mkdirSync(path.join(root, lang));
    fs.writeFileSync(path.join(root, lang, "translation.json"), JSON.stringify({ a: { keep: lang } }, null, 2) + "\n");
  }
  const script = path.join(__dirname, "../../scripts/merge-locale-keys.js");
  const fragment = path.join(root, "frag.json");

  fs.writeFileSync(fragment, JSON.stringify({ en: { a: { add: "x" } } }));
  const bad = spawnSync(process.execPath, [script, fragment, root], { encoding: "utf8" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Missing locales in fragment: de/);

  fs.writeFileSync(fragment, JSON.stringify({ en: { a: { add: "x" } }, de: { a: { add: "y" } } }));
  const ok = spawnSync(process.execPath, [script, fragment, root], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const de = JSON.parse(fs.readFileSync(path.join(root, "de", "translation.json"), "utf8"));
  assert.deepEqual(de, { a: { keep: "de", add: "y" } });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/stores/routeFactsStore.test.js test/lib/routesHooks.test.js test/scripts/mergeLocaleKeys.test.js`
Expected: FAIL. The facts store and script are missing, `routes.useResolvedRoutes` is not a function, and `json.routes` is undefined.

- [ ] **Step 3: Implement**

0. Create `test/lib/i18nTestMock.js`. Vite externalises node_modules in SSR, which bypasses `mockModules`, and any module graph that reaches `src/i18n.ts` needs `initReactI18next`:

   ```js
   // react-i18next stub for Vite SSR renderer tests. noExternal makes Vite run
   // the package through its plugin pipeline so the mock applies;
   // initReactI18next keeps src/i18n.ts's i18n.use(...) working.
   const T_KEYS = "(k) => k";
   const T_WITH_OPTIONS = "(k, o) => (o ? `${k}${JSON.stringify(o)}` : k)";

   function reactI18nextMock({ withOptions = false, t } = {}) {
     const fn = t ?? (withOptions ? T_WITH_OPTIONS : T_KEYS);
     return [
       `export const useTranslation = () => ({ t: ${fn}, i18n: { language: "en", dir: () => "ltr" } });`,
       'export const initReactI18next = { type: "3rdParty", init() {} };',
       "export const Trans = ({ children }) => children ?? null;",
     ].join("\n");
   }

   function withI18nMock(serverOptions = {}, mockOpts = {}) {
     const noExternal = Array.isArray(serverOptions.noExternal) ? serverOptions.noExternal : [];
     return {
       ...serverOptions,
       noExternal: [...noExternal, "react-i18next"],
       mockModules: { ...(serverOptions.mockModules ?? {}), "react-i18next": reactI18nextMock(mockOpts) },
     };
   }

   module.exports = { reactI18nextMock, withI18nMock };
   ```

   `createRendererServer` passes `noExternal` straight to `ssr.noExternal` (`test/lib/rendererTestHarness.js:100-120`), and `test/hooks/modelDownloadErrors.test.js` uses the same approach.

1. Create `scripts/merge-locale-keys.js`:

   ```js
   #!/usr/bin/env node
   // Deep-merges a per-locale fragment into every src/locales/<lang>/translation.json.
   // Usage: node scripts/merge-locale-keys.js <fragment.json> [localesRoot]
   // The fragment is { "en": {...}, "de": {...}, ... } and must cover every locale,
   // so a new key can never land in English only.
   const fs = require("node:fs");
   const path = require("node:path");

   const [fragmentPath, rootArg] = process.argv.slice(2);
   if (!fragmentPath) {
     console.error("Usage: node scripts/merge-locale-keys.js <fragment.json> [localesRoot]");
     process.exit(2);
   }
   const root = rootArg ?? path.join(__dirname, "..", "src", "locales");
   const fragment = JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
   const langs = fs
     .readdirSync(root)
     .filter((d) => fs.existsSync(path.join(root, d, "translation.json")));
   const missing = langs.filter((lang) => !fragment[lang]);
   if (missing.length) {
     console.error(`Missing locales in fragment: ${missing.join(", ")}`);
     process.exit(1);
   }

   const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
   function merge(target, source) {
     for (const [key, value] of Object.entries(source)) {
       target[key] = isObject(value) ? merge(isObject(target[key]) ? target[key] : {}, value) : value;
     }
     return target;
   }

   for (const lang of langs) {
     const file = path.join(root, lang, "translation.json");
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     fs.writeFileSync(file, JSON.stringify(merge(json, fragment[lang]), null, 2) + "\n");
   }
   console.log(`Merged ${path.basename(fragmentPath)} into ${langs.length} locales.`);
   ```

2. In `src/types/electron.ts`, inside the `electronAPI` interface and after `downloadSearchModel` (`:675`), add:

   ```ts
       // Sealed mode (spec §5.4, Plan 07). Optional until Plan 07 ships the
       // preload namespace; the route graph reads it when present.
       privacy?: {
         getSealed: () => Promise<boolean>;
         onSealedChange: (callback: (sealed: boolean) => void) => (() => void) | void;
       };
   ```

3. Create `src/stores/routeFactsStore.ts`:

   ```ts
   import { create } from "zustand";
   import { localSttModelKey, type RouteFacts } from "../lib/routes";

   // Main-process facts the route resolver needs but the settings store does not
   // hold. Every call is optional and may reject (browser preview, older main);
   // a failed call leaves its fact null ("unknown"), which never downgrades a route.

   export interface RouteFactsApi {
     listWhisperModels?: () => Promise<{ models?: { model: string; downloaded: boolean }[] }>;
     listParakeetModels?: () => Promise<{ models?: { model: string; downloaded: boolean }[] }>;
     modelGetAll?: () => Promise<{ id: string; isDownloaded?: boolean }[]>;
     getDiarizationModelStatus?: () => Promise<{ modelsDownloaded: boolean }>;
     getSearchModelStatus?: () => Promise<{ downloaded: boolean }>;
     personalInference?: {
       codexStatus?: () => Promise<{ account?: unknown }>;
       credentialStatus?: (ref: string) => Promise<{ configured: boolean }>;
     };
     keyring?: { list?: () => Promise<{ provider: string; status: string }[]> };
     privacy?: {
       getSealed?: () => Promise<boolean>;
       onSealedChange?: (callback: (sealed: boolean) => void) => (() => void) | void;
     };
   }

   export const EMPTY_ROUTE_FACTS: RouteFacts = {
     installedModels: null,
     extraCredentials: new Set(),
     rejectedKeys: new Set(),
     speakerIdModelsReady: null,
     searchModelReady: null,
     sealed: false,
   };

   async function settle<T>(call: (() => Promise<T>) | undefined): Promise<T | undefined> {
     if (!call) return undefined;
     try {
       return await call();
     } catch {
       return undefined;
     }
   }

   const ENTERPRISE_REFS = ["bedrock", "azure", "vertex"] as const;

   export async function loadRouteFacts(api: RouteFactsApi | undefined): Promise<RouteFacts> {
     if (!api) return EMPTY_ROUTE_FACTS;
     const inference = api.personalInference;
     const credential = (ref: string) =>
       settle(inference?.credentialStatus && (() => inference.credentialStatus!(ref)));
     const [whisper, sherpa, llm, diarization, search, codex, keyring, sealed, ...enterprise] =
       await Promise.all([
         settle(api.listWhisperModels && (() => api.listWhisperModels!())),
         settle(api.listParakeetModels && (() => api.listParakeetModels!())),
         settle(api.modelGetAll && (() => api.modelGetAll!())),
         settle(api.getDiarizationModelStatus && (() => api.getDiarizationModelStatus!())),
         settle(api.getSearchModelStatus && (() => api.getSearchModelStatus!())),
         settle(inference?.codexStatus && (() => inference.codexStatus!())),
         settle(api.keyring?.list && (() => api.keyring!.list!())),
         settle(api.privacy?.getSealed && (() => api.privacy!.getSealed!())),
         ...ENTERPRISE_REFS.map((ref) => credential(ref)),
       ]);

     let installedModels: Set<string> | null = null;
     if (Array.isArray(whisper?.models) && Array.isArray(sherpa?.models) && Array.isArray(llm)) {
       installedModels = new Set<string>();
       for (const m of whisper.models) if (m.downloaded) installedModels.add(localSttModelKey("whisper", m.model));
       for (const m of sherpa.models) if (m.downloaded) installedModels.add(localSttModelKey("nvidia", m.model));
       for (const m of llm) if (m.isDownloaded) installedModels.add(`llm:${m.id}`);
     }

     const extraCredentials = new Set<string>();
     if (codex?.account) extraCredentials.add("codex");
     ENTERPRISE_REFS.forEach((ref, i) => {
       if (enterprise[i]?.configured) extraCredentials.add(ref);
     });

     return {
       installedModels,
       extraCredentials,
       rejectedKeys: new Set((keyring ?? []).filter((k) => k.status === "rejected").map((k) => k.provider)),
       speakerIdModelsReady: diarization ? diarization.modelsDownloaded : null,
       searchModelReady: search ? search.downloaded : null,
       sealed: sealed === true,
     };
   }

   export const useRouteFactsStore = create<{ facts: RouteFacts; loaded: boolean }>()(() => ({
     facts: EMPTY_ROUTE_FACTS,
     loaded: false,
   }));

   const currentApi = (): RouteFactsApi | undefined =>
     typeof window === "undefined" ? undefined : (window.electronAPI as RouteFactsApi | undefined);

   let generation = 0;
   export async function refreshRouteFacts(): Promise<void> {
     const mine = ++generation;
     const facts = await loadRouteFacts(currentApi());
     if (mine === generation) useRouteFactsStore.setState({ facts, loaded: true });
   }

   // One app-lifetime subscription per renderer window.
   let subscribed = false;
   export function ensureRouteFactsSubscribed(): void {
     if (subscribed || typeof window === "undefined") return;
     subscribed = true;
     void refreshRouteFacts();
     currentApi()?.privacy?.onSealedChange?.((sealed) => {
       useRouteFactsStore.setState((s) => ({ facts: { ...s.facts, sealed } }));
     });
     // Facts change on focus, after model downloads or deletes anywhere
     // (useModelDownload.ts:21-24, the cache clear) and after a key is saved
     // (settingsStore.ts:1351), which also resets a rejected key's verdict.
     for (const event of ["focus", "openwhispr-models-cleared", "openwhispr-local-models-changed", "api-key-changed"]) {
       window.addEventListener(event, () => void refreshRouteFacts());
     }
   }
   ```

   `routes.ts` imports only the *type* `RouteFacts` from this direction, and this file imports `localSttModelKey` from `routes.ts`. At runtime the cycle is one-way: `routes.ts` → `routeFactsStore.ts` (hooks) and `routeFactsStore.ts` → `routes.ts` (one function, used only inside `loadRouteFacts`, never at module evaluation). That is safe for ESM. Keep it that way: never call a `routes.ts` export at the top level of this file.

4. Append to `src/lib/routes.ts`. Add the new imports to the top of the file:

   ```ts
   import { useEffect, useMemo } from "react";
   import { useTranslation } from "react-i18next";
   import { useSettingsStore } from "../stores/settingsStore";
   import { ensureRouteFactsSubscribed, useRouteFactsStore } from "../stores/routeFactsStore";
   ```

   Then append at the end:

   ```ts
   // --- React hooks (§5.1) ---

   const SENDS_KEYS: readonly SendsKey[] = [
     "dictationStt", "noteRecordingStt", "uploadStt",
     "dictationCleanup", "voiceAssistant", "assistantVision",
     "translation", "noteFormatting", "chat",
     "voiceAssistantWithScreen",
   ];

   export function routeSendsCopy(t: (key: string) => string): Record<SendsKey, string> {
     return Object.fromEntries(SENDS_KEYS.map((id) => [id, t(`routes.sends.${id}`)])) as Record<SendsKey, string>;
   }

   export function useResolvedRoutes(): ResolvedRoute[] {
     const { t } = useTranslation();
     const settings = useSettingsStore();
     const facts = useRouteFactsStore((s) => s.facts);
     useEffect(() => {
       ensureRouteFactsSubscribed();
     }, []);
     const sends = useMemo(() => routeSendsCopy(t), [t]);
     return useMemo(() => resolveRoutes(buildRouteSnapshot(settings, facts, sends)), [settings, facts, sends]);
   }

   export function useResolvedRoute(id: RouteId): ResolvedRoute {
     const routes = useResolvedRoutes();
     return routes[ROUTE_IDS.indexOf(id)];
   }
   ```

   `useSettingsStore()` with no selector returns the state object, whose identity changes only when a setting changes. The `useMemo` therefore recomputes once per settings change, and consumers get a stable array between changes.

5. Write `/tmp/loqui-i18n-task-2.json` and merge it (see "i18n workflow" above). The `en` block is:

   ```json
   {
     "routes": {
       "groups": { "speech": "Speech", "text": "Text", "support": "This device only" },
       "names": {
         "dictationStt": "Dictation",
         "noteRecordingStt": "Note recording",
         "uploadStt": "Audio upload",
         "dictationCleanup": "Dictation cleanup",
         "voiceAssistant": "Voice assistant",
         "assistantVision": "Assistant vision",
         "translation": "Translation",
         "noteFormatting": "Note formatting",
         "chat": "Chat",
         "speakerId": "Speaker identification",
         "semanticSearch": "Semantic search"
       },
       "subtitles": {
         "dictationStt": "Tap-to-talk into any app",
         "noteRecordingStt": "Meetings and voice notes",
         "uploadStt": "Transcribe an imported file",
         "dictationCleanup": "Fix fillers and punctuation",
         "voiceAssistant": "Ask, then it answers",
         "assistantVision": "Screenshots sent with assistant requests",
         "translation": "Dictate in one language, paste in another",
         "noteFormatting": "Summaries and action items",
         "chat": "Ask questions about your notes",
         "speakerId": "Who said what in meetings",
         "semanticSearch": "Find notes by meaning"
       },
       "sends": {
         "dictationStt": "your audio and dictionary words",
         "noteRecordingStt": "meeting audio",
         "uploadStt": "the audio file",
         "dictationCleanup": "your transcript text",
         "voiceAssistant": "your request and clipboard context",
         "assistantVision": "a screenshot and your request",
         "translation": "the text you translate",
         "noteFormatting": "the meeting transcript",
         "chat": "your messages and note context",
         "voiceAssistantWithScreen": "your request, clipboard context and a screenshot"
       }
     }
   }
   ```

   The `sends` strings are inserted mid-sentence by later tasks ("Dictation now sends {{payload}} to OpenAI."). Translate them as noun phrases that fit after "sends", and keep them lower-case where the language allows it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/stores/routeFactsStore.test.js test/lib/routesHooks.test.js test/scripts/mergeLocaleKeys.test.js test/lib/routes.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS. Typecheck and i18n check are clean.

- [ ] **Step 5: Commit**

```bash
git add src/stores/routeFactsStore.ts src/lib/routes.ts src/types/electron.ts scripts/merge-locale-keys.js src/locales test/lib/i18nTestMock.js test/stores/routeFactsStore.test.js test/lib/routesHooks.test.js test/scripts/mergeLocaleKeys.test.js
git commit -m "feat(routes): Resolve routes from settings and main-process facts"
```

---

