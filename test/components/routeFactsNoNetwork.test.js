const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.join(__dirname, "../..");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const FORBIDDEN = [
  // Each starts the Codex app server (codexAppServer.js:116-181), whose first start in a session
  // may ask GitHub to verify the release (codexCli.js:309-340).
  [/\bcodexStatus\b/, "starts the Codex client"],
  [/\bcodexRateLimits\b/, "starts the Codex client and asks ChatGPT for quota"],
  [/\bcodexModels\b/, "starts the Codex client and asks ChatGPT for models"],
  [/\bpersonalInference\??\.models\b/, "authenticated model discovery"],
  [/\bkeyring\??\.verify\b/, "sends a stored key to a provider"],
  [/\bprobeSelfHosted\b/, "network probe"],
  [/\btestProviderConnection\b/, "network probe"],
  [/\bfetch\s*\(/, "network request"],
];

test("[source guard, baseline] route facts, the resolver, the planner and the route views make no network call", () => {
  for (const file of [
    "src/lib/routeGraph.ts", // Task 1
    "src/helpers/enterpriseRouteFacts.js", // Task 1 (main; reads process.env only)
    "src/lib/credentialSlots.ts", // Task 2
    "src/stores/routeFactsStore.ts", // Task 3
    "src/stores/sealedStore.ts", // Task 3
    "src/lib/routes.ts", // Task 3
    "src/utils/providerSearch.ts", // Tasks 3, 6
    "src/lib/providerSwitchPlans.ts", // Task 6
    "src/lib/routePlanner.ts", // Task 6
    "src/stores/routeDraftStore.ts", // Task 7
    "src/lib/routeChangeMessage.ts", // Task 7
    "src/components/settings/routing/providerCatalog.ts", // Task 8
    "src/components/settings/routing/stagedTarget.ts", // Task 8
    "src/components/settings/routing/useRouteChange.ts", // Task 8
    "src/components/settings/routing/destinations.ts", // Task 10
    "src/components/settings/routing/usePatchbayBoard.ts", // Task 10
    "src/components/settings/routing/Patchbay.tsx", // Task 10
  ]) {
    const src = stripComments(fs.readFileSync(path.join(root, file), "utf8"));
    for (const [pattern, why] of FORBIDDEN) assert.doesNotMatch(src, pattern, `${file}: ${why}`);
  }
});

// Argument text of every `name(` call, found by paren depth (enough for these files' effects).
function callArguments(src, name) {
  const found = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, "g");
  while (re.exec(src)) {
    let depth = 1;
    let j = re.lastIndex;
    for (; j < src.length && depth > 0; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") depth--;
    }
    found.push(src.slice(re.lastIndex, j - 1));
  }
  return found;
}

const CODEX_CALL = /\b(?:refresh|codexStatus|codexRateLimits|codexModels)\s*\(/;

test("[source guard, baseline after Task 9] Settings' Codex views start nothing on mount", () => {
  // C1/I2: CodexConnection read codexStatus/codexRateLimits on mount (v1 :60-62) and CodexModelPicker
  // listed models on mount. Only button handlers and account events (which follow an explicit sign-in
  // or sign-out) may call Codex. Onboarding's opt-in read (`if (checkStatusOnMount) void refresh()`)
  // is the one exception, and ReasoningModelSelector (Settings, NotesOnboarding) never opts in.
  const read = (file) => stripComments(fs.readFileSync(path.join(root, file), "utf8"));
  const selector = read("src/components/ReasoningModelSelector.tsx");
  const views = [
    ["src/components/CodexConnection.tsx", read("src/components/CodexConnection.tsx")],
    [
      "CodexModelPicker (ReasoningModelSelector.tsx)",
      selector.slice(selector.indexOf("function CodexModelPicker")),
    ],
  ];
  assert.ok(
    views[1][1].startsWith("function CodexModelPicker"),
    "CodexModelPicker still lives in ReasoningModelSelector.tsx"
  );
  for (const [file, src] of views) {
    const effects = callArguments(src, "useEffect");
    assert.ok(effects.length > 0, `${file}: effects found`);
    for (const effect of effects) {
      const mountPath = callArguments(effect, "onTextEvent")
        .reduce((rest, handler) => rest.replace(handler, ""), effect)
        .replace(/if \(checkStatusOnMount\) void refresh\(\)\.catch\([\s\S]*?\);/, "");
      assert.doesNotMatch(
        mountPath,
        CODEX_CALL,
        `${file}: an effect calls Codex outside an account event`
      );
    }
  }
  assert.doesNotMatch(selector, /checkStatusOnMount/, "Settings never opts into the mount read");
});

// Every .ts/.tsx/.js file under src/, recursively.
function sourceFiles(dir, sourceRoot = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === path.join(sourceRoot, "dist")) return [];
      return sourceFiles(full, sourceRoot);
    }
    return /\.(?:tsx?|jsx?)$/.test(entry.name) ? [full] : [];
  });
}

