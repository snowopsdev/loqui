const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function sourceFiles(dir, out = []) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (rel !== "src/dist") sourceFiles(rel, out);
    } else if (/\.(?:tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(rel);
  }
  return out;
}

const SCANNED = [
  "src/components",
  "src/hooks",
  "src/services",
  "src/utils",
  "src/helpers",
  "src/lib",
  "src/stores",
];

// Store actions (src/stores/settingsStore.ts) that change a route's provider, model, host, mode or on/off state.
// Not listed: the secret-key setters (Task 2 owns keys), the *CloudMode setters, *DisableThinking, the
// translation language and target setters, the Azure API version and the Bedrock profile, which do not
// change who receives what (NOTES-route: same host).
const ROUTE_SETTERS = [
  // speech: dictation, meeting, upload
  "setTranscriptionMode",
  "setMeetingTranscriptionMode",
  "setUploadTranscriptionMode",
  "setUseLocalWhisper",
  "setMeetingUseLocalWhisper",
  "setUploadUseLocalWhisper",
  "setCloudTranscriptionProvider",
  "setMeetingCloudTranscriptionProvider",
  "setUploadCloudTranscriptionProvider",
  "setCloudTranscriptionModel",
  "setMeetingCloudTranscriptionModel",
  "setUploadCloudTranscriptionModel",
  "setCloudTranscriptionBaseUrl",
  "setMeetingCloudTranscriptionBaseUrl",
  "setUploadCloudTranscriptionBaseUrl",
  "setRemoteTranscriptionUrl",
  "setMeetingRemoteTranscriptionUrl",
  "setRemoteTranscriptionModel",
  "setLocalTranscriptionProvider",
  "setMeetingLocalTranscriptionProvider",
  "setUploadLocalTranscriptionProvider",
  "setWhisperModel",
  "setMeetingWhisperModel",
  "setUploadWhisperModel",
  "setParakeetModel",
  "setMeetingParakeetModel",
  "setUploadParakeetModel",
  "setCohereModel",
  "setMeetingCohereModel",
  "setUploadCohereModel",
  "switchCloudTranscriptionProvider",
  "setCloudTranscriptionForAllScopes",
  // text: per-scope setters and the shared switch
  "switchReasoningProvider",
  "setCloudReasoningForAllScopes",
  "setCleanupMode",
  "setCleanupProvider",
  "setCleanupModel",
  "setCleanupCloudBaseUrl",
  "setCleanupRemoteUrl",
  "setChatAgentMode",
  "setChatAgentProvider",
  "setChatAgentModel",
  "setChatAgentCloudBaseUrl",
  "setChatAgentRemoteUrl",
  "setDictationAgentMode",
  "setDictationAgentProvider",
  "setDictationAgentModel",
  "setDictationAgentCloudBaseUrl",
  "setDictationAgentRemoteUrl",
  "setDictationAgentVisionProvider",
  "setDictationAgentVisionModel",
  "setDictationAgentVisionCloudBaseUrl",
  "setTranslationMode",
  "setTranslationProvider",
  "setTranslationModel",
  "setTranslationCloudBaseUrl",
  "setTranslationRemoteUrl",
  "setNoteFormattingModel",
  // switches that turn a route on, and the Corti host and tenant
  "setUseCleanupModel",
  "setUseDictationTranslation",
  "setUseDictationAgent",
  "setVoiceAgentScreenContext",
  "setUseDictationAgentVisionModel",
  "setCortiEnvironment",
  "setCortiTenant",
  // R2-1: the enterprise route fields (Task 6's ROUTE_ENTERPRISE_KEYS). Each setter persists to main at once
  // (settingsStore.ts:2033-2038, :2060-2065, :2087-2098); UI edits go through requestRoutePatch (Task 9).
  "setBedrockRegion",
  "setAzureEndpoint",
  "setVertexProject",
  "setVertexLocation",
  "setVertexAuthSource",
];
const SETTER_RE = new RegExp(`\\b(?:${ROUTE_SETTERS.join("|")})\\b`, "g");
// setResolvedLLMConfig(scope, patch) is a route write when the patch can carry a route key.
const LLM_ROUTE_KEY = /\b(?:mode|provider|model|remoteUrl|cloudBaseUrl|cloudMode)\b/;

