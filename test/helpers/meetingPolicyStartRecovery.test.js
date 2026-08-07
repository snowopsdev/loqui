const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

function loadMeetingDetectionEngine() {
  const originalLoad = Module._load;
  Module._load = function loadWithMeetingMocks(request, parent, isMain) {
    if (request === "electron") {
      return { shell: { openExternal: async () => {} } };
    }
    if (request === "./windowBroadcast") {
      return { broadcastToWindows() {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const modulePath = require.resolve("../../src/helpers/meetingDetectionEngine");
    delete require.cache[modulePath];
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("a policy-rejected automatic meeting start restores manager mode before clearing", async (t) => {
  const MeetingDetectionEngine = loadMeetingDetectionEngine();
  const reminderScheduler = { getActiveMeetingState: () => ({}) };
  const processDetector = new EventEmitter();
  const audioDetector = Object.assign(new EventEmitter(), {
    resetPrompt() {},
    setUserRecording() {},
  });
  let navigationRequest = null;
  const windowManager = {
    notificationPrefs: {},
    queueMeetingNoteNavigation: async (request) => {
      navigationRequest = request;
    },
  };
  const databaseManager = {
    getActiveEvents: () => [],
    saveNote: () => ({ note: { id: 41, title: "New note" } }),
    getMeetingsFolder: () => ({ id: 7 }),
  };
  const engine = new MeetingDetectionEngine(
    reminderScheduler,
    processDetector,
    audioDetector,
    windowManager,
    databaseManager
  );

  await engine.startManualMeeting();
  assert.equal(engine._meetingModeActive, true);
  assert.deepEqual(
    { noteId: navigationRequest.noteId, folderId: navigationRequest.folderId },
    { noteId: 41, folderId: 7 }
  );

  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  globalThis.localStorage = storage;
  globalThis.window = {
    innerWidth: 1200,
    localStorage: storage,
    addEventListener() {},
    electronAPI: {},
  };

  const { createServer } = await import("vite");
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-meeting-policy-test-"));
  const vite = await createServer({
    root: path.resolve(__dirname, "../../src"),
    cacheDir,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
    plugins: [
      {
        name: "meeting-policy-test-app-version",
        enforce: "pre",
        resolveId(source) {
          return source.endsWith("/helpers/appVersion.js") ? "\0meeting-policy-app-version" : null;
        },
        load(id) {
          if (id !== "\0meeting-policy-app-version") return null;
          return `
            export function parseCanonicalAppVersion(value) {
              const match = typeof value === "string" ? /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/.exec(value) : null;
              return match ? match.slice(1).map(Number) : null;
            }
            export function isCanonicalAppVersion(value) {
              return parseCanonicalAppVersion(value) !== null;
            }
          `;
        },
      },
    ],
  });
  t.after(async () => {
    await vite.close();
    fs.rmSync(cacheDir, { recursive: true, force: true });
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  });

  const { handleMeetingRecordingRequest } = await vite.ssrLoadModule(
    "/helpers/meetingRecordingRequest.ts"
  );
  const { startRecording, useMeetingRecordingStore } = await vite.ssrLoadModule(
    "/stores/meetingRecordingStore.ts"
  );
  const { usePolicyStore } = await vite.ssrLoadModule("/stores/policyStore.ts");
  usePolicyStore.setState({
    status: "managed",
    appVersion: "1.8.1",
    policy: {
      version: 1,
      transcription: { allowedModes: [], allowedByokProviders: [] },
      llm: {
        allowedModes: ["openwhispr"],
        allowedByokProviders: [],
        allowedEnterpriseProviders: [],
      },
      features: { agentEnabled: false, webSearchEnabled: false },
      sharing: { externalLinkSharing: "disabled" },
      dataRetention: {
        audioRetentionMaxDays: null,
        localHistoryMode: "user_choice",
        cloudBackupAllowed: false,
      },
      minAppVersion: null,
    },
  });

  const lifecycle = [];
  await handleMeetingRecordingRequest({
    args: {
      noteId: navigationRequest.noteId,
      noteTitle: "New note",
      folderId: navigationRequest.folderId,
    },
    startRecording,
    restoreFromMeetingMode: async () => {
      lifecycle.push("restored");
      engine.setMeetingModeActive(false);
    },
    onHandled: () => lifecycle.push("handled"),
  });

  assert.equal(engine._meetingModeActive, false);
  assert.deepEqual(lifecycle, ["restored", "handled"]);
  assert.equal(
    useMeetingRecordingStore.getState().error,
    "policyRestricted",
    "the store must hold the sentinel key so the mount can localize it"
  );

  const rejectionLifecycle = [];
  await assert.rejects(
    handleMeetingRecordingRequest({
      args: { noteId: 42, noteTitle: "New note", folderId: null },
      startRecording: async () => {
        throw new Error("start failed");
      },
      restoreFromMeetingMode: () => rejectionLifecycle.push("restored"),
      onHandled: () => rejectionLifecycle.push("handled"),
    }),
    /start failed/,
    "a failed start must still propagate its error"
  );
  assert.deepEqual(
    rejectionLifecycle,
    ["handled"],
    "a failed start must still clear the pending request so it is not re-attempted"
  );
});
