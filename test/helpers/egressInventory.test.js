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
  "gatedNetFetch",
  "postMultipart",
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
    "gatedNetFetch(url, init, meta)",
    "postMultipart(url, body, boundary)",
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
    "src/helpers/privacy/gatedFetch.js",
    "src/helpers/personalInference.js",
    "src/helpers/tinfoilCatalog.js",
    // Task 9: batch speech transports.
    "src/helpers/sttTransport.js",
    "src/helpers/cortiAuth.js",
    "src/helpers/cortiTranscription.js",
    "src/helpers/geminiTranscription.js",
    "src/helpers/tinfoilTranscription.js",
    "src/models/tinfoilModels.ts",
    "src/services/ai/chatRequestBody.ts",
    "src/components/ui/MarkdownRenderer.tsx",
    "src/components/ui/ModelCardList.tsx",
    "src/components/ui/ProviderIcon.tsx",
    "src/helpers/externalUrlOpener.js",
    "src/helpers/windowManager.js",
    "src/index.html",
    // Task 10: gated model/runtime downloads, URL import and app updates.
    "src/helpers/downloadUtils.js",
    "src/helpers/urlAudioDownloader.js",
    "src/helpers/updateManager.js",
    // Task 11: gated calendar OAuth/API, the loopback sign-in listener and the
    // confirmed OS handoffs (browser, mail, settings, Codex consent page).
    "src/helpers/googleCalendarOAuth.js",
    "src/helpers/googleCalendarManager.js",
    "src/helpers/microsoftCalendarOAuth.js",
    "src/helpers/microsoftCalendarManager.js",
    "src/helpers/oauthLoopbackFlow.js",
    "src/helpers/meetingDetectionEngine.js",
    "src/helpers/menuManager.js",
    "main.js",
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
    // Task 8: the Codex app-server launch runs inside its opaque session.
    "src/helpers/codexAppServer.js",
    "src/helpers/personalInference.js",
    // Task 10: yt-dlp runs inside its import or self-update session; archive
    // extraction (unzip/tar/PowerShell) is refused sealed by the spawn guard.
    "src/helpers/urlAudioDownloader.js",
    "src/helpers/downloadUtils.js",
    // Task 11: OS handoffs (explorer.exe/shell.openExternal) and Apple's
    // EventKit helper; confirmation never waives the native refusal.
    "src/helpers/externalUrlOpener.js",
    "src/helpers/appleCalendarManager.js",
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

// ---------------------------------------------------------------------------
// Final review item 38: three source ratchets over main.js, preload.js and
// src/**. Each detector is executed on samples first, and each ratchet sits
// beside executed behaviour tests of the thing it guards:
// - shell.openExternal: externalLinkSealed.test.js (the guarded opener's
//   sealed confirmation) (T11-M3);
// - window handlers: windowNavigationGuards.test.js (window.open denied,
//   navigation prevented and routed, permission routed) (I3);
// - non-ok bodies: gatedErrorBodies.test.js (an unread error body through the
//   real gate) (I7).
// A ratchet is a review aid, not proof: dataflow it cannot follow stays a
// review obligation.

const parseSource = (code, file) => {
  const tree = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  assert.equal(tree.parseDiagnostics.length, 0, `ratchet parser must understand ${file}`);
  return tree;
};
const lineOf = (tree, node) => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
const eachNode = (node, fn) => {
  fn(node);
  ts.forEachChild(node, (child) => eachNode(child, fn));
};
const enclosingFunction = (node) => {
  for (let at = node.parent; at; at = at.parent) if (ts.isFunctionLike(at) && at.body) return at;
  return node.getSourceFile();
};
const isRequireOf = (expression, specifier) =>
  ts.isCallExpression(expression) &&
  ts.isIdentifier(expression.expression) &&
  expression.expression.text === "require" &&
  ts.isStringLiteralLike(expression.arguments[0]) &&
  expression.arguments[0].text === specifier;

