const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const repoRoot = path.join(__dirname, "../..");
const DOC = "docs/security/sealed-mode-threat-model.md";
const SOURCE = /\.(?:[cm]?[jt]sx?|html|css)$/;
// No blanket privacy-module exemption: new guards and parser-only imports must
// be inventoried too. Imports are deliberately conservative alias coverage.
const NETWORK_MODULE =
  /^(?:(?:node:)?(?:https?|http2|tls|net|dgram|dns(?:\/promises)?)|ws|undici|ai|tinfoil|electron-updater|google-auth-library|@ai-sdk\/[^/]+|@aws-sdk\/[^/]+|@smithy\/[^/]+(?:\/.*)?|@qdrant\/js-client-rest)$/;
const SPAWN_MODULE = /^(?:node:)?(?:child_process|worker_threads)$|^ps-list$/;
const SERVICE_MODULE = "@homebridge/dbus-native";
const NETWORK_CALLS = new Set([
  "openExternalUrl",
  "fetch",
  "fetchImpl",
  "fetchModels",
  "doFetch",
  "proxyFetch",
  "tinfoilSecureFetch",
  "createTinfoilRealtimeSocket",
  "sendContentFrame",
  "runTest",
  "runEnterpriseTest",
  "downloadFile",
  "fetchJson",
]);
const NETWORK_MEMBERS = new Set([
  ...NETWORK_CALLS,
  "createWebSocket",
  "checkForUpdates",
  "downloadUpdate",
  "downloadURL",
  "sendBeacon",
  "openExternal",
  "openExternalUrl",
  "openPath",
  "showItemInFolder",
  "loadURL",
  "loadFile",
  "sessionBus",
  "systemBus",
]);
const SPAWN_CALLS = new Set(["openExternalUrl", "spawnImpl", "runFile", "runCommand", "execAsync"]);
const SPAWN_MEMBERS = new Set([
  ...SPAWN_CALLS,
  "relaunch",
  "quitAndInstall",
  "setLoginItemSettings",
  "openExternal",
  "openExternalUrl",
  "openPath",
  "showItemInFolder",
]);
const NETWORK_CTORS = new Set([
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
  "BrowserWindow",
  "Image",
  "Audio",
]);
const SPAWN_CTORS = new Set(["Worker", "SharedWorker", "BrowserWindow"]);
const RESOURCE_TAGS = new Set([
  "img",
  "audio",
  "video",
  "source",
  "iframe",
  "embed",
  "object",
  "link",
  "script",
]);

