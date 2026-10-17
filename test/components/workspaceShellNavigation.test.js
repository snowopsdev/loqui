const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");
const { deferred } = require("../helpers/harness/deferred");

const fixtureNote = (id) => ({
  id,
  title: `Fixture ${id}`,
  content: "",
  space_id: 1,
  folder_id: 2,
});
const emptyComponent = "export default function Fixture() { return null; }";

function find(node, predicate) {
  if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}

async function mount(
  t,
  { initialStorage = {}, api = {}, strict = false, realCreateNote = false } = {}
) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const listeners = new Map();
  const { storage } = installBrowserGlobals(t, {
    initialStorage: { semanticReindexVersion: "999", ...initialStorage },
    window: {
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
      },
      electronAPI: {
        getPlatform: () => "darwin",
        getNote: async (id) => fixtureNote(id),
        getNotes: async () => [],
        getSpaces: async () => [],
        getFolders: async () => [],
        getFolderNoteCounts: async () => [],
        ...api,
      },
    },
  });
  const container = installHookDom(t);
  let dialogOpen = false;
  globalThis.document.querySelector = () => (dialogOpen ? {} : null);
  const mockModules = {
    "/stores/settingsStore":
      'import { create } from "zustand"; export const useSettingsStore = create(() => ({})); export const getSettings = () => ({});',
    "/stores/transcriptionStore":
      "const history = []; export const useTranscriptions = () => history; export const useShowDiscarded = () => false; export const initializeTranscriptions = async () => {}; export const updateTranscription = () => {}; export const removeTranscription = () => {}; export const clearTranscriptions = () => {};",
    "/stores/meetingRecordingStore": `import { create } from "zustand"; export const useIsMeetingMode = () => false; export const useIsNarrowWindow = () => false;
       export const useMeetingRecordingStore = create(() => ({ isRecording: false, recordingNoteId: null, recordingFolderId: null, micCaptureStatus: "inactive" }));
       export const starts = []; let activation = Promise.resolve(true); export const setActivation = (value) => { activation = value; };
       export const startRecording = async (args) => { starts.push(args); await activation; useMeetingRecordingStore.setState({ isRecording: true, recordingNoteId: args.noteId, recordingFolderId: args.folderId }); return true; }; export const stopRecording = async () => {};`,
    "/hooks/useHotkey": 'export const useHotkey = () => ({ hotkey: "test" });',
    "/hooks/useSettings": "export const useSettings = () => ({});",
    "/hooks/useGpuBannerAvailability": "export const useGpuBannerAvailability = () => ({});",
    "/hooks/useCollapsibleSidebar":
      "export let toggles = 0; const toggle = () => toggles++; export const useCollapsibleSidebar = () => ({ mode: 'expanded', toggle });",
    "/hooks/useDialogs":
      "const noop = () => {}; const dialog = { open: false }; const value = { confirmDialog: dialog, alertDialog: dialog, showConfirmDialog: noop, showAlertDialog: noop, hideConfirmDialog: noop, hideAlertDialog: noop }; export const useDialogs = () => value;",
    "/hooks/useCreateNote":
      "export let creates = 0; const createNote = async () => { creates++; }; export const useCreateNote = () => ({ createNote });",
    "/ui/useToast":
      "export const toasts = []; const toast = (value) => toasts.push(value); const value = { toast }; export const useToast = () => value;",
  };
  for (const name of [
    "ControlPanelSidebar",
    "ControlPanelTopBar",
    "MeetingRecordingMount",
    "HistoryView",
    "FinishDictationSetupCard",
    "SettingsModal",
    "InsightsView",
    "DictionaryView",
    "IntegrationsView",
    "CommandSearch",
    "notes/PersonalNotesView",
    "notes/MeetingRecordingPill",
    "CaptureControl",
    "notes/BackgroundActionToastListener",
    "notes/UploadAudioView",
    "chat/ChatView",
  ]) {
    mockModules[`/${name}`] = emptyComponent;
  }
  if (realCreateNote) delete mockModules["/hooks/useCreateNote"];
  const options = withI18nMock({ mockModules });
  // The production hook returns a stable t; avoid the generic mock's per-render function.
  options.mockModules["react-i18next"] =
    "const t = (key) => key; export const useTranslation = () => ({ t });";
  const vite = await createRendererServer(t, options);
  const { default: ControlPanel } = await vite.ssrLoadModule("/components/ControlPanel.tsx");
  const notes = await vite.ssrLoadModule("/stores/noteStore.ts");
  const home = await vite.ssrLoadModule("/stores/homeViewStore.ts");
  let tree;
  function Probe() {
    tree = ControlPanel();
    return null;
  }
  root = createRoot(container);
  await React.act(async () =>
    root.render(
      strict
        ? React.createElement(React.StrictMode, null, React.createElement(Probe))
        : React.createElement(Probe)
    )
  );
  return {
    notes,
    home,
    meeting: await vite.ssrLoadModule("/stores/meetingRecordingStore"),
    setDialogOpen: (open) => {
      dialogOpen = open;
    },
    keydown: async (over) => {
      let prevented = false;
      const event = {
        key: "",
        code: "",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault() {
          prevented = true;
        },
        ...over,
      };
      await React.act(async () => {
        for (const fn of listeners.get("keydown") ?? []) fn(event);
      });
      return prevented;
    },
    listenerCount: () => listeners.get("keydown")?.size,
    sidebar: await vite.ssrLoadModule("/hooks/useCollapsibleSidebar"),
    creates: await vite.ssrLoadModule("/hooks/useCreateNote"),
    storage,
    navigation: () => tree.props.value,
    chat: () => find(tree, (node) => typeof node.props?.onRequestHandled === "function")?.props,
    palette: () => find(tree, (node) => !!node.props?.onConversationSelect).props,
    view: () => find(tree, (node) => !!node.props?.onViewChange).props.activeView,
    toasts: (await vite.ssrLoadModule("/components/ui/useToast")).toasts,
  };
}