test("[source guard, baseline] only src/stores/sealedStore.ts reads the privacy seal API (spec §5.4)", () => {
  // §5.4: sealedStore.ts is the one renderer authority. No other renderer module calls
  // privacy.getSealed or privacy.onSealedChange; they read useSealedStore / getSealed() (and, after
  // Plan 07, getSealedSnapshot() / subscribeSealed(cb)) from that module. Type declarations
  // (src/types/**, *.d.ts) describe the preload API and are not readers.
  const READS = /privacy\??\.\s*(?:getSealed|onSealedChange)\b|\bonSealedChange\b/;
  const offenders = [];
  for (const full of sourceFiles(path.join(root, "src"))) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (
      rel === "src/stores/sealedStore.ts" ||
      // The browser preview's in-memory bridge implements the API; it reads nothing.
      rel === "src/preview/previewPrivacy.ts" ||
      rel.startsWith("src/types/") ||
      rel.endsWith(".d.ts")
    )
      continue;
    if (READS.test(stripComments(fs.readFileSync(full, "utf8")))) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], "read sealed state through src/stores/sealedStore.ts");
});

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// The text of the first `function name(…) { … }`: skip the parameter list by paren depth (defaults
// such as `options = {}` contain braces), then match braces from the body's "{".
function functionBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start !== -1, `${signature} found`);
  let parens = 1;
  let i = start + signature.length;
  for (; i < src.length && parens > 0; i++) {
    if (src[i] === "(") parens++;
    else if (src[i] === ")") parens--;
  }
  let depth = 0;
  for (let j = src.indexOf("{", i); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  assert.fail(`${signature}: unbalanced braces`);
}

