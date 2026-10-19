const React = require("react");
const { installMicCaptureGlobals } = require("../../lib/rendererTestHarness");
const { mountComponent } = require("./mountComponent");
const { MIGRATED_STORAGE } = require("../../lib/routeStateFixture");
const NULL = "export default function Leaf() { return null; }";
const mocks = {
  "/Task19Host": `import React from 'react'; import AppRouter from '/AppRouter.jsx';
import '/components/ControlPanel.tsx'; import '/components/OnboardingFlow.tsx';
import '/components/chat/ChatView'; import '/components/notes/PersonalNotesView';
export default function Host() {
 if(!document.__workspaceFixture) {
  document.__workspaceFixture=true;
  const make=document.createElement;
  document.createElement=(...args)=>{const node=make(...args);node.select=()=>{};node.querySelectorAll=()=>[];node.getBoundingClientRect=()=>({width:0,height:0,left:0,top:0});return node;};
  document.body=document.createElement('body');
  document.querySelector=()=>null;
  document.addEventListener=(type,cb)=>{const listeners=globalThis.__workspace.documentListeners; if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(cb);};
  document.removeEventListener=(type,cb)=>globalThis.__workspace.documentListeners.get(type)?.delete(cb);
 }
 return React.createElement(React.StrictMode,null,React.createElement(AppRouter)); }`,
  "/components/OnboardingFlow.tsx": `import React from 'react'; export default function Flow(props) {
 const [id]=React.useState(()=>++globalThis.__workspace.flowId);
 globalThis.__workspace.flow=props;
 return React.createElement('button',{'data-setup-instance':id,'data-requested-step':props.initialStep??'resume',onClick:()=>props.onComplete()},'Return'); }`,
  "/hooks/useTheme": "export function useTheme() {}",
  "/hooks/useControlPanelWindowDrag": "export function useControlPanelWindowDrag() {}",
  "/App.jsx": NULL,
  "/dictation/AgentDictationPillOverlay": NULL,
  "/MeetingNotificationOverlay": NULL,
  "/settings/UpdateSettings": NULL,
  "/preview/BrowserPreview": NULL,
  "/hooks/useSettings": "export function useSettings() { return {useCleanupModel:false}; }",
  "/hooks/useHotkey": "export function useHotkey() { return {hotkey:'F7'}; }",
  "/hooks/useGpuBannerAvailability": "export function useGpuBannerAvailability() { return {}; }",
  "/hooks/useCollapsibleSidebar":
    "export function useCollapsibleSidebar() { return {collapsed:false}; }",
  "/controlPanelNav": "export function useControlPanelNavItems() { return []; }",
  "/ControlPanelSidebar": `export default function Sidebar(props) { globalThis.__workspace.nav=props; return null; }`,
  "/ControlPanelTopBar": `import React from 'react'; export default function Bar({actions}) {return React.createElement('div',null,actions);}`,
  "/SettingsModal": `import React from 'react'; export default function Settings({initialSection}) {return React.createElement('div',{'data-settings-path':initialSection},'Settings');}`,
  "/HistoryView": NULL,
  "/notes/BackgroundActionToastListener": NULL,
  "/notes/NewNoteMenu": NULL,
  "/CommandSearch": NULL,
  "/ConversationList": `export default function List(props) {globalThis.__workspace.conversations=props;return null;}`,
  "/ChatEmptyIllustration": "export function ChatEmptyIllustration() {return null;}",
  "/ChatMessages": `import React from 'react'; export function ChatMessages({messages}) {return React.createElement('div',{'data-chat-messages':true},messages.map(m=>m.content).join('|'));}`,
  "/useVoiceDraft": `export function useVoiceDraft() {return {status:'idle',start(){},stop(){},cancel(){},elapsed:0,readLevel:()=>0};}`,
  "/services/ReasoningService": `export default {
 cancelActiveStream(){globalThis.__workspace.cancels++;},
 async *processTextStreamingAI(...args) {
  globalThis.__workspace.requests.push(args); yield {type:'content',text:'first '};
  await globalThis.__workspace.reply.promise;
  yield {type:'content',text:'answer'}; yield {type:'done',finishReason:'stop'};
 }};`,
  "/ui/dialog": `export function AlertDialog(){return null;} export function ConfirmDialog(){return null;} export function Dialog(){return null;} export function DialogContent(){return null;} export function DialogTitle(){return null;}`,
  "/ui/RichTextEditor": `import React from 'react';export function RichTextEditor(props) {return React.createElement('textarea',{'data-document-editor':true,value:props.value,onChange:e=>props.onChange(e.target.value)});}`,
  "/notes/SpacesTree": NULL,
  "/notes/overview/ContainerOverview": "export function ContainerOverview(){return null;}",
  "/notes/ActionManagerDialog": NULL,
  "/notes/ActionPicker": NULL,
  "/notes/AddNotesToFolderDialog": NULL,
  "/notes/NotesOnboarding": NULL,
  "/notes/NoteParticipants": NULL,
  "/notes/MeetingTranscriptChat":
    "export function MeetingTranscriptChat(){return null;} export function SelectionBar(){return null;}",
  "/hooks/useActionProcessing": "export function useActionProcessing(){return {state:'idle'};}",
  "/hooks/useNoteActionsReady": "export function useNoteActionsReady(){return false;}",
  "/hooks/useNotesOnboarding":
    "export function useNotesOnboarding(){return {showOnboarding:false};}",
  "/hooks/useCopyFeedback":
    "export function useCopyFeedback(){return {copied:false,copy(){},copyText(){}};}",
};
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}
const act = (fn) =>
  React.act(async () => {
    await fn?.();
    await new Promise((r) => setTimeout(r, 0));
  });
