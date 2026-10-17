const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

function find(node, predicate) {
  if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}

async function mount(t, { acknowledge = async () => true } = {}) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  let push;
  const acknowledgments = [];
  installBrowserGlobals(t, {
    initialStorage: { semanticReindexVersion: "2" },
    window: {
      electronAPI: {
        onShowSettings: (listener) => {
          push = listener;
          return () => {
            push = null;
          };
        },
        pendingSettingsLink: async () => null,
        ackSettingsLink: async (id) => {
          acknowledgments.push(id);
          return acknowledge(id);
        },
      },
    },
  });
  const container = installHookDom(t);
  // Compile the exact production hook without exporting a test-only API or
  // loading SettingsPage's unrelated provider/editor surfaces. This is its
  // actual effect and useLocalStorage implementation, not a modeled effect.
  const pageSource = fs.readFileSync(
    path.join(__dirname, "../../src/components/SettingsPage.tsx"),
    "utf8"
  );
  const hookStart = pageSource.indexOf("function useSubTab<");
  const hookEnd = pageSource.indexOf("\nfunction VADLabelWithInfo", hookStart);
  assert.ok(hookStart >= 0 && hookEnd > hookStart);
  const tabsStart = pageSource.indexOf("function LlmsTabs(");
  const tabsEnd = pageSource.indexOf("\nfunction GpuDeviceSelector", tabsStart);
  assert.ok(tabsStart >= 0 && tabsEnd > tabsStart);
  const ts = require("typescript");
  const hookSource = ts.transpileModule(
    `
    import React, { useEffect } from 'react';
    import { useTranslation } from 'react-i18next';
    import { useLocalStorage } from '/hooks/useLocalStorage.ts';
    import { LLM_SUB_TABS as LLM_TABS } from '/lib/settingsPaths.ts';
    const SectionHeader = () => null, ProviderTabs = () => null, TabPanel = () => null;
    const Wand2 = () => null, Sparkles = () => null, Languages = () => null;
    const BookOpen = () => null, HardDrive = () => null, MessageSquare = () => null;
    ${pageSource.slice(hookStart, hookEnd)}
    export ${pageSource.slice(tabsStart, tabsEnd)}
  `,
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        jsx: ts.JsxEmit.React,
      },
    }
  ).outputText;
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-settings-activation-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `const t = k => k; export const useTranslation = () => ({ t, i18n: { language:'en', dir: () => 'ltr' } }); export const initReactI18next = {type:'3rdParty',init(){}}; export const Trans = () => null;`,
      "/subtabProbe.ts": hookSource,
      "/SettingsPage": "export default function SettingsPage() { return null; }",
      "/ui/SidebarModal": "export default function SidebarModal() { return null; }",
      "/settings/SettingsSearchResults": "export function SettingsSearchResults() { return null; }",
      "/settings/SettingsSearchField":
        "import {forwardRef} from 'react'; export const SettingsSearchField = forwardRef(function F(){return null});",
      "/hooks/useDialogs": `const noop=()=>{}; const dialogs={confirmDialog:{open:false},alertDialog:{open:false},showConfirmDialog:noop,showAlertDialog:noop,hideConfirmDialog:noop,hideAlertDialog:noop}; export const useDialogs=()=>dialogs;`,
      "/hooks/useHotkey": "export const useHotkey=()=>({hotkey:'fixture'});",
      "/ui/useToast": "const toast=()=>{}; export const useToast=()=>({toast});",
      "/hooks/useSettings": "export const useSettings=()=>({useCleanupModel:false});",
      "/hooks/useCollapsibleSidebar": "export const useCollapsibleSidebar=()=>({collapsed:false});",
      "/stores/settingsStore":
        "const settings={}; export const getSettings=()=>settings; export const useSettingsStore=Object.assign(selector=>selector(settings),{getState:()=>settings,subscribe:()=>()=>{}});",
      "/stores/transcriptionStore":
        "export const useTranscriptions=()=>[];export const useShowDiscarded=()=>false;export const initializeTranscriptions=async()=>{};export const clearTranscriptions=()=>{};export const removeTranscription=()=>{};export const updateTranscription=()=>{};",
      "/stores/meetingRecordingStore":
        "export const useIsMeetingMode=()=>false;export const useIsNarrowWindow=()=>false;export const useMeetingRecordingStore=selector=>selector({recordingNoteId:null,recordingFolderId:null});",
      "/controlPanelNav": "export const useControlPanelNavItems=()=>[];",
      "/hooks/useCreateNote": "export const useCreateNote=()=>({createNote:async()=>{}});",
      "/hooks/useGpuBannerAvailability": "export const useGpuBannerAvailability=()=>false;",
      "/stores/noteStore":
        "export const initializeNotes=()=>{};export const navigateToContainer=()=>{};export const setActiveFolderId=()=>{};export const setActiveNoteId=()=>{};export const useActiveNoteId=()=>null;",
      "/utils/platform": "export const getCachedPlatform=()=> 'linux';",
      "/helpers/translationChain":
        "export const executeTranslationChain=()=>{};export const hasTextContent=()=>false;export const shouldRunTranslateStep=()=>false;",
      "/HistoryView": "export default function HistoryView(){return null}",
      "/ControlPanelSidebar": "export default function Sidebar(){return null}",
      "/ControlPanelTopBar": "export default function TopBar(){return null}",
      "/MeetingRecordingMount": "export default function MeetingRecordingMount(){return null}",
      "/notes/MeetingRecordingPill": "export default function Pill(){return null}",
      "/notes/NewNoteMenu": "export default function Menu(){return null}",
      "/notes/BackgroundActionNoticeListener": "export default function Listener(){return null}",
      "/FinishDictationSetupCard": "export default function Finish(){return null}",
    },
  });
  const ControlPanel = (await vite.ssrLoadModule("/components/ControlPanel.tsx")).default;
  const SettingsModal = (await vite.ssrLoadModule("/components/SettingsModal.tsx")).default;
  const { LlmsTabs } = await vite.ssrLoadModule("/subtabProbe.ts");
  let modal,
    settingsProps,
    tab,
    selectTab,
    draft,
    setDraft,
    visible = false;
  let mounts = 0;
  function PageProbe(props) {
    const noop = () => null;
    const tabs = LlmsTabs({
      initialTab: props.initialSubTab,
      activationId: props.activationId,
      renderDictationCleanup: noop,
      renderDictationAgent: noop,
      renderDictationTranslation: noop,
      renderNoteFormatting: noop,
      renderChatIntelligence: noop,
      renderSupportModels: noop,
    });
    const selector = find(tabs, (node) => node.props && "selectedId" in node.props);
    tab = selector.props.selectedId;
    selectTab = selector.props.onSelect;
    [draft, setDraft] = React.useState("");
    React.useEffect(() => {
      mounts++;
    }, []);
    return null;
  }
  function ModalProbe(props) {
    settingsProps = props;
    modal = SettingsModal(props);
    const page = find(modal, (node) => node.props && "initialSubTab" in node.props);
    return React.createElement(PageProbe, page.props);
  }
  function PanelProbe() {
    // Execute the real panel's hooks/state/subscriber and read its actual modal
    // props; visual children remain unrendered inert fixture leaves.
    const panel = ControlPanel();
    const settings = find(
      panel,
      (node) => node.props && "initialSection" in node.props && "open" in node.props
    );
    visible = Boolean(settings);
    return settings ? React.createElement(ModalProbe, settings.props) : null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(PanelProbe)));
  return {
    acknowledgments,
    visible: () => visible,
    deliver: (id, path) =>
      React.act(async () => {
        assert.ok(push);
        push({ id, path });
        await new Promise(setImmediate);
      }),
    section: () => modal.props.activeSection,
    navigateSection: (section) => React.act(async () => modal.props.onSectionChange(section)),
    tab: () => tab,
    selectTab: (next) => React.act(async () => selectTab(next)),
    props: () => settingsProps,
    setDraft: (value) => React.act(async () => setDraft(value)),
    draft: () => draft,
    mounts: () => mounts,
    unmount: () =>
      React.act(async () => {
        await root.unmount();
        root = null;
      }),
    settle: (callback) =>
      React.act(async () => {
        callback();
        await new Promise(setImmediate);
      }),
    close: () => React.act(async () => settingsProps.onOpenChange(false)),
  };
}