test("shell waits for saved-note restore before persisting, including StrictMode replay", async (t) => {
  const fetch = deferred();
  let reads = 0;
  const h = await mount(t, {
    strict: true,
    initialStorage: { "workspace.activeView": "personal-notes", "workspace.lastNoteId": "999" },
    api: {
      getNote: () => {
        reads++;
        return fetch.promise;
      },
    },
  });
  assert.equal(h.storage.getItem("workspace.lastNoteId"), "999");
  assert.equal(reads, 1);
  await React.act(async () => fetch.resolve(fixtureNote(999)));
  assert.equal(h.notes.getActiveNoteIdValue(), 999);
  assert.equal(h.view(), "personal-notes");
  assert.equal(h.storage.getItem("workspace.lastNoteId"), "999");
});

test("native pending selection supersedes saved-note restore and is persisted", async (t) => {
  const fetch = deferred();
  const h = await mount(t, {
    initialStorage: { "workspace.activeView": "personal-notes", "workspace.lastNoteId": "999" },
    api: {
      getNote: () => fetch.promise,
      getPendingNoteNavigation: async () => ({ noteId: 5, folderId: 2 }),
    },
  });
  assert.equal(h.notes.getActiveNoteIdValue(), 5);
  await React.act(async () => fetch.resolve(fixtureNote(999)));
  assert.equal(h.notes.getNoteFromStore(999), null);
  assert.equal(h.storage.getItem("workspace.lastNoteId"), "5");
});

test("a newer view intent fences palette fetch while retaining the existing selection", async (t) => {
  const fetch = deferred();
  const h = await mount(t, {
    api: { getNote: (id) => (id === 999 ? fetch.promise : Promise.resolve(fixtureNote(id))) },
  });
  await React.act(async () => h.navigation().openNote(7));
  await React.act(async () => h.palette().onNoteSelect(999));
  await React.act(async () => h.navigation().openView("insights"));
  await React.act(async () => fetch.resolve(fixtureNote(999)));
  assert.equal(h.notes.getActiveNoteIdValue(), 7);
  assert.equal(h.notes.getNoteFromStore(999), null);
  assert.equal(h.view(), "insights");
  assert.equal(h.storage.getItem("workspace.activeView"), "insights");
  assert.deepEqual(h.toasts, []);
});