// Lines that reach Electron's shell.openExternal: a member access, an element
// access or a destructuring of `openExternal` from Electron's shell (by name
// or through an alias of it). Conservative: any identifier `shell` counts.
function shellOpenExternalSites(code, file = "sample.js") {
  const tree = parseSource(code, file);
  const shells = new Set(["shell"]);
  const electron = new Set();
  const isShell = (expression) => {
    while (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression))
      expression = expression.expression;
    if (ts.isIdentifier(expression)) return shells.has(expression.text);
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text === "shell";
    if (ts.isElementAccessExpression(expression))
      return (
        ts.isStringLiteralLike(expression.argumentExpression) &&
        expression.argumentExpression.text === "shell"
      );
    return false;
  };
  const isElectron = (expression) =>
    isRequireOf(expression, "electron") ||
    (ts.isIdentifier(expression) && electron.has(expression.text));
  eachNode(tree, (node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === "electron") {
      const clause = node.importClause;
      if (clause?.name) electron.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) electron.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          if ((element.propertyName || element.name).text === "shell")
            shells.add(element.name.text);
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name) && isElectron(node.initializer)) electron.add(node.name.text);
      if (ts.isIdentifier(node.name) && isShell(node.initializer)) shells.add(node.name.text);
      if (ts.isObjectBindingPattern(node.name) && isElectron(node.initializer))
        for (const element of node.name.elements)
          if ((element.propertyName || element.name).getText(tree) === "shell")
            shells.add(element.name.getText(tree));
    }
  });
  const sites = [];
  eachNode(tree, (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "openExternal" &&
      isShell(node.expression)
    )
      sites.push(lineOf(tree, node));
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "openExternal" &&
      isShell(node.expression)
    )
      sites.push(lineOf(tree, node));
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectBindingPattern(node.name) &&
      isShell(node.initializer) &&
      node.name.elements.some(
        (element) => (element.propertyName || element.name).getText(tree) === "openExternal"
      )
    )
      sites.push(lineOf(tree, node));
  });
  return sites;
}

test("the shell.openExternal detector finds every spelling and ignores look-alikes", () => {
  for (const code of [
    'const { shell } = require("electron"); shell.openExternal(url);',
    'require("electron").shell.openExternal(url);',
    'const { shell: os } = require("electron"); os.openExternal(url);',
    'const electron = require("electron"); electron.shell["openExternal"](url);',
    'import { shell as s } from "electron"; void s?.openExternal(url);',
    'import * as e from "electron"; const sh = e.shell; sh.openExternal(url);',
    'const { openExternal } = require("electron").shell; openExternal(url);',
    "const open = shell.openExternal; open(url);",
  ])
    assert.equal(shellOpenExternalSites(code).length, 1, code);
  for (const code of [
    "window.electronAPI.openExternal(url);",
    "this.openExternalUrl(url);",
    "const api = { openExternal: (url) => opener(url) };",
    "options.openExternal(url);",
    'const { openExternalUrl } = require("./externalUrlOpener"); openExternalUrl(url);',
    "// shell.openExternal(url) in a comment",
  ])
    assert.deepEqual(shellOpenExternalSites(code), [], code);
});

test("ratchet: Electron's shell.openExternal is reached only from externalUrlOpener.js (T11-M3)", () => {
  const found = {};
  for (const file of sources().filter((f) => /\.[cm]?[jt]sx?$/.test(f))) {
    const sites = shellOpenExternalSites(read(file), file);
    if (sites.length) found[file] = sites;
  }
  assert.deepEqual(Object.keys(found), ["src/helpers/externalUrlOpener.js"], JSON.stringify(found));
});