function scan(code, file = "sample.js") {
  const egress = new Set();
  const spawn = new Set();
  const add = (set, reason) => set.add(reason);
  if (/\.(?:html|css)$/.test(file)) {
    // Static resource syntax is inventoried even when today's URL is bundled.
    const clean = code.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, "");
    if (
      /<(?:img|audio|video|source|iframe|embed|object|link|script)\b/i.test(clean) ||
      /\burl\s*\(|@import\s/i.test(clean)
    )
      add(egress, "Chromium resource");
    return { egress: [...egress], spawn: [...spawn] };
  }
  const tree = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  assert.equal(tree.parseDiagnostics.length, 0, `inventory parser must understand ${file}`);
  const name = (node) => {
    if (!node) return "";
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))
      return node.argumentExpression.text;
    return "";
  };
  const modules = (value, node) => {
    if (value === "electron") {
      const binding = ts.isImportDeclaration(node)
        ? node.importClause?.namedBindings
        : ts.isVariableDeclaration(node.parent)
          ? node.parent.name
          : null;
      if (ts.isImportDeclaration(node) && node.importClause?.name) {
        electronNamespaces.add(node.importClause.name.text);
        add(egress, "Electron network/resource/OS binding");
      }
      if (binding && ts.isNamespaceImport(binding)) {
        electronNamespaces.add(binding.name.text);
        add(egress, "Electron network/resource/OS binding");
      }
      const names =
        binding && (ts.isObjectBindingPattern(binding) || ts.isNamedImports(binding))
          ? binding.elements.map((element) => name(element.propertyName || element.name))
          : [];
      if (names.some((key) => ["net", "session", "shell", "BrowserWindow"].includes(key)))
        add(egress, "Electron network/resource/OS binding");
      if (names.some((key) => ["utilityProcess", "shell", "BrowserWindow"].includes(key)))
        add(spawn, "Electron launch binding");
    }
    if (NETWORK_MODULE.test(value)) add(egress, `module: ${value}`);
    if (SPAWN_MODULE.test(value)) add(spawn, `module: ${value}`);
    if (value === SERVICE_MODULE) {
      add(egress, "OS service IPC");
      add(spawn, "delegated service activation");
    }
    if (value === "react-markdown") add(egress, "implicit Markdown resources");
  };
  // Track simple aliases of global/injected APIs, including destructuring.
  // Arbitrary dataflow remains a review obligation, not a firewall proof.
  const netAliases = new Set(NETWORK_CALLS);
  const spawnAliases = new Set(SPAWN_CALLS);
  const electronNamespaces = new Set();
  const electronNetAliases = new Set();
  const isElectronNamespace = (expression) =>
    ts.isIdentifier(expression) && electronNamespaces.has(expression.text);
  const isElectronModule = (expression) =>
    ts.isCallExpression(expression) &&
    expression.expression.kind === ts.SyntaxKind.Identifier &&
    expression.expression.text === "require" &&
    ts.isStringLiteralLike(expression.arguments[0]) &&
    expression.arguments[0].text === "electron";
  function aliases(node) {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "electron"
    ) {
      const bindings = node.importClause?.namedBindings;
      if (node.importClause?.name) electronNamespaces.add(node.importClause.name.text);
      if (bindings && ts.isNamespaceImport(bindings)) electronNamespaces.add(bindings.name.text);
    }
    if (ts.isImportSpecifier(node)) {
      const original = name(node.propertyName || node.name);
      if (netAliases.has(original) || NETWORK_MEMBERS.has(original)) netAliases.add(node.name.text);
      if (spawnAliases.has(original) || SPAWN_MEMBERS.has(original))
        spawnAliases.add(node.name.text);
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const original = name(node.initializer);
      if (ts.isIdentifier(node.name)) {
        if (netAliases.has(original) || NETWORK_MEMBERS.has(original))
          netAliases.add(node.name.text);
        if (spawnAliases.has(original) || SPAWN_MEMBERS.has(original))
          spawnAliases.add(node.name.text);
        if (
          ts.isPropertyAccessExpression(node.initializer) &&
          node.initializer.name.text === "net" &&
          (isElectronNamespace(node.initializer.expression) ||
            isElectronModule(node.initializer.expression))
        )
          electronNetAliases.add(node.name.text);
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const original = name(element.propertyName || element.name);
          if (NETWORK_MEMBERS.has(original)) netAliases.add(name(element.name));
          if (SPAWN_MEMBERS.has(original)) spawnAliases.add(name(element.name));
        }
      }
    }
    ts.forEachChild(node, aliases);
  }
  aliases(tree);
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier))
        modules(node.moduleSpecifier.text, node);
    }
    if (ts.isCallExpression(node)) {
      const calleeNames = (expression) => {
        if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression))
          return calleeNames(expression.expression);
        if (ts.isBinaryExpression(expression))
          return [...calleeNames(expression.left), ...calleeNames(expression.right)];
        if (ts.isConditionalExpression(expression))
          return [...calleeNames(expression.whenTrue), ...calleeNames(expression.whenFalse)];
        return [name(expression)];
      };
      const called = name(node.expression);
      if (
        (ts.isPropertyAccessExpression(node.expression) ||
          ts.isElementAccessExpression(node.expression)) &&
        called === "open" &&
        name(node.expression.expression) === "window"
      ) {
        add(egress, "Chromium new-window handoff");
        add(spawn, "Chromium new-window handoff");
      }
      const candidates = calleeNames(node.expression);
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        called === "request" &&
        (name(node.expression.expression) === "net" ||
          (ts.isIdentifier(node.expression.expression) &&
            electronNetAliases.has(node.expression.expression.text)))
      )
        add(egress, "Electron net.request");
      if (
        (called === "require" || node.expression.kind === ts.SyntaxKind.ImportKeyword) &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      )
        modules(node.arguments[0].text, node);
      const member =
        ts.isPropertyAccessExpression(node.expression) ||
        ts.isElementAccessExpression(node.expression);
      if (
        candidates.some((candidate) => netAliases.has(candidate)) ||
        (member && NETWORK_MEMBERS.has(called))
      )
        add(egress, `call: ${called}`);
      if (
        candidates.some((candidate) => spawnAliases.has(candidate)) ||
        (member && SPAWN_MEMBERS.has(called))
      )
        add(spawn, `call: ${called}`);
      // utilityProcess/namespace aliases from Electron or child_process are
      // covered by these launch shapes and the module imports respectively.
      if (member && called === "fork") add(spawn, "fork");
    }
    if (ts.isNewExpression(node)) {
      if (NETWORK_CTORS.has(name(node.expression)))
        add(egress, `constructor: ${name(node.expression)}`);
      if (SPAWN_CTORS.has(name(node.expression)))
        add(spawn, `constructor: ${name(node.expression)}`);
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      RESOURCE_TAGS.has(node.tagName.getText(tree))
    )
      add(egress, "Chromium resource");
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return { egress: [...egress], spawn: [...spawn] };
}