test("a new same-path acknowledgment reactivates its section through actual ControlPanel state", async (t) => {
  const h = await mount(t);
  await h.deliver("first", "privacyData");
  assert.equal(h.section(), "privacyData");
  await h.setDraft("keep unrelated modal state");
  await h.navigateSection("general");
  assert.equal(h.section(), "general");
  await h.deliver("second", "privacyData");
  assert.equal(h.section(), "privacyData");
  assert.deepEqual(h.acknowledgments, ["first", "second"]);
  assert.equal(h.mounts(), 1, "reactivation never remounts the page");
  assert.equal(h.draft(), "keep unrelated modal state");
});

test("a new same-path acknowledgment reactivates the actual useSubTab effect without remount", async (t) => {
  const h = await mount(t);
  await h.deliver("first", "llms/dictationCleanup");
  assert.equal(h.tab(), "dictationCleanup");
  await h.setDraft("keep the editor state");
  await h.selectTab("supportModels");
  assert.equal(h.tab(), "supportModels");
  await h.deliver("second", "llms/dictationCleanup");
  assert.equal(h.tab(), "dictationCleanup");
  assert.equal(h.mounts(), 1);
  assert.equal(h.draft(), "keep the editor state");
});

test("late acknowledged A cannot replace B or reopen after the control panel unmounts", async (t) => {
  const answers = new Map();
  const h = await mount(t, {
    acknowledge: (id) => new Promise((resolve) => answers.set(id, resolve)),
  });
  await h.deliver("A", "privacyData");
  await h.deliver("B", "llms/dictationCleanup");
  await h.settle(() => answers.get("B")(true));
  assert.equal(h.section(), "llms");
  assert.equal(h.tab(), "dictationCleanup");
  assert.equal(h.props().activationId, "B");
  await h.settle(() => answers.get("A")(true));
  assert.equal(h.section(), "llms");
  assert.equal(h.props().activationId, "B");
  await h.deliver("late", "privacyData");
  await h.unmount();
  await h.settle(() => answers.get("late")(true));
  assert.equal(h.mounts(), 1, "a disposed subscriber cannot reactivate the unmounted page");
});

test("a closed modal stays closed when an already acknowledged request is replayed", async (t) => {
  const h = await mount(t);
  await h.deliver("acknowledged", "llms/dictationCleanup");
  assert.equal(h.visible(), true);
  await h.close();
  assert.equal(h.visible(), false);
  await h.deliver("acknowledged", "llms/dictationCleanup");
  assert.equal(h.visible(), false);
  assert.deepEqual(h.acknowledgments, ["acknowledged"]);
  assert.equal(h.mounts(), 1);
});