// Every `new BrowserWindow` is assigned to a target, and the function that
// creates it then installs both window handlers on that target: through
// navigationGuard's guardWindowNavigation (directly or via windowManager's
// _guardWindowNavigation), or by calling setWindowOpenHandler and
// on("will-navigate") on its webContents itself.
function browserWindowGuards(code, file = "sample.js") {
  const tree = parseSource(code, file);
  const results = [];
  eachNode(tree, (node) => {
    if (!ts.isNewExpression(node)) return;
    const created = node.expression;
    if (!(ts.isIdentifier(created) ? created.text : created.name?.text)?.endsWith("BrowserWindow"))
      return;
    if (!/^(?:\w+\.)?BrowserWindow$/.test(created.getText(tree))) return;
    const parent = node.parent;
    const target =
      ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ? parent.left.getText(tree)
        : ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
          ? parent.name.text
          : null;
    const handlers = { helper: false, open: false, navigate: false };
    if (target) {
      const contents = `${target}.webContents`;
      eachNode(enclosingFunction(node), (call) => {
        if (!ts.isCallExpression(call) || call.pos < node.end) return;
        const callee = call.expression;
        const calleeName = ts.isIdentifier(callee) ? callee.text : callee.name?.text;
        const [first] = call.arguments;
        const firstText = first?.getText(tree);
        if (
          ["guardWindowNavigation", "_guardWindowNavigation"].includes(calleeName) &&
          (firstText === target || firstText === contents)
        )
          handlers.helper = true;
        if (!ts.isPropertyAccessExpression(callee) || callee.expression.getText(tree) !== contents)
          return;
        if (calleeName === "setWindowOpenHandler") handlers.open = true;
        if (calleeName === "on" && ts.isStringLiteralLike(first) && first.text === "will-navigate")
          handlers.navigate = true;
      });
    }
    results.push({
      line: lineOf(tree, node),
      target,
      guarded: handlers.helper || (handlers.open && handlers.navigate),
    });
  });
  return results;
}

test("the BrowserWindow guard detector needs both handlers on the created window", () => {
  const guarded = [
    "function f() { this.win = new BrowserWindow({}); this._guardWindowNavigation(this.win); }",
    "function f() { const w = new BrowserWindow(o); guardWindowNavigation(w.webContents, x); }",
    `function f() { const w = new electron.BrowserWindow(o);
       w.webContents.on("will-navigate", h); w.webContents.setWindowOpenHandler(g); }`,
  ];
  const unguarded = [
    "function f() { const w = new BrowserWindow(o); w.webContents.setWindowOpenHandler(g); }",
    'function f() { const w = new BrowserWindow(o); w.webContents.on("will-navigate", h); }',
    "function f() { const w = new BrowserWindow(o); this._guardWindowNavigation(other); }",
    "function f() { this._guardWindowNavigation(w); const w = new BrowserWindow(o); }",
    "function f() { windows.push(new BrowserWindow(o)); }",
    "function f() { const w = new BrowserWindow(o); } function g() { guardWindowNavigation(w); }",
  ];
  for (const code of guarded)
    assert.deepEqual(
      browserWindowGuards(code).map((r) => r.guarded),
      [true],
      code
    );
  for (const code of unguarded)
    assert.deepEqual(
      browserWindowGuards(code).map((r) => r.guarded),
      [false],
      code
    );
  assert.deepEqual(browserWindowGuards("const w = new Map();"), []);
});

test("ratchet: every new BrowserWindow installs both window handlers (I3)", (t) => {
  const sites = [];
  for (const file of sources().filter((f) => /\.[cm]?[jt]sx?$/.test(f)))
    for (const site of browserWindowGuards(read(file), file)) sites.push({ file, ...site });
  assert.ok(sites.length >= 4, `main, control panel, pill and notification: ${sites.length}`);
  assert.deepEqual(
    sites.filter((site) => !site.guarded),
    [],
    "a window without both handlers would open links in-app"
  );
  t.diagnostic(`BrowserWindow sites: ${sites.map((s) => `${s.file}:${s.line}`).join(", ")}`);
});