// Files that may write routes, each with the reason it is not a bypass.
const ALLOWLIST = {
  "src/stores/settingsStore.ts":
    "defines the setters and Task 6's applyRoutePatch, the one writer the planner calls",
  "src/stores/routeDraftStore.ts":
    "Task 7: commits and Undo apply the planner's patch through applyRoutePatch",
  "src/lib/providerSwitchPlans.ts":
    "Task 6: the provider-switch planners extracted from switchCloudTranscriptionProvider/switchReasoningProvider",
  "src/lib/routePlanner.ts": "Task 6: builds the patch that preview, commit and Undo share",
  "src/utils/providerSearch.ts":
    "Task 6: writeProviderSearchPreference is the only personalWebSearch:<scope> writer, called by applyRoutePatch",
  "src/hooks/useSettings.ts":
    "passthrough object (`setTranscriptionMode: store.setTranscriptionMode`, :328) that calls nothing; every consumer that destructures a setter is scanned here",
  "src/components/OnboardingFlow.tsx":
    "first-run setup seeds routes (setResolvedLLMConfig :1240; setUseLocalWhisper/setLocalTranscriptionProvider/setParakeetModel :1350-1352); Plan 05 owns onboarding",
  "src/utils/onboardingCleanup.ts":
    "applyCleanupChoice (setUseCleanupModel :59, :65, :69; cleanup mode/provider/model) for onboarding's cleanup step; Plan 05 owns onboarding",
};

// Argument text of every `name(` call, by paren depth.
function callArguments(src, name) {
  const found = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, "g");
  while (re.exec(src)) {
    let depth = 1;
    let j = re.lastIndex;
    for (; j < src.length && depth > 0; j++) {
      if ("([{".includes(src[j])) depth++;
      else if (")]}".includes(src[j])) depth--;
    }
    found.push(src.slice(re.lastIndex, j - 1));
  }
  return found;
}

// The text after the first top-level comma.
function secondArgument(args) {
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    if ("([{".includes(args[i])) depth++;
    else if (")]}".includes(args[i])) depth--;
    else if (args[i] === "," && depth === 0) return args.slice(i + 1).trim();
  }
  return "";
}

const scanned = () =>
  [...new Set(SCANNED.flatMap((dir) => sourceFiles(dir)))]
    .filter((file) => !(file in ALLOWLIST))
    .sort();

test("[baseline guard] every allowlisted route writer exists", () => {
  for (const file of Object.keys(ALLOWLIST))
    assert.ok(fs.existsSync(path.join(root, file)), `${file} (${ALLOWLIST[file]})`);
});

test("[baseline guard after Tasks 6–9] no file outside the planner and the allowlist references a route-affecting setter", () => {
  const offenders = [];
  for (const file of scanned()) {
    const src = stripComments(fs.readFileSync(path.join(root, file), "utf8"));
    const names = [...new Set(src.match(SETTER_RE) ?? [])];
    if (names.length) offenders.push(`${file}: ${names.join(", ")}`);
  }
  assert.deepEqual(
    offenders,
    [],
    "commit through useRouteCommit / requestPatch / RouteSwitch (Tasks 7–9), not the store"
  );
});