test("palette transcript focus resets Home filters and missing notes show the localized notice", async (t) => {
  const h = await mount(t, { api: { getNote: async () => null } });
  h.home.setHomeQuery("hidden");
  h.home.setHomeFilter("failed");
  await React.act(async () => h.palette().onTranscriptSelect(311));
  assert.equal(h.home.useHomeViewStore.getState().focusTranscriptId, 311);
  assert.equal(h.home.useHomeViewStore.getState().filter, "all");
  assert.equal(h.home.useHomeViewStore.getState().query, "");
  await React.act(async () => h.palette().onNoteSelect(404));
  assert.deepEqual(h.toasts, [{ title: "workspace.noteMissing" }]);
});

test("chat request seed types preserve queue reset versus focus semantics without sending", async () => {
  const { seedForRequest } = await import("../../src/components/chat/chatRequest.ts");
  assert.deepEqual(seedForRequest({ kind: "new", nonce: 1, draft: "Draft only" }), {
    nonce: 1,
    text: "Draft only",
    resetQueue: true,
  });
  assert.deepEqual(seedForRequest({ kind: "open", nonce: 2, conversationId: 7 }), {
    nonce: 2,
    resetQueue: true,
  });
  assert.deepEqual(seedForRequest({ kind: "focus", nonce: 3 }), { nonce: 3, resetQueue: false });
});

test("shell delivers each chat request and clears it before leaving and returning", async (t) => {
  const h = await mount(t);
  await React.act(async () => h.navigation().startChat({ draft: "Only a draft" }));
  assert.equal(h.view(), "chat");
  assert.deepEqual(h.chat().request, { kind: "new", draft: "Only a draft", nonce: 1 });
  assert.equal(h.chat().onOpenSettings, h.navigation().openSettings);
  await React.act(async () => h.chat().onRequestHandled());
  assert.equal(h.chat().request, null);
  await React.act(async () => h.navigation().openView("home"));
  await React.act(async () => h.navigation().openView("chat"));
  assert.equal(h.chat().request, null, "a handled request cannot replay on remount");
  await React.act(async () => h.navigation().openConversation(7));
  assert.deepEqual(h.chat().request, { kind: "open", conversationId: 7, nonce: 2 });
  await React.act(async () => h.chat().onRequestHandled());
  await React.act(async () => h.navigation().focusAssistant());
  assert.deepEqual(h.chat().request, { kind: "focus", nonce: 3 });
});

test("the single global shortcut listener delivers fresh chat requests and blocks dialogs and IME", async (t) => {
  const fetch = deferred();
  const h = await mount(t, { api: { getNote: () => fetch.promise } });
  await React.act(async () => h.navigation().openNote(99));
  assert.equal(h.listenerCount(), 1);
  assert.equal(await h.keydown({ key: "3", code: "Digit3" }), true);
  await React.act(async () => fetch.resolve(fixtureNote(99)));
  assert.equal(h.view(), "chat");
  assert.equal(h.notes.getNoteFromStore(99), null, "shortcut retains the Task3 navigation fence");
  assert.equal(await h.keydown({ key: "N", code: "KeyN", shiftKey: true }), true);
  assert.deepEqual(h.chat().request, { kind: "new", draft: undefined, nonce: 1 });
  await React.act(async () => h.chat().onRequestHandled());
  assert.equal(await h.keydown({ key: "/", code: "Slash" }), true);
  assert.deepEqual(h.chat().request, { kind: "focus", nonce: 2 });
  assert.equal(h.listenerCount(), 1, "state changes do not add listeners");
  h.setDialogOpen(true);
  assert.equal(await h.keydown({ key: "1", code: "Digit1" }), false);
  assert.equal(h.view(), "chat");
  h.setDialogOpen(false);
  assert.equal(await h.keydown({ key: "1", code: "Digit1", isComposing: true }), false);
  assert.equal(await h.keydown({ key: "1", code: "Digit1", defaultPrevented: true }), false);
  assert.equal(await h.keydown({ key: "\\", code: "Backslash" }), true);
  assert.equal(h.sidebar.toggles, 1);
  assert.equal(await h.keydown({ key: "n", code: "KeyN" }), true);
  assert.equal(h.creates.creates, 1, "Cmd+N creates a note even from Chat");
  assert.equal(await h.keydown({ key: "U", code: "KeyU", shiftKey: true }), true);
  assert.equal(h.view(), "upload");
});