test("[source guard] enterprise facts depend only on the deterministic crypto tagger and expose no credential values", () => {
  const file = "src/helpers/enterpriseRouteFacts.js";
  const requires = [...stripComments(read(file)).matchAll(/require\("([^"]+)"\)/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(requires, ["./enterpriseRecipientIdentity"]);
  const identity = stripComments(read("src/helpers/enterpriseRecipientIdentity.js"));
  assert.deepEqual(
    [...identity.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]),
    ["node:crypto"]
  );
  assert.doesNotMatch(identity, /\bfetch\s*\(|ipcRenderer|net\.connect|readFile|child_process/);
  const { enterpriseRouteFacts } = require(path.join(root, file));
  // An injected environment full of secrets: none of them may come back, only the shape below.
  const env = {
    AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "https://guard-user:guard-pass@bedrock.guard.example/",
    GOOGLE_VERTEX_API_KEY: "guard-vertex-key",
    GOOGLE_VERTEX_PROJECT: "guard-project",
  };
  for (const scenario of [env, { AWS_ENDPOINT_URL: "https://bedrock.guard.example/" }, {}]) {
    const facts = enterpriseRouteFacts(scenario);
    assert.deepEqual(Object.keys(facts).sort(), [
      "bedrockEndpoint",
      "bedrockProfile",
      "enterpriseRecipients",
      "vertexApiKeyEnv",
      "vertexProjectEnv",
    ]);
    assert.deepEqual(Object.keys(facts.bedrockEndpoint).sort(), ["host", "set"]);
    assert.equal(typeof facts.bedrockEndpoint.set, "boolean");
    assert.ok(
      facts.bedrockEndpoint.host === null || /^[\w.-]+(?::\d+)?$/.test(facts.bedrockEndpoint.host),
      "a bare host"
    );
    assert.equal(typeof facts.bedrockProfile, "boolean");
    assert.equal(typeof facts.vertexApiKeyEnv, "boolean");
    assert.equal(typeof facts.vertexProjectEnv, "boolean");
    const text = JSON.stringify(facts);
    for (const secret of ["guard-user", "guard-pass", "guard-vertex-key", "guard-project"]) {
      assert.ok(!text.includes(secret), `no environment value in the result (${secret})`);
    }
  }
});

// Inspect actual preload calls, excluding erased type declarations. Atomic authority
// lives in settingsStore; routeFactsStore alone initiates its local snapshot read.
test("[source guard, baseline] enterprise readers use the atomic current/version/facts authority", () => {
  const offenders = [];
  const legacy = new Set([
    "getBedrockRegion",
    "getAzureEndpoint",
    "getVertexProject",
    "getVertexLocation",
    "getVertexAuthSource",
    "enterpriseRouteFacts",
  ]);
  for (const full of sourceFiles(path.join(root, "src"))) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (rel.startsWith("src/types/") || rel.startsWith("src/preview/") || rel.endsWith(".d.ts"))
      continue;
    // Reviewed main authority implementations; renderer helpers remain scanned.
    if (
      [
        "src/helpers/environment.js",
        "src/helpers/ipcHandlers.js",
        "src/helpers/credentialAuthority.js",
        "src/helpers/vertexAuthSourceMigration.js",
      ].includes(rel)
    )
      continue;
    const tree = ts.createSourceFile(
      rel,
      fs.readFileSync(full, "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    function visit(node) {
      if (ts.isPropertyAccessExpression(node)) {
        const name = node.name.text;
        if (
          legacy.has(name) ||
          (name === "getEnterpriseRouteState" &&
            // Reviewed main capture revalidates the atomic authority at admission/dispatch.
            !["src/stores/routeFactsStore.ts", "src/helpers/textOperationCapture.js"].includes(rel))
        )
          offenders.push(`${rel}: ${name}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  assert.deepEqual(
    offenders,
    [],
    "no renderer reconstructs main authority from independently timed getters"
  );
  const facts = read("src/stores/routeFactsStore.ts");
  assert.match(facts, /await api\.getEnterpriseRouteState\(\)/);
  assert.match(facts, /reconcileEnterpriseRouteState\(\{ \.\.\.state, facts \}\)/);
  const store = read("src/stores/settingsStore.ts");
  assert.match(store, /onEnterpriseRouteChanged/);
  assert.match(store, /authority\.version/);
});

test("[source guard, baseline after Task 12] KeyringPanel keeps no renderer-side host map (R2-6)", () => {
  // Verify hosts come from main's keyring.describeVerify, re-asked on every change; an inference host is
  // not a verification host (Corti speech verifies at auth.<region>.corti.app).
  const panel = stripComments(read("src/components/settings/routing/KeyringPanel.tsx"));
  assert.doesNotMatch(panel, /\bproviderHosts\b|\brouteSnapshotFromSettings\b|\bcredentialHost\b/);
  assert.match(panel, /\bdescribeVerify\b/);
});

test("[source guard, baseline after Task 11] keyring Verify tests the committed value, after the seal check (R2-4, R2-7)", () => {
  const verify = functionBody(
    stripComments(read("src/helpers/keyring.js")),
    "async function verify("
  );
  const capture = verify.indexOf("credentials.captureCommitted(");
  // Plan 07 Task 12: also refused before the stored credential is read.
  const sealedBefore = verify.indexOf("isSealed()");
  const sealed = verify.indexOf("isSealed()", capture);
  const send = verify.indexOf("runTest(");
  assert.ok(
    capture !== -1 && sealed !== -1 && send !== -1,
    "verify captures, checks the seal and sends"
  );
  assert.ok(
    sealedBefore < capture,
    "sealed, nothing is read: the seal is checked before the capture"
  );
  assert.ok(capture < sealed, "the seal is checked after the save wait (the capture)");
  assert.ok(sealed < send, "nothing is sent while sealed");
  assert.match(
    verify,
    /runTest\(target\.config, captured\.values, target\.requestEnvironment\)/,
    "the request carries the captured committed values"
  );
  assert.doesNotMatch(verify, /process\.env/, "Verify never reads the live environment");
});

test("[source guard, baseline after Task 11] the production IPCHandlers reads the seal predicate, default () => false (R2-7)", () => {
  const ipc = read("src/helpers/ipcHandlers.js");
  assert.match(
    ipc,
    /this\.isSealed = typeof managers\.isSealed === "function" \? managers\.isSealed : \(\) => false;/
  );
  assert.match(ipc, /isSealed: \(\) => this\.isSealed\(\)/);
  // Plan 07's handoff anchor (Step 8): main constructs IPCHandlers with one managers object.
  assert.match(read("main.js"), /ipcHandlers = new IPCHandlers\(\{/);
});

test("[source guard, baseline after Task 11] enterprise describeVerify follows main's environment overrides (R2-6)", () => {
  // The SDKs honour AWS_ENDPOINT_URL_BEDROCK_RUNTIME/AWS_ENDPOINT_URL and GOOGLE_VERTEX_API_KEY in main's
  // environment, so the Test connection label must name the host those overrides send to.
  const ipc = stripComments(read("src/helpers/ipcHandlers.js"));
  assert.match(
    ipc,
    /enterpriseRouteFacts\(process\.env,\s*\{/,

    "atomic enterprise facts derive from main environment and committed config"
  );
  assert.match(ipc, /getEnterpriseRouteState\(\)/);
  const target = functionBody(
    stripComments(read("src/helpers/keyring.js")),
    "function enterpriseVerifyTarget("
  );
  assert.match(target, /enterprise\.routeFacts/);
  assert.match(
    target,
    /bedrockEndpoint\.set/,
    "a Bedrock endpoint override replaces the region host"
  );
  assert.match(target, /vertexApiKeyEnv/, "GOOGLE_VERTEX_API_KEY selects Vertex express mode");
});

// A type-only import is erased; do not accidentally count it as a graph edge.
test("[baseline source guard] the pure graph keeps exactly three runtime imports", () => {
  const source = ts.createSourceFile(
    "routeGraph.ts",
    read("src/lib/routeGraph.ts"),
    ts.ScriptTarget.Latest,
    true
  );
  const imports = source.statements.filter(ts.isImportDeclaration);
  assert.deepEqual(
    imports
      .filter((node) => !node.importClause?.isTypeOnly)
      .map((node) => node.moduleSpecifier.text),
    ["./locality.ts", "../helpers/transcriptionRoute.ts", "../utils/urlUtils.ts"]
  );
  assert.doesNotMatch(stripComments(source.text), /require\s*\(|import\s*\(/);
});

test("[baseline source guard] keyring coalescing and health bind full config and committed generation", () => {
  const keyring = stripComments(read("src/helpers/keyring.js"));
  const verify = functionBody(keyring, "async function verify(");
  assert.match(verify, /recipients\.validate\(options\.recipientToken, sender/);
  assert.match(verify, /validate\(\{ id: identity, \.\.\.captured \}\)/);
  assert.match(verify, /captured\.generation.*target\.fingerprint/);
  assert.match(verify, /current\?\.fingerprint !== target\.fingerprint/);
  assert.match(verify, /config_fingerprint: target\.fingerprint/);
  assert.match(keyring, /row\?\.config_fingerprint === target\.fingerprint/);
  assert.match(keyring, /recipients\.issue\(sender, target\.canonical, meta\)/);
  const connection = functionBody(keyring, "async function verifyConnection(");
  assert.match(connection, /await credentials\.captureCommitted/);
  assert.match(connection, /Object\.freeze\(/);
  assert.match(connection, /snapshot\.canonical\.model/);
  assert.match(connection, /validate\(metadata\(identity\)\)/);
  assert.match(connection, /captured\.values\.key !== expectedLegacyKey/);
});

test("[baseline source guard] reviewed keyring bindings are captured before the renderer save wait", () => {
  const panel = stripComments(read("src/components/settings/routing/KeyringPanel.tsx"));
  const start = panel.indexOf("recipientToken: description.target.recipientToken");
  const wait = panel.indexOf("await live.current.flush()", start);
  assert.ok(start !== -1 && wait > start, "the displayed token is captured before flush");
  const keyring = stripComments(read("src/helpers/keyring.js"));
  const describe = functionBody(keyring, "async function describeVerify(");
  assert.doesNotMatch(
    describe,
    /captureCommitted|runTest|runEnterpriseTest|readFile|fromIni|getAccessToken|fetch\s*\(/,
    "description reads metadata only"
  );
  const ipc = stripComments(read("src/helpers/ipcHandlers.js"));
  assert.match(ipc, /deadlineAt/);
  assert.match(ipc, /signal: controller\.signal/);
  const factory = stripComments(read("src/helpers/enterpriseAiProviders.js"));
  assert.match(factory, /redirect: "error"/);
  assert.match(factory, /UNSUPPORTED_AUTH_SOURCE/);
  assert.match(factory, /authorized_user/);
  assert.match(factory, /service_account/);
});

test("[change-driving source guard] authored-source walks exclude only the generated root dist tree", (t) => {
  const sourceRoot = path.join(root, "fixture-authored-src");
  const directory = (name) => ({ name, isDirectory: () => true });
  const file = (name) => ({ name, isDirectory: () => false });
  const tree = new Map([
    [sourceRoot, [directory("dist"), directory("components"), file("entry.js")]],
    [path.join(sourceRoot, "dist"), [file("compiled.js")]],
    [path.join(sourceRoot, "components"), [directory("dist"), file("Reader.tsx")]],
    [path.join(sourceRoot, "components/dist"), [file("Authored.js")]],
  ]);
  const original = fs.readdirSync;
  t.mock.method(fs, "readdirSync", (dir, options) =>
    tree.has(dir) ? tree.get(dir) : original(dir, options)
  );
  assert.deepEqual(
    sourceFiles(sourceRoot)
      .map((full) => path.relative(sourceRoot, full))
      .sort(),
    ["components/Reader.tsx", "components/dist/Authored.js", "entry.js"],
    "compiled bundles are excluded while all authored JS/TS and nested dist-named source remain guarded"
  );
});

test("[baseline source guard] an available renderer build does not enter authored authority scans", () => {
  const authored = sourceFiles(path.join(root, "src")).map((full) => path.relative(root, full));
  assert.ok(authored.includes("src/stores/sealedStore.ts"));
  assert.ok(authored.includes("src/stores/routeFactsStore.ts"));
  assert.ok(authored.includes("src/helpers/keyring.js"));
  assert.ok(authored.every((file) => !file.startsWith("src/dist/")));
});

test("[change-driving source guard] root lint retains QA and generated-cache ignores without hiding authored tests", async () => {
  const { ESLint } = require("eslint");
  const lint = new ESLint({ cwd: root });
  for (const file of [
    ".superpowers/fixture/browser-vite-cache/deps/react.js",
    ".superpowers/fixture/browser-vite-cache-authored.js",
    "test/fixtures/browser-vite-cache/deps/react.js",
  ])
    assert.equal(await lint.isPathIgnored(path.join(root, file)), true, file);
  const authored = path.join(root, "test/fixtures/browser-vite-cache-authored.js");
  assert.equal(await lint.isPathIgnored(authored), false);
  const [result] = await lint.lintText("task25IntentionallyUndefined();", { filePath: authored });
  assert.equal(result.errorCount, 1);
  assert.deepEqual(
    result.messages.map(({ ruleId, message }) => ({ ruleId, message })),
    [{ ruleId: "no-undef", message: "'task25IntentionallyUndefined' is not defined." }]
  );
  assert.equal(await lint.isPathIgnored(path.join(root, "main.js")), false);
  // The suite's tsx loader changes ESLint's ESM-config loading. Check the same
  // plain-Node boundary used by `cd src && eslint .`, with guards inherited.
  const { spawnSync } = require("node:child_process");
  const rendererProbe = spawnSync(
    process.execPath,
    [
      "-e",
      `
    const { ESLint } = require("eslint");
    (async () => {
      const lint = new ESLint({ cwd: process.cwd() });
      const file = require("node:path").resolve("components/dictation/pillLocality.ts");
      const config = await lint.calculateConfigForFile(file);
      console.log(JSON.stringify({ ignored: await lint.isPathIgnored(file),
        hooks: config?.rules?.["react-hooks/rules-of-hooks"]?.[0] }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `,
    ],
    { cwd: path.join(root, "src"), env: { ...process.env }, encoding: "utf8" }
  );
  assert.equal(rendererProbe.status, 0, rendererProbe.stderr);
  assert.deepEqual(JSON.parse(rendererProbe.stdout), { ignored: false, hooks: 2 });
  assert.equal(
    await lint.isPathIgnored(path.join(root, "test/components/routeFactsNoNetwork.test.js")),
    false
  );
});