test("[baseline guard after Tasks 6–9] setResolvedLLMConfig outside the allowlist never carries a route key", () => {
  const offenders = [];
  for (const file of scanned()) {
    const src = stripComments(fs.readFileSync(path.join(root, file), "utf8"));
    for (const args of callArguments(src, "setResolvedLLMConfig")) {
      const patch = secondArgument(args);
      // An opaque patch (a variable, a spread or a computed key) could carry any key, so it fails too.
      const opaque = !patch.startsWith("{") || patch.includes("...") || /[{,]\s*\[/.test(patch);
      if (opaque || LLM_ROUTE_KEY.test(patch))
        offenders.push(`${file}: setResolvedLLMConfig(${args.replace(/\s+/g, " ")})`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("[baseline guard after Tasks 6–9] only providerSearch.ts touches personalWebSearch:<scope> and nothing bypasses the store's actions", () => {
  const offenders = [];
  for (const file of scanned()) {
    const src = stripComments(fs.readFileSync(path.join(root, file), "utf8"));
    // Any literal: localStorage.setItem/removeItem, useLocalStorage(`personalWebSearch:…`) or a read that skips
    // readProviderSearchPreference. Turning web search on stages (Task 6's providerSearch:<scope> patch key).
    if (/personalWebSearch:/.test(src)) offenders.push(`${file}: personalWebSearch:`);
    if (/\buseSettingsStore\.setState\s*\(/.test(src))
      offenders.push(`${file}: useSettingsStore.setState(`);
  }
  assert.deepEqual(offenders, []);
});

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const everyScannedFile = () => [...new Set(SCANNED.flatMap((dir) => sourceFiles(dir)))].sort();

// The renderer has one enterprise writer. Environment/IPC implement it, while
// compatibility single-field savers remain inside main's shared transaction.
const ENTERPRISE_SAVER_HOSTS = new Set([
  "src/helpers/environment.js",
  "src/helpers/ipcHandlers.js",
  "src/helpers/vertexAuthSourceMigration.js",
]);
const ENTERPRISE_SAVERS =
  /\bsaveEnterpriseRoutePatch\b|\bsave(?:BedrockRegion|AzureEndpoint|VertexProject|VertexLocation|VertexAuthSource)\b/;

test("[baseline guard] only settingsStore.ts sends enterprise route fields to main (R2-1)", () => {
  // Task 6's applyRoutePatch is the only renderer caller of the atomic enterprise transaction.
  const offenders = [];
  for (const file of everyScannedFile()) {
    if (file === "src/stores/settingsStore.ts" || ENTERPRISE_SAVER_HOSTS.has(file)) continue;
    if (ENTERPRISE_SAVERS.test(stripComments(read(file)))) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    "a committed enterprise field reaches main only through applyRoutePatch"
  );
});

// Files that may call adjustBedrockModelForRegion, each with the reason.
const BEDROCK_COUPLING = {
  "src/utils/bedrockRegions.ts": "defines it (import-free)",
  "src/lib/providerSwitchPlans.ts":
    "Task 6: planEnterpriseCoupling puts a region's model update in the same patch and Undo",
  "src/lib/routePlanner.ts":
    "Task 6: providerPatch moves a remembered Bedrock model to the state's region",
};

test("[baseline guard after Task 9] adjustBedrockModelForRegion runs only inside the route planner (R2-1)", () => {
  for (const file of Object.keys(BEDROCK_COUPLING))
    assert.ok(fs.existsSync(path.join(root, file)), `${file} (${BEDROCK_COUPLING[file]})`);
  assert.match(
    read("src/lib/providerSwitchPlans.ts"),
    /\badjustBedrockModelForRegion\(/,
    "the coupling lives in the planner"
  );
  const offenders = [];
  for (const file of everyScannedFile()) {
    if (file in BEDROCK_COUPLING) continue;
    if (/\badjustBedrockModelForRegion\b/.test(stripComments(read(file)))) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    "a region edit is a requestRoutePatch; the planner adds the model update"
  );
});

test("[source guard, baseline after Task 3] the startup sync from main never writes main back (R2-1)", () => {
  const store = stripComments(read("src/stores/settingsStore.ts"));
  const start = store.indexOf("export function reconcileEnterpriseRouteState(");
  const end = store.indexOf("export function ensureEnterpriseRouteSubscribed(", start);
  assert.ok(start !== -1 && end > start, "atomic reconciler exists");
  const body = store.slice(start, end);
  assert.doesNotMatch(body, ENTERPRISE_SAVERS);
  assert.doesNotMatch(body, /\bdebouncedPersistToEnv\b|\belectronAPI\b/);
});

// R2-2 and R2-5: credential writes.

test("[baseline guard after Task 12] ApiKeyInput has no empty-save Remove (R2-5)", () => {
  // An empty save is a permanent delete with no Undo; Remove goes through credentials.remove (useUndoableRemoval).
  const input = stripComments(read("src/components/ui/ApiKeyInput.tsx"));
  assert.doesNotMatch(input, /\bsetApiKey\(\s*""\s*\)|\bcommit\(\s*""\s*\)/);
  assert.match(input, /\buseUndoableRemoval\(/, "Remove is Task 12's undoable removal");
});

test("[baseline guard after Task 12] every <ApiKeyInput in src/ passes a credential identity (R2-5)", () => {
  const ts = require("typescript");
  let elements = 0;
  const offenders = [];
  for (const file of sourceFiles("src").filter((f) => f.endsWith(".tsx"))) {
    const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        node.tagName.getText(tree) === "ApiKeyInput"
      ) {
        elements++;
        if (
          !node.attributes.properties.some(
            (attribute) =>
              ts.isJsxAttribute(attribute) &&
              attribute.name.text === "credentialId" &&
              attribute.initializer
          )
        )
          offenders.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  assert.deepEqual(
    offenders,
    [],
    "Remove needs the explicit slot; JSX callbacks/spreads cannot hide an unbound input"
  );
  assert.ok(elements >= 15, `found ${elements} ApiKeyInput elements`);
});

test("[baseline guard after Task 2] the app reset erases credentials only inside the authority's reset barrier (R2-2)", () => {
  const ipc = read("src/helpers/ipcHandlers.js");
  const cleanup = ipc.match(
    /ipcMain\.handle\("cleanup-app"[\s\S]*?ipcMain\.handle\("update-hotkey"/
  );
  assert.ok(cleanup, "the cleanup-app handler is found");
  assert.match(
    cleanup[0],
    /await this\.credentials\.reset\(\(\) => this\.environmentManager\?\.clearAllPersistedData\(\)\)/
  );
  assert.equal(
    (ipc.match(/\bclearAllPersistedData\b/g) ?? []).length,
    1,
    "ipcHandlers.js erases in one place"
  );
  const offenders = [];
  for (const file of [...everyScannedFile(), "main.js", "preload.js"]) {
    if (file === "src/helpers/ipcHandlers.js" || file === "src/helpers/environment.js") continue;
    if (/\bclearAllPersistedData\b/.test(stripComments(read(file)))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "no other caller can erase outside the barrier");
});

test("[baseline guard after Task 7] route requests are superseded per route; only Discard and close end the session (R2-8)", () => {
  const store = stripComments(read("src/stores/routeDraftStore.ts"));
  // The session epoch moves in exactly one place, the store's discard(), which endSettingsSession() calls.
  assert.equal(
    (store.match(/requestEpoch:\s*s\.requestEpoch \+ 1/g) ?? []).length,
    1,
    "only discard() bumps requestEpoch"
  );
  assert.match(
    store,
    /discard: \(\) => set\(\(s\) => \(\{ draft: null, requestEpoch: s\.requestEpoch \+ 1 \}\)\)/
  );
  // Requests bump their own route's epoch, never a global one (a request on route A must not supersede route B).
  assert.match(store, /const ticket = takeTicket\(id\);/);
  assert.doesNotMatch(store, /\btakeEpoch\b/, "no global request epoch");
});

test("[baseline source guard] route transactions preserve both supersession codes and draft ownership", () => {
  const store = stripComments(read("src/stores/routeDraftStore.ts"));
  for (const code of [
    "ROUTE_PATCH_SUPERSEDED",
    "ENTERPRISE_ROUTE_SUPERSEDED",
    "ENTERPRISE_ROUTE_CONFLICT",
  ])
    assert.ok(store.includes(code), code);
  assert.match(
    store,
    /Object\.entries\(ticket\.routes \?\? \{\}\)/,
    "Undo checks every bumped route"
  );
  assert.match(
    store,
    /useRouteDraftStore\.getState\(\)\.draft !== owned/,
    "PATCH refinement retains exact draft ownership"
  );
  assert.match(
    store,
    /draftIdentity === refinementIdentity/,
    "TARGET refinement retains its lifetime"
  );
  assert.match(store, /new Set<string>\(ROUTE_ENTERPRISE_KEYS\)/);
});

test("[baseline source guard] published stored-audio hook has one runtime consumer", () => {
  const ts = require("typescript");
  const consumers = [];
  for (const file of sourceFiles("src")) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (
        !ts.isImportDeclaration(node) ||
        !node.moduleSpecifier.text?.endsWith("useAudioStorageUsage")
      )
        continue;
      if (node.importClause?.isTypeOnly) continue;
      const bindings = node.importClause?.namedBindings;
      if (
        node.importClause?.name ||
        !bindings ||
        !ts.isNamedImports(bindings) ||
        bindings.elements.some((entry) => !entry.isTypeOnly)
      )
        consumers.push(file);
    }
  }
  assert.deepEqual(consumers, ["src/components/settings/StorageList.tsx"]);
});

// Task2's reviewed startup migration is the only additional main saver; it is
// not a renderer route editor or an extension of the interactive allowlist.
test("[baseline source guard] Vertex source migration remains main-only startup work", () => {
  assert.match(
    read("main.js"),
    /await ipcHandlers\.initializeVertexAuthSource\(existingSettingsProfile\)/
  );
  assert.match(read("src/helpers/ipcHandlers.js"), /require\("\.\/vertexAuthSourceMigration"\)/);
  const migration = stripComments(read("src/helpers/vertexAuthSourceMigration.js"));
  assert.match(migration, /await credentials\.captureCommitted\("vertex"\)/);
  assert.match(
    migration,
    /environment\.saveVertexAuthSource\(source, \{ expectedEpoch: migrationEpoch \}\)/
  );
  for (const file of everyScannedFile()) {
    if (["src/helpers/ipcHandlers.js", "src/helpers/vertexAuthSourceMigration.js"].includes(file))
      continue;
    assert.doesNotMatch(
      stripComments(read(file)),
      /vertexAuthSourceMigration|initializeVertexAuthSource/,
      file
    );
  }
});

test("[baseline source guard] credential metadata covers 23 slots without widening the published 16 identities", () => {
  const ts = require("typescript");
  const { CREDENTIAL_IDS, ALL_CREDENTIAL_SLOTS } = require("../../src/helpers/credentialAuthority");
  const tree = ts.createSourceFile(
    "routeGraph.ts",
    read("src/lib/routeGraph.ts"),
    ts.ScriptTarget.Latest,
    true
  );
  const literals = (name) => {
    const declaration = tree.statements.find(
      (node) => ts.isTypeAliasDeclaration(node) && node.name.text === name
    );
    assert.ok(declaration && ts.isUnionTypeNode(declaration.type), name);
    return declaration.type.types.map((node) => node.literal.text);
  };
  assert.equal(CREDENTIAL_IDS.length, 16);
  assert.equal(ALL_CREDENTIAL_SLOTS.length, 23);
  assert.equal(new Set(ALL_CREDENTIAL_SLOTS).size, 23);
  assert.deepEqual(literals("CredentialId"), CREDENTIAL_IDS);
  assert.deepEqual(
    new Set(literals("CustomCredentialSlot")),
    new Set(ALL_CREDENTIAL_SLOTS.filter((id) => !CREDENTIAL_IDS.includes(id)))
  );
  assert.match(
    read("src/helpers/credentialAuthority.js"),
    /list: \(\) => ALL_CREDENTIAL_SLOTS\.map\(snapshot\)/
  );
  assert.match(
    read("src/lib/credentialSlots.ts"),
    /export type \{ CredentialSlot, CustomCredentialSlot \} from "\.\/routeGraph"/
  );
});

test("[baseline source guard] canonical enterprise reconciliation permits publication markers but forbids main writes", () => {
  const ts = require("typescript");
  const mainWrites = (source) => {
    const found = [];
    const tree = ts.createSourceFile("settingsStore.ts", source, ts.ScriptTarget.Latest, true);
    const reconciler = tree.statements.find(
      (node) =>
        ts.isFunctionDeclaration(node) && node.name?.text === "reconcileEnterpriseRouteState"
    );
    assert.ok(reconciler?.body, "atomic reconciler body");
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const call = node.expression.getText(tree);
        if (/electronAPI|debouncedPersistToEnv|(?:^|\.)save[A-Z]/.test(call)) found.push(call);
      }
      ts.forEachChild(node, visit);
    };
    visit(reconciler.body);
    return found;
  };
  const store = read("src/stores/settingsStore.ts");
  assert.deepEqual(mainWrites(store), []);
  assert.match(store, /notifyEnterpriseAuthority\(authority\.facts/);
  assert.deepEqual(
    mainWrites(
      "function reconcileEnterpriseRouteState() { noteEnterpriseLocalWrite(); window.electronAPI.saveEnterpriseRoutePatch({}); }"
    ),
    ["window.electronAPI.saveEnterpriseRoutePatch"],
    "the allowed publication marker cannot hide a main write"
  );
});

test("[change-driving source guard] credential scans exclude generated src/dist without ignoring authored nested directories", (t) => {
  const directory = (name) => ({ name, isDirectory: () => true });
  const file = (name) => ({ name, isDirectory: () => false });
  const tree = new Map([
    [path.join(root, "src"), [directory("dist"), directory("components"), file("entry.js")]],
    [path.join(root, "src/dist"), [file("compiled.js")]],
    [path.join(root, "src/components"), [directory("dist"), file("Reader.tsx")]],
    [path.join(root, "src/components/dist"), [file("Authored.js")]],
  ]);
  const originalExists = fs.existsSync;
  t.mock.method(fs, "existsSync", (dir) => tree.has(dir) || originalExists(dir));
  const original = fs.readdirSync;
  t.mock.method(fs, "readdirSync", (dir, options) =>
    tree.has(dir) ? tree.get(dir) : original(dir, options)
  );
  assert.deepEqual(sourceFiles("src"), [
    "src/components/dist/Authored.js",
    "src/components/Reader.tsx",
    "src/entry.js",
  ]);
});