// Responses from a gated fetch hold their gate ticket open until the body
// ends (egressGate.guardResponse), so a caller must read or cancel an error
// body. A gated callee is gatedNetFetch, a local function that wraps it
// (`doFetch`, `proxyFetch`), or a parameter main fills with one (INJECTED).
// Each awaited response must be read before its non-ok check, or read or
// cancelled inside the non-ok branch; a call shape the ratchet cannot follow
// fails, so a new caller is reviewed.
const CONSUME = new Set(["text", "json", "arrayBuffer", "blob", "formData", "bytes"]);
function gatedFetchBodies(code, file = "sample.js", injected = []) {
  const tree = parseSource(code, file);
  const callees = new Set(["gatedNetFetch", ...injected]);
  const aliasBodies = [];
  const aliases = [];
  eachNode(tree, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isIdentifier(node.name)) return;
    eachNode(node.initializer, (inner) => {
      if (!ts.isArrowFunction(inner) && !ts.isFunctionExpression(inner)) return;
      let wraps = false;
      eachNode(inner, (call) => {
        if (
          ts.isCallExpression(call) &&
          ts.isIdentifier(call.expression) &&
          call.expression.text === "gatedNetFetch"
        )
          wraps = true;
      });
      if (wraps) {
        aliasBodies.push(inner);
        aliases.push(node.name.text);
        callees.add(node.name.text);
      }
    });
  });
  const findings = [];
  const calls = [];
  eachNode(tree, (call) => {
    if (
      !ts.isCallExpression(call) ||
      !ts.isIdentifier(call.expression) ||
      !callees.has(call.expression.text)
    )
      return;
    if (aliasBodies.some((body) => call.pos >= body.pos && call.end <= body.end)) return;
    const line = lineOf(tree, call);
    calls.push(line);
    const declaration = call.parent?.parent;
    if (
      !ts.isAwaitExpression(call.parent) ||
      !ts.isVariableDeclaration(declaration) ||
      !ts.isIdentifier(declaration.name)
    ) {
      findings.push({ line, why: "unrecognised call shape" });
      return;
    }
    const response = declaration.name.text;
    const scope = enclosingFunction(declaration);
    const consumed = (within) => {
      let found = false;
      eachNode(within, (node) => {
        if (node.pos < declaration.end || !ts.isCallExpression(node)) return;
        const callee = node.expression;
        if (ts.isPropertyAccessExpression(callee)) {
          const receiver = callee.expression.getText(tree);
          if (CONSUME.has(callee.name.text) && receiver === response) found = true;
          if (
            callee.name.text === "cancel" &&
            /^\w+\??\.body$/.test(receiver) &&
            receiver.startsWith(response)
          )
            found = true;
        }
        if (node.arguments.some((arg) => arg.getText(tree) === response)) found = true;
      });
      return found;
    };
    const nonOk = new RegExp(
      `!\\s*${response}\\.ok\\b|\\b${response}\\.status\\s*>=?\\s*(?:399|[45]\\d\\d)\\b`
    );
    const statusRead = new RegExp(`\\b${response}\\.(?:ok|status)\\b`);
    const branches = [];
    let unknownCheck = false;
    eachNode(scope, (node) => {
      if (!ts.isIfStatement(node) || node.pos < declaration.end) return;
      // Checks nested in a non-ok branch only refine that branch's error.
      if (branches.some((b) => node.pos >= b.thenStatement.pos && node.end <= b.thenStatement.end))
        return;
      const condition = node.expression.getText(tree);
      if (nonOk.test(condition)) branches.push(node);
      else if (statusRead.test(condition)) unknownCheck = true;
    });
    if (unknownCheck) findings.push({ line, why: `unrecognised status check on ${response}` });
    // A body read before the first non-ok check covers every branch after it.
    const firstCheck = branches[0];
    const readBefore = (() => {
      if (!firstCheck) return consumed(scope);
      let found = false;
      eachNode(scope, (node) => {
        if (found || node.pos >= firstCheck.pos) return;
        if (node.pos > declaration.end && ts.isStatement(node) && consumed(node)) found = true;
      });
      return found;
    })();
    if (!firstCheck && !readBefore)
      findings.push({ line, why: `${response} is never read or cancelled` });
    for (const branch of branches)
      if (!readBefore && !consumed(branch.thenStatement))
        findings.push({
          line: lineOf(tree, branch),
          why: `the non-ok branch leaves ${response}'s body unread`,
        });
  });
  return { findings, calls, aliases };
}