test("real shell Record meeting admits one create/start through deferred save and activation, then reopens the live note", async (t) => {
  const save = deferred();
  const activation = deferred();
  let saves = 0;
  let subscriptions = 0;
  let microphoneChecks = 0;
  const h = await mount(t, {
    realCreateNote: true,
    api: {
      saveNote: () => {
        saves++;
        return saves === 1
          ? save.promise
          : Promise.resolve({ success: true, note: fixtureNote(20) });
      },
      onDictationLifecycleChanged: () => {
        subscriptions++;
        return () => {};
      },
      checkMicrophoneAccess: async () => {
        microphoneChecks++;
        return { granted: true };
      },
    },
  });
  h.meeting.setActivation(activation.promise);
  const retainedRecordMeeting = h.navigation().recordMeeting;
  await React.act(async () => {
    h.navigation().recordMeeting();
    h.navigation().recordMeeting();
  });
  assert.equal(saves, 1);
  await React.act(async () => save.resolve({ success: true, note: fixtureNote(19) }));
  assert.equal(h.meeting.starts.length, 1);
  await React.act(async () => h.navigation().recordMeeting());
  assert.equal(saves, 1, "startup retains create admission");
  await React.act(async () => h.navigation().newNote());
  assert.equal(saves, 2, "plain note bypasses recording admission");
  assert.equal(h.meeting.starts.length, 1, "plain note never starts capture");
  assert.equal(h.notes.getActiveNoteIdValue(), 20);
  await React.act(async () => activation.resolve(true));
  assert.equal(h.notes.getActiveNoteIdValue(), 20, "startup leaves the newer plain note selected");
  await React.act(async () => h.navigation().openNote(27));
  await React.act(async () => h.navigation().openView("home"));
  await React.act(async () => retainedRecordMeeting());
  assert.equal(h.notes.getActiveNoteIdValue(), 19);
  assert.equal(h.notes.getActiveFolderIdValue(), 2);
  assert.equal(h.view(), "personal-notes");
  assert.equal(saves, 2);
  assert.equal(h.meeting.starts.length, 1);
  assert.equal(subscriptions, 1, "one shared capture lifecycle subscription");
  assert.equal(microphoneChecks, 1, "one shared capture permission check");
});

test("real shell shortcuts distinguish plain New note from Record meeting", async (t) => {
  let saves = 0;
  const h = await mount(t, {
    realCreateNote: true,
    api: { saveNote: async () => ({ success: true, note: fixtureNote(++saves) }) },
  });
  await h.keydown({ key: "n", code: "KeyN" });
  assert.equal(saves, 1);
  assert.equal(h.meeting.starts.length, 0);
  await h.keydown({ key: "M", code: "KeyM", shiftKey: true });
  assert.equal(saves, 2);
  assert.equal(h.meeting.starts.length, 1);
  assert.equal(h.meeting.starts[0].noteId, 2);
});

test("recording startup does not delay opening the created note or reclaim a newer view", async (t) => {
  const activation = deferred();
  const h = await mount(t, {
    realCreateNote: true,
    api: { saveNote: async () => ({ success: true, note: fixtureNote(18) }) },
  });
  h.meeting.setActivation(activation.promise);
  await React.act(async () => h.navigation().recordMeeting());
  assert.equal(h.view(), "personal-notes", "creation opens before async audio startup finishes");
  await React.act(async () => h.navigation().openView("insights"));
  await React.act(async () => activation.resolve(true));
  assert.equal(h.view(), "insights", "startup completion does not navigate again");
});