function walk(entry) {
  const full = path.join(repoRoot, entry);
  if (fs.statSync(full).isFile())
    return SOURCE.test(entry) && !/\.d\.[cm]?ts$/.test(entry) ? [entry] : [];
  return fs
    .readdirSync(full)
    .sort()
    .filter((child) => !["node_modules", "dist"].includes(child))
    .flatMap((child) => walk(path.posix.join(entry, child)));
}
const sources = () => ["main.js", "preload.js", "src"].flatMap(walk);
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
function block(name) {
  const matches = [...read(DOC).matchAll(new RegExp("```" + name + "\\n([\\s\\S]*?)```", "g"))];
  assert.equal(matches.length, 1, `exactly one ${name} block`);
  const files = matches[0][1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  assert.equal(new Set(files).size, files.length, `${name} has no duplicates`);
  return new Set(files);
}

// These execute the real scanner, without importing any product module or
// contacting any transport. Declarations and ordinary .exec are negative cases.
test("scan recognises aliases, injected/SDK transports and renderer resources", () => {
  for (const extension of ["js", "cjs", "mjs", "jsx", "ts", "tsx", "cts", "mts"])
    assert.ok(SOURCE.test(`fixture.${extension}`), extension);
  for (const code of [
    'const mod = require("https"); mod.request(url)',
    'import { get as read } from "node:http"',
    'export { lookup } from "node:dns/promises"',
    'const mod = await import("node:http2")',
    'import WebSocket from "ws"',
    "new EventSource(url)",
    "new XMLHttpRequest()",
    "await fetch(url)",
    "net.request(url)",
    "(fetchImpl || fetch)(url)",
    'import { openExternalUrl as open } from "./externalUrlOpener"; open(url)',

    "const send = globalThis.fetch; send(url)",
    "const { fetch: send } = net; send(url)",
    "const send = fetchImpl; send(url)",
    "fetchImpl(url)",
    "fetchModels(url)",
    "doFetch()",
    "proxyFetch(url)",
    "runTest(config, captured, environment)",
    "runEnterpriseTest(config, admit)",
    'const { net: transport } = require("electron"); transport.request(url)',
    'import { net as transport } from "electron"',
    'import * as electron from "electron"; const transport = electron.net; transport.request(url)',
    'const transport = require("electron").net; transport.request(url)',
    'import electron from "electron"; const transport = electron.net; transport.request(url)',
    'require("@ai-sdk/azure").createAzure(config)',
    'await import("tinfoil")',
    'require("@aws-sdk/credential-providers")',
    "client.createWebSocket(url)",
    "updater.downloadUpdate()",
    "navigator.sendBeacon(url)",
    "contents.downloadURL(url)",
    "shell.openExternal(url)",
    "shell.openPath(file)",
    "win.loadURL(url)",
    "window.open(url)",
    "const resource = <img src={url} />",
    "const page = <iframe src={url} />",
    'import Markdown from "react-markdown"',
  ])
    assert.ok(scan(code, "fixture.tsx").egress.length, code);
  for (const [file, code] of [
    ["fixture.html", '<link rel="preconnect" href="https://example.invalid">'],
    ["fixture.css", "@font-face { src: url(font); }"],
  ])
    assert.ok(scan(code, file).egress.length, code);
});
test("scan recognises process aliases, SDK probes, OS handoffs and relaunches", () => {
  for (const code of [
    'const cp = require("node:child_process"); cp.exec(command)',
    'import { execFile as run } from "child_process"',
    'import * as threads from "node:worker_threads"',
    "utilityProcess.fork(p)",
    "new Worker(u)",
    "new SharedWorker(u)",
    "spawnImpl(cmd, args)",
    "runFile(cmd, args)",
    "this.runFile(cmd)",
    "runCommand(cmd)",
    "execAsync(cmd)",
    "const launch = spawnImpl; launch(cmd)",
    "app.relaunch()",
    'import { openExternalUrl as open } from "./externalUrlOpener"; open(url)',

    "updater.quitAndInstall()",
    "app.setLoginItemSettings({openAtLogin: true})",
    "shell.openExternal(url)",
    "shell.showItemInFolder(file)",
    'await import("ps-list")',
    'require("@homebridge/dbus-native")',
    "new BrowserWindow(config)",
    "window.open(url)",
  ])
    assert.ok(scan(code).spawn.length, code);
});
test("scan rejects comments, declarations, IPC-looking names and RegExp.exec false positives", () => {
  for (const code of [
    "const match = /codex/.exec(text)",
    'const regex = new RegExp("x"); regex.exec(text)',
    "const map = new Map(); map.get(key)",
    "new WorkerCrashedError()",
    '// fetch(url)\n/* require("https"); app.relaunch() */',
    'const example = "fetch(url); spawnImpl(cmd)"',
    "function fetchImpl(url) {}",
    "function runFile(command) {}",
    "window.electronAPI.getTinfoilChatModels()",

    "interface Transport { fetchImpl(url: string): Promise<Response> }",
  ])
    assert.deepEqual(scan(code, "fixture.ts"), { egress: [], spawn: [] }, code);
});
for (const [kind, fence] of [
  ["egress", "egress-sites"],
  ["spawn", "spawn-sites"],
]) {
  test(`every file with ${kind} capability is in ${fence}`, () => {
    const listed = block(fence);
    const missing = sources().flatMap((file) => {
      const reasons = scan(read(file), file)[kind];
      return reasons.length && !listed.has(file) ? [{ file, reasons }] : [];
    });
    assert.deepEqual(
      missing,
      [],
      `inventory these sites and decide their sealed policy (${fence})`
    );
  });
}
// Explicit reviewed lower bounds prevent a primitive-only scan from silently
// dropping opaque children, callbacks, native addons or renderer resource sites.
// Retiring one requires a reviewed inventory/test change, not just a regex tweak.
test("intentional injected, SDK, native and OS boundaries remain inventoried", () => {
  for (const file of [
    "src/helpers/codexAppServer.js",
    "src/helpers/calendarSyncInterval.js",
    "src/helpers/onnxWorkerClient.js",
    "src/workers/onnxWorker.js",
    "src/helpers/streamingHandOff.js",
    "src/helpers/keyring.js",
    "src/helpers/gpuBinaryManager.js",
    "src/helpers/selfHostedProbe.js",
    "src/helpers/enterpriseAiProviders.js",
    "src/helpers/vectorIndex.js",
    "src/helpers/tinfoilSecureClient.js",
    "src/helpers/realtimeTokenProviders.js",
    "src/helpers/providerConnectionTest.js",
    "src/helpers/codexCli.js",
    "src/models/tinfoilModels.ts",
    "src/services/ai/chatRequestBody.ts",
    "src/components/ui/MarkdownRenderer.tsx",
    "src/components/ui/ModelCardList.tsx",
    "src/components/ui/ProviderIcon.tsx",
    "src/helpers/externalUrlOpener.js",
    "src/helpers/windowManager.js",
    "src/index.html",
  ])
    assert.ok(block("egress-sites").has(file), `retain semantic egress site: ${file}`);
  for (const file of [
    "main.js",
    "src/helpers/ipcHandlers.js",
    "src/helpers/updateManager.js",
    "src/helpers/updateIPC.js",
    "src/helpers/onnxWorkerClient.js",
    "src/helpers/codexCli.js",
    "src/helpers/systemTar.js",
    "src/helpers/processListCache.js",
    "src/helpers/autoStart.js",
    "src/helpers/linuxAutostart.js",
    "src/helpers/ensureYdotool.js",
    "src/helpers/freedesktopNotifications.js",
    "src/helpers/gnomeGlobalShortcutsPortal.js",
    "src/helpers/kdeShortcut.js",
    "src/helpers/sidecarReaper.js",
  ])
    assert.ok(block("spawn-sites").has(file), `retain semantic launch site: ${file}`);
});

test("inventoried paths exist, stay in scope and are source files", () => {
  const current = new Set(sources());
  for (const file of [...block("egress-sites"), ...block("spawn-sites")])
    assert.ok(current.has(file), file);
});
test("N1–N26 each state a sealed decision, planned layer and ledger task", () => {
  const rows = read(DOC)
    .split("\n")
    .filter((line) => /^\| N\d+\s+\|/.test(line));
  assert.deepEqual(
    rows.map((row) => row.split("|")[1].trim()),
    Array.from({ length: 26 }, (_, i) => `N${i + 1}`)
  );
  for (const row of rows) {
    const cells = row.split("|").map((cell) => cell.trim());
    assert.ok(
      [
        "blocked",
        "allowed: loopback",
        "allowed after confirmation",
        "local only: contained",
        "n/a: no network",
      ].includes(cells[5]),
      row
    );
    assert.ok(
      ["A+B", "B", "B: Chromium", "spawn guard", "A+spawn guard", "main dialog", "n/a"].includes(
        cells[6]
      ),
      row
    );
    assert.ok(cells[7], row);
  }
  for (const id of [23, 24, 26])
    assert.equal(rows[id - 1].split("|")[5].trim(), "blocked", `N${id}: no native success in 07a`);
});