test("the gated-fetch body detector accepts reads and cancels, and flags unread error bodies", () => {
  const ok = [
    `async function f() { const r = await gatedNetFetch(u, i, m);
       if (!r.ok) { const t = await r.text(); throw new Error(t); } return r.json(); }`,
    `async function f() { const r = await gatedNetFetch(u);
       if (!r.ok) { await r.body?.cancel().catch(() => {}); return null; } return r.json(); }`,
    `async function f() { const r = await gatedNetFetch(u); const t = await r.text();
       if (r.status >= 400) throw new Error(t); return t; }`,
    `async function f() { const r = await gatedNetFetch(u); return JSON.parse(await r.text()); }`,
    `async function f() { const r = await gatedNetFetch(u);
       if (!r.ok) { const t = await r.text(); if (r.status === 401) throw Error("key"); throw Error(t); } }`,
    `async function f(fetchImpl) { const doFetch = fetchImpl || ((a, b) => gatedNetFetch(a, b));
       const r = await doFetch(u); if (!r.ok) { const t = await r.text(); throw Error(t); } }`,
  ];
  for (const code of ok) assert.deepEqual(gatedFetchBodies(code).findings, [], code);
  const bad = [
    `async function f() { const r = await gatedNetFetch(u);
       if (!r.ok) return { status: r.status }; return r.json(); }`,
    `async function f() { const r = await gatedNetFetch(u);
       if (r.status >= 400) throw new Error("x"); return r.json(); }`,
    `async function f() { const proxyFetch = (a) => gatedNetFetch(a);
       const r = await proxyFetch(u); if (!r.ok) throw new Error("x"); }`,
    "async function f() { const r = await gatedNetFetch(u); return r.status; }",
    "async function f() { const r = await gatedNetFetch(u); if (r.ok) return r.json(); }",
    "function f() { return gatedNetFetch(u).then((r) => r.status); }",
  ];
  for (const code of bad) assert.notDeepEqual(gatedFetchBodies(code).findings, [], code);
  // An injected gated fetch (a parameter main fills) is followed the same way.
  const injected = `async function probe(url, fetchImpl) { const r = await fetchImpl(url);
    if (!r.ok) return { ok: false }; return r.json(); }`;
  assert.deepEqual(gatedFetchBodies(injected).findings, []);
  assert.notDeepEqual(gatedFetchBodies(injected, "probe.js", ["fetchImpl"]).findings, []);
});

// Parameters main fills with a gated fetch (see ipcHandlers): the probe gets
// gatedNodeFetch("providerCheck"), the realtime token providers get proxyFetch.
const INJECTED_GATED_FETCH = {
  "src/helpers/selfHostedProbe.js": ["fetchImpl"],
  "src/helpers/realtimeTokenProviders.js": ["proxyFetch"],
};

test("ratchet: every gated-fetch caller reads or cancels a non-ok body (I7)", (t) => {
  const findings = {};
  let callers = 0;
  for (const file of sources().filter((f) => /\.[cm]?[jt]sx?$/.test(f))) {
    const result = gatedFetchBodies(read(file), file, INJECTED_GATED_FETCH[file] ?? []);
    callers += result.calls.length;
    if (result.findings.length) findings[file] = result.findings;
  }
  assert.deepEqual(findings, {});
  assert.ok(callers >= 15, `gated-fetch callers found: ${callers}`);
  t.diagnostic(`gated-fetch response sites checked: ${callers}`);
  for (const [file, names] of Object.entries(INJECTED_GATED_FETCH))
    assert.ok(gatedFetchBodies(read(file), file, names).calls.length > 0, `${file} still calls it`);
  // The injections are what the table says, and gatedNodeFetch has no other consumer.
  const ipc = read("src/helpers/ipcHandlers.js");
  assert.ok(gatedFetchBodies(ipc, "ipcHandlers.js").aliases.includes("proxyFetch"));
  assert.match(ipc, /probeSelfHosted\(\s*baseUrl,\s*gatedNodeFetch\("providerCheck"/);
  const nodeFetchUses = sources()
    .filter((f) => /\.[cm]?[jt]sx?$/.test(f) && f !== "src/helpers/privacy/gatedFetch.js")
    .flatMap((f) => [...read(f).matchAll(/\bgatedNodeFetch\(/g)].map(() => f));
  assert.deepEqual(nodeFetchUses, ["src/helpers/ipcHandlers.js"]);
});
