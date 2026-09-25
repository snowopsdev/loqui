#!/usr/bin/env node
/**
 * Account-free/offline desktop smoke. Requires a built renderer and native
 * modules rebuilt for the installed Electron version. No models are downloaded.
 * Run: node scripts/smoke-electron.cjs [--keep-profile] [--output-dir DIR]
 * The same file is the Electron bootstrap so network auditing starts BEFORE main.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const repoRoot = path.resolve(__dirname, "..");

function bootstrapElectron() {
  const electron = require("electron");
  const sandbox = process.env.LOQUI_SMOKE_SANDBOX;
  if (!sandbox || !process.env.LOQUI_PROFILE_DIR)
    throw new Error("Smoke bootstrap requires its temporary sandbox.");
  // Keep caches, CLI discovery and home-relative state out of the real profile.
  // Do not redirect a model cache alone: its migration could move existing models.
  const temporaryHome = path.join(sandbox, "home");
  fs.mkdirSync(temporaryHome, { recursive: true });
  os.homedir = () => temporaryHome;
  electron.app.setPath("home", temporaryHome);
  electron.app.setAppPath(repoRoot);
  electron.app.getVersion = () => require(path.join(repoRoot, "package.json")).version;
  // Startup errors should fail automation instead of waiting on a native modal.
  electron.dialog.showErrorBox = (title, content) => {
    const error = `${title}\n${content}`;
    fs.writeFileSync(path.join(sandbox, "startup-error.txt"), error);
    console.error(error);
    electron.app.exit(1);
  };
  const audit = (globalThis.__whisprSmoke = {
    offline: process.env.LOQUI_SMOKE_OFFLINE === "1",
    phase: process.env.LOQUI_SMOKE_OFFLINE === "1" ? "offline-restart" : "setup",
    requests: [],
  });
  function inspect(input, transport, protocol = "https:") {
    let url;
    try {
      if (typeof input === "string" || input instanceof URL) url = new URL(input);
      else if (input?.url) url = new URL(input.url);
      else {
        const host = input?.hostname || input?.host || "localhost";
        url = new URL(`${input?.protocol || protocol}//${host}${input?.path || "/"}`);
      }
    } catch {
      return false;
    }
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return false;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const hosted =
      /(^|\.)openwhispr\.com$/i.test(url.hostname) ||
      (url.hostname === "github.com" && /^\/OpenWhispr\/openwhispr\/releases/i.test(url.pathname));
    const blocked = hosted || (audit.offline && !local);
    audit.requests.push({
      transport,
      phase: audit.phase,
      url: `${url.origin}${url.pathname}`,
      local,
      hosted,
      blocked,
    });
    return blocked;
  }
  const offlineError = () =>
    Object.assign(new Error("External network disabled by desktop smoke test"), {
      code: "ENETUNREACH",
    });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (input, ...rest) {
    if (inspect(input, "node-fetch")) return Promise.reject(offlineError());
    return originalFetch.call(this, input, ...rest);
  };
  for (const protocol of ["http", "https"]) {
    const client = require(`node:${protocol}`);
    for (const method of ["request", "get"]) {
      const original = client[method];
      client[method] = function (input, ...rest) {
        if (inspect(input, `node-${protocol}-${method}`, `${protocol}:`)) throw offlineError();
        return original.call(this, input, ...rest);
      };
    }
  }
  const instrumented = new WeakSet();
  function watchSession(session) {
    if (instrumented.has(session)) return;
    instrumented.add(session);
    session.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: inspect(details.url, "electron-session") })
    );
  }
  electron.app.on("session-created", watchSession);
  electron.app.whenReady().then(() => watchSession(electron.session.defaultSession));
  require(path.join(repoRoot, "main.js"));
}

async function smoke() {
  const { _electron } = require("playwright");
  const translation = require("../src/locales/en/translation.json");
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: node scripts/smoke-electron.cjs [--keep-profile] [--output-dir DIR]");
    return;
  }
  const outputIndex = args.indexOf("--output-dir");
  if (outputIndex !== -1 && !args[outputIndex + 1])
    throw new Error("--output-dir requires a directory");
  const output =
    outputIndex === -1
      ? fs.mkdtempSync(path.join(os.tmpdir(), "loqui-snowopsdev-smoke-"))
      : path.resolve(args[outputIndex + 1]);
  fs.mkdirSync(output, { recursive: true });
  const sandbox = fs.mkdtempSync(path.join(output, "sandbox-"));
  const profile = path.join(sandbox, "profile");
  fs.mkdirSync(profile);
  const token = `smoke${Date.now().toString(36)}`;
  const report = {
    output,
    profile,
    token,
    passed: [],
    network: [],
    rendererErrors: [],
    limitations: [
      "Speech recognition/model inference is not exercised; no models are downloaded.",
      "Meeting records use fixture transcripts; microphone/system audio, native hotkeys, and automatic paste require hardware verification.",
      "Network guards cover renderer/Electron sessions and main-process fetch/http/https; this test does not start provider CLI subprocesses.",
    ],
  };
  const logs = [];
  let app;
  const verify = (name, condition) => {
    assert.ok(condition, name);
    report.passed.push(name);
    console.log(`PASS ${name}`);
  };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function bounded(operation, timeout, message) {
    let timer;
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function waitFor(read, predicate, message, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await read();
      if (predicate(value)) return value;
      await pause(100);
    }
    throw new Error(`Timed out: ${message}`);
  }
  async function launch(offline) {
    const env = {
      ...process.env,
      NODE_ENV: "test",
      LOQUI_PROFILE_DIR: profile,
      LOQUI_SMOKE_SANDBOX: sandbox,
      LOQUI_SMOKE_OFFLINE: offline ? "1" : "0",
      LOQUI_CACHE_ROOT: path.join(sandbox, "cache"),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const chromiumArgs = ["--lang=en-US"];
    if (process.platform === "linux") chromiumArgs.push("--ozone-platform=x11");
    app = await _electron.launch({
      executablePath: require("electron"),
      args: [...chromiumArgs, __filename],
      cwd: repoRoot,
      env,
      timeout: 45000,
    });
    app.process().stderr.on("data", (chunk) => logs.push(String(chunk)));
    app.process().stdout.on("data", (chunk) => logs.push(String(chunk)));
    // Loqui's save/restore path depends on these legacy clipboard methods.
    // Check the runtime contract without reading or modifying the user's clipboard.
    const missingClipboardMethods = await app.evaluate(({ clipboard }) =>
      [
        "availableFormats",
        "readText",
        "writeText",
        "readHTML",
        "readRTF",
        "readImage",
        "writeImage",
        "write",
      ].filter((method) => typeof clipboard[method] !== "function")
    );
    verify(
      `clipboard save/restore APIs are available${missingClipboardMethods.length ? ` (missing: ${missingClipboardMethods.join(", ")})` : ""}`,
      missingClipboardMethods.length === 0
    );
    const seen = new WeakSet();
    function capture(page) {
      if (seen.has(page)) return;
      seen.add(page);
      page.on("pageerror", (error) =>
        report.rendererErrors.push({ page: page.url(), error: error.message })
      );
    }
    app.on("window", capture);
    app.windows().forEach(capture);
    const panel = await waitFor(
      () => Promise.resolve(app.windows().find((page) => /[?&]panel=true(?:&|$)/.test(page.url()))),
      Boolean,
      "control panel page"
    );
    await panel.waitForLoadState("domcontentloaded");
    await panel.waitForFunction(() => !!window.electronAPI?.getSpaces);
    await panel.bringToFront();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes("panel=true")
      );
      window?.setBounds({ width: 1000, height: 760 });
    });
    const actualProfile = await app.evaluate(({ app }) => app.getPath("userData"));
    verify("temporary profile is active", actualProfile === profile);
    return panel;
  }
  async function close() {
    if (!app) return;
    const closingApp = app;
    app = null;
    try {
      report.network.push(
        ...(await bounded(
          closingApp.evaluate(() => globalThis.__whisprSmoke.requests),
          5000,
          "Timed out collecting network audit"
        ))
      );
      await bounded(closingApp.close(), 10000, "Timed out closing smoke application");
    } catch (error) {
      closingApp.process().kill("SIGKILL");
      throw error;
    }
  }
  try {
    assert.ok(
      fs.existsSync(path.join(repoRoot, "src/dist/index.html")),
      "Run npm run build:renderer first"
    );
    let panel = await launch(false);
    await panel
      .getByRole("heading", { name: "A quieter way to get words out.", exact: true })
      .waitFor();
    verify(
      "fresh launch offers device setup without an account",
      (await panel.getByText("Loqui setup", { exact: true }).count()) === 1
    );
    await panel.screenshot({ path: path.join(output, "first-launch.png") });
    await panel
      .locator("footer")
      .getByRole("button", { name: "Set up dictation", exact: true })
      .click();
    await panel
      .getByRole("heading", { name: "Choose the voice you use most.", exact: true })
      .waitFor();
    verify(
      "speech setup keeps the local model download user initiated",
      await panel.getByRole("button", { name: "Download model", exact: true }).isVisible()
    );
    await panel.locator("footer").getByRole("button", { name: "Continue", exact: true }).click();
    await panel
      .getByRole("heading", { name: "Make the transcript easier to read.", exact: true })
      .waitFor();
    verify(
      "cleanup remains optional and exposes ChatGPT subscription access",
      await panel.getByText("ChatGPT subscription", { exact: true }).isVisible()
    );
    await panel
      .locator("footer")
      .getByRole("button", { name: "Explore first", exact: true })
      .click();
    await panel
      .locator("nav")
      .getByRole("button", { name: translation.sidebar.home, exact: true })
      .waitFor();
    verify(
      "onboarding finishes without authentication",
      (await panel.evaluate(() => localStorage.getItem("onboardingCompleted"))) === "true"
    );
    verify(
      "setup does not start model downloads",
      (await panel.evaluate(() => window.electronAPI.modelGetActiveDownloads())).length === 0
    );
    await app.evaluate(() => {
      globalThis.__whisprSmoke.offline = true;
      globalThis.__whisprSmoke.phase = "offline-write";
    });
    const fixture = await panel.evaluate(async (token) => {
      const api = window.electronAPI;
      const spaces = await api.getSpaces();
      if (spaces.length !== 1 || spaces[0].kind !== "private")
        throw new Error("Expected one local workspace");
      const folder = await api.createFolder(`Folder ${token}`, spaces[0].id);
      if (!folder.success) throw new Error(folder.error);
      const note = await api.saveNote(
        `Note ${token}`,
        `Original local body ${token}`,
        "personal",
        null,
        null,
        folder.folder.id,
        spaces[0].id
      );
      if (!note.success) throw new Error(note.error);
      const edited = await api.updateNote(note.note.id, {
        content: `Edited offline body ${token}`,
      });
      if (!edited.success) throw new Error(edited.error);
      const meeting = await api.saveNote(
        `Meeting ${token}`,
        "Offline meeting summary",
        "meeting",
        null,
        12,
        folder.folder.id,
        spaces[0].id
      );
      if (!meeting.success) throw new Error(meeting.error);
      await api.updateNote(meeting.note.id, {
        transcript: `Speaker 1: Meeting transcript ${token}`,
        enhanced_content: "Meeting decisions survive restart.",
      });
      const conversation = await api.createAgentConversation(`Conversation ${token}`);
      await api.addAgentMessage(conversation.id, "user", `Offline question ${token}`);
      await api.addAgentMessage(conversation.id, "assistant", `Saved reply ${token}`);
      const history = await api.saveTranscription(`Dictation ${token}`, `Raw dictation ${token}`, {
        routeKind: "dictation",
      });
      if (!history.success) throw new Error("Could not save transcription history");
      await api.setDictionary([token]);
      await api.setSnippets([
        { id: `snippet-${token}`, trigger: token, replacement: "Offline snippet" },
      ]);
      return {
        note: note.note.id,
        folder: folder.folder.id,
        meeting: meeting.note.id,
        conversation: conversation.id,
        history: history.id ?? history.transcription?.id,
      };
    }, token);
    report.fixture = fixture;
    verify(
      "local notes, meeting, conversation, history, dictionary and snippet written offline",
      !!fixture.note && !!fixture.meeting && !!fixture.conversation
    );
    await panel.evaluate((id) => window.electronAPI.agentOpenNote(id), fixture.note);
    // Notes have a separate optional introduction. Complete it through its UI.
    const notesIntro = panel.getByRole("button", {
      name: translation.notes.onboarding.getStarted,
      exact: true,
    });
    await notesIntro.waitFor();
    await notesIntro.click();
    const title = panel.getByLabel(translation.notes.editor.noteTitle, { exact: true });
    await title.waitFor();
    await title.fill(`Edited note ${token}`);
    await title.press("Tab");
    await waitFor(
      () => panel.evaluate((id) => window.electronAPI.getNote(id), fixture.note),
      (note) => note.title === `Edited note ${token}`,
      "edited title autosaves"
    );
    verify("note title editing saves through the renderer", true);
    await panel.screenshot({ path: path.join(output, "edited-note.png") });
    await close();

    panel = await launch(true);
    await panel
      .locator("nav")
      .getByRole("button", { name: translation.sidebar.home, exact: true })
      .waitFor();
    verify(
      "offline restart skips completed setup",
      (await panel.getByText(translation.personal.onboarding, { exact: true }).count()) === 0
    );
    const restored = await panel.evaluate(
      async ({ fixture, token }) => {
        const api = window.electronAPI;
        return {
          note: await api.getNote(fixture.note),
          meeting: await api.getNote(fixture.meeting),
          messages: await api.getAgentMessages(fixture.conversation),
          history: await api.getTranscriptions(),
          dictionary: await api.getDictionary(),
          snippets: await api.getSnippets(),
          search: await api.searchNotes(token, 20),
          semantic: await api.semanticSearchNotes(token, 20),
          downloads: await api.modelGetActiveDownloads(),
        };
      },
      { fixture, token }
    );
    verify(
      "note edits persist across an offline restart",
      restored.note.title === `Edited note ${token}` &&
        restored.note.content === `Edited offline body ${token}`
    );
    verify(
      "meeting transcript and summary persist",
      restored.meeting.transcript.includes(token) &&
        restored.meeting.enhanced_content.includes("survive restart")
    );
    verify(
      "conversation messages persist",
      restored.messages.length === 2 && restored.messages[1].content === `Saved reply ${token}`
    );
    verify(
      "dictation history persists",
      restored.history.some((item) => item.text === `Dictation ${token}`)
    );
    verify(
      "dictionary and snippets persist",
      restored.dictionary.includes(token) &&
        restored.snippets.some((item) => item.trigger === token)
    );
    verify(
      "local keyword search finds the saved note",
      restored.search.some((item) => item.id === fixture.note)
    );
    verify(
      "semantic search falls back locally without a downloaded embedding model",
      restored.semantic.some((item) => item.id === fixture.note)
    );
    verify("restart does not trigger model downloads", restored.downloads.length === 0);
    await panel.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await panel
      .getByPlaceholder(translation.commandSearch.placeholder, { exact: true })
      .fill(token);
    await panel.getByRole("dialog").getByText(`Edited note ${token}`, { exact: true }).waitFor();
    verify("search results render in the offline desktop UI", true);
    await panel.screenshot({ path: path.join(output, "offline-search.png") });
    await close();
    verify(
      "no OpenWhispr service or release-feed requests",
      report.network.every((request) => !request.hosted)
    );
    verify(
      "all non-local HTTP requests were blocked during offline phases",
      report.network
        .filter((request) => request.phase.startsWith("offline") && !request.local)
        .every((request) => request.blocked)
    );
    verify("no renderer exceptions", report.rendererErrors.length === 0);
    report.success = true;
  } catch (error) {
    report.success = false;
    report.error = error.stack || String(error);
    try {
      if (app)
        await app
          .windows()
          .find((page) => page.url().includes("panel=true"))
          ?.screenshot({ path: path.join(output, "failure.png") });
    } catch {}
    throw error;
  } finally {
    try {
      await close();
    } catch (error) {
      logs.push(`Close failed: ${error.message}`);
    }
    const startupError = path.join(sandbox, "startup-error.txt");
    if (fs.existsSync(startupError)) report.startupError = fs.readFileSync(startupError, "utf8");
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, "electron.log"), logs.join(""));
    if (!args.includes("--keep-profile")) fs.rmSync(sandbox, { recursive: true, force: true });
    console.log(`Smoke artifacts: ${output}`);
  }
}

if (process.versions.electron) bootstrapElectron();
else
  smoke().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