async function workspace(t, { firstLaunch = false, realSettings = false } = {}) {
  installMicCaptureGlobals(t);
  const previousResize = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  t.after(() => {
    globalThis.ResizeObserver = previousResize;
  });
  const state = {
    documentListeners: new Map(),
    savedNotes: [],
    flowId: 0,
    cancels: 0,
    requests: [],
    reply: deferred(),
    writes: [],
    saves: [],
    updates: [],
    listeners: new Map(),
    note: {
      id: 42,
      title: "Original",
      content: "Saved document",
      space_id: 1,
      folder_id: 2,
      note_type: "personal",
    },
  };
  globalThis.__workspace = state;
  t.after(async () => {
    await React.act(async () => {
      state.reply.resolve();
      if (state.meeting?.useMeetingRecordingStore.getState().isRecording)
        await state.meeting.stopRecording();
    });
    await ui.unmount();
    delete globalThis.__workspace;
  });
  const listeners = new Map();
  const ui = await mountComponent(t, "/Task19Host", {
    mocks: realSettings
      ? Object.fromEntries(
          Object.entries({
            ...mocks,
            // Actual modal, SettingsPage and private useSubTab run. Only presentation,
            // provider/media leaves and unrelated hooks are replaced before imports.
            "/SettingsModal": undefined,
            "/hooks/useTheme": "export function useTheme(){return {theme:'light',setTheme(){}};}",
            "/hooks/useSettings":
              "import {useSettingsStore} from '/stores/settingsStore.ts'; export function useSettings(){return useSettingsStore();}",
            "/ui/SidebarModal": `import React from 'react'; export default function Sidebar(p){return React.createElement('section',{'data-settings-section':p.activeSection,hidden:!p.open},p.search,p.sidebarItems.map(i=>React.createElement('button',{key:i.id,onClick:()=>p.onSectionChange(i.id)},i.id)),p.children);}`,
            "/settings/routing/StagedRouteBar": "export function StagedRouteBar(){return null;}",
            "/hooks/useWhisper":
              "export function useWhisper(){return {checkWhisperInstallation(){}};}",
            "/hooks/usePermissions": "export function usePermissions(){return {};}",
            "/hooks/useSystemAudioPermission":
              "export function useSystemAudioPermission(){return {};}",
            "/hooks/useClipboard": "export function useClipboard(){}",
            "/hooks/useHotkeyRegistration": "export function useHotkeyRegistration(){return {};}",
            "/hooks/useHotkeyModeInfo": "export function useHotkeyModeInfo(){return {};}",
            "/TranscriptionModelPicker": NULL,
            "/SelfHostedPanel": NULL,
            "/ui/MicrophoneSettings": NULL,
            "/settings/MeetingSettings":
              "import React from 'react';export function MeetingTranscriptionPanel(){return React.createElement('div',{'data-note-recording-settings':true},'Note recording fixture');}",
            "/settings/UploadSettings": "export function UploadTranscriptionPanel(){return null;}",
          }).filter(([, value]) => value !== undefined)
        )
      : mocks,
    windowProps: {
      location: { search: "?panel=true" },
      addEventListener(type, cb) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(cb);
      },
      removeEventListener(type, cb) {
        listeners.get(type)?.delete(cb);
      },
      dispatchEvent(event) {
        for (const cb of [...(listeners.get(event.type) ?? [])]) cb(event);
        return true;
      },
    },
    storage: {
      ...MIGRATED_STORAGE,
      onboardingCompleted: firstLaunch ? "false" : "true",
      semanticReindexVersion: "2",
      chatAgentMode: "self-hosted",
      chatAgentProvider: "lan",
      chatAgentModel: "tiny-1b",
      chatAgentRemoteUrl: "http://fixture.invalid/v1",
      meetingFollowsReasoning: "false",
      "loqui.onboarding.progress": JSON.stringify({
        version: 2,
        step: "cleanup",
        visited: ["welcome", "cleanup"],
        explored: true,
      }),
    },
    api: {
      onShowSettings: (cb) => {
        state.showSettings = cb;
        return () => {
          state.showSettings = null;
        };
      },
      getPlatform: () => "linux",
      listGpus: async () => [],
      getAppVersion: async () => ({ version: "fixture" }),
      checkSystemAudioAccess: async () => ({
        granted: true,
        status: "granted",
        mode: "native",
        strategy: "native",
      }),
      meetingTranscriptionStart: async (..._args) => {
        state.recordingStarts = (state.recordingStarts ?? 0) + 1;
        return { success: true, systemAudioMode: "native", systemAudioStrategy: "native" };
      },
      meetingTranscriptionSetSystemAudioAvailable: async () => ({ success: true }),
      meetingTranscriptionStop: async () => ({ success: true }),
      meetingTranscriptionSend() {},
      onMeetingTranscriptionSegment: (cb) => {
        state.segment = cb;
        return () => {
          state.segment = null;
        };
      },
      getTranscriptions: async () => [],
      getSpaces: async () => [{ id: 1, kind: "private", name: "Personal" }],
      getFolders: async () => [{ id: 2, space_id: 1, name: "Notes", is_default: 1 }],
      getFolderNoteCounts: async () => [],
      getNotes: async () => [state.note],
      getNote: async () => state.note,
      getActions: async () => [],
      getSpeakerMappings: async () => [],
      getSpeakerProfiles: async () => [],
      getConversationsForNote: async () => [],
      getPendingNoteNavigation: async () => null,
      getPendingMeetingNoteNavigation: async () => null,
      onMeetingAutoEndRequested: (cb) => {
        state.autoEnd = cb;
        return () => {
          state.autoEnd = null;
        };
      },
      updateNote: async (id, updates) => {
        state.updates.push({ id, updates });
        return { success: true };
      },
      createAgentConversation: async () => state.creation?.promise ?? { id: 7 },
      getAgentConversation: async (id) => ({
        id,
        messages: [{ id: 1, role: "user", content: "Original history" }],
      }),
      addAgentMessage: async (id, role, content) => {
        state.writes.push({ id, role, content });
        return { id: state.writes.length };
      },
      saveNote: async (...args) => {
        state.saves.push(args);
        const note = { ...state.note, id: 99, space_id: args[6] ?? 1, folder_id: args[5] };
        await state.noteSave?.promise;
        state.savedNotes.push(note);
        return { success: true, note };
      },
      semanticSearchNotes: async () => [],
    },
  });
  const start = await ui.vite.ssrLoadModule("/hooks/useStartOnboarding.ts");
  const meeting = await ui.vite.ssrLoadModule("/stores/meetingRecordingStore.ts");
  state.meeting = meeting;
  const notes = await ui.vite.ssrLoadModule("/stores/noteStore.ts");
  const wait = async (predicate) => {
    for (let i = 0; i < 150 && !predicate(); i++)
      await act(() => new Promise((r) => setTimeout(r, 10)));
    assertReady(predicate());
  };
  function assertReady(value) {
    require("node:assert/strict").equal(Boolean(value), true, "production lazy workspace ready");
  }
  if (!firstLaunch) await wait(() => state.nav);
  return {
    ...ui,
    state,
    meeting,
    notes,
    act,
    wait,
    start: (step) => act(() => start.requestStartOnboarding(step)),
    return: () => act(() => state.flow.onComplete()),
  };
}
module.exports = { workspace, act, deferred };
