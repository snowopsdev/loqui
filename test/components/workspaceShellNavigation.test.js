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

async function mount(t, { initialStorage = {}, api = {}, strict = false } = {}) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const { storage } = installBrowserGlobals(t, {
    initialStorage: { semanticReindexVersion: "999", ...initialStorage },
    window: {
      electronAPI: {
        getNote: async (id) => fixtureNote(id),
        getNotes: async () => [],
        ...api,
      },
    },
  });
  const container = installHookDom(t);
  const mockModules = {
    "/stores/settingsStore":
      'import { create } from "zustand"; export const useSettingsStore = create(() => ({})); export const getSettings = () => ({});',
    "/stores/transcriptionStore":
      "const history = []; export const useTranscriptions = () => history; export const useShowDiscarded = () => false; export const initializeTranscriptions = async () => {}; export const updateTranscription = () => {}; export const removeTranscription = () => {}; export const clearTranscriptions = () => {};",
    "/stores/meetingRecordingStore":
      "export const useIsMeetingMode = () => false; export const useIsNarrowWindow = () => false; export const useMeetingRecordingStore = (select) => select({});",
    "/hooks/useHotkey": 'export const useHotkey = () => ({ hotkey: "test" });',
    "/hooks/useSettings": "export const useSettings = () => ({});",
    "/hooks/useGpuBannerAvailability": "export const useGpuBannerAvailability = () => ({});",
    "/hooks/useCollapsibleSidebar": "export const useCollapsibleSidebar = () => ({});",
    "/hooks/useDialogs":
      "const noop = () => {}; const dialog = { open: false }; const value = { confirmDialog: dialog, alertDialog: dialog, showConfirmDialog: noop, showAlertDialog: noop, hideConfirmDialog: noop, hideAlertDialog: noop }; export const useDialogs = () => value;",
    "/hooks/useCreateNote":
      "export let creates = 0; const createNote = async () => { creates++; }; export const useCreateNote = () => ({ createNote });",
    "/ui/useToast":
      "export const toasts = []; const toast = (value) => toasts.push(value); const value = { toast }; export const useToast = () => value;",
    "/controlPanelNav": "const items = []; export const useControlPanelNavItems = () => items;",
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
    "notes/NewNoteMenu",
    "notes/BackgroundActionToastListener",
    "notes/UploadAudioView",
    "chat/ChatView",
  ]) {
    mockModules[`/${name}`] = emptyComponent;
  }
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
    storage,
    navigation: () => tree.props.value,
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
