const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { mountComponent } = require("../helpers/harness/mountComponent");
const { MIGRATED_STORAGE } = require("../lib/routeStateFixture");

// Actual AppRouter -> actual Flow -> RAM slot -> actual ControlPanel/useCreateNote.
// Only workspace UI, device/DB/recording boundaries are faked, before imports.
const NULL = "export default function Boundary() { return null; }";
const mocks = {
  "/Task18Host": `import React from "react";
import AppRouter from "/AppRouter.jsx";
import "/components/OnboardingFlow.tsx";
import "/components/ControlPanel.tsx";
import "/components/notes/PersonalNotesView";
import "/components/SettingsModal";
export default function Host() {
 const [epoch, setEpoch] = React.useState(0);
 globalThis.__remountWorkspace = () => setEpoch(n => n + 1);
 return React.createElement(React.StrictMode, null, React.createElement(AppRouter, {key: epoch}));
}`,
  "/hooks/useTheme": "export function useTheme() {}",
  "/hooks/useControlPanelWindowDrag": "export function useControlPanelWindowDrag() {}",
  "/App.jsx": NULL,
  "/dictation/AgentDictationPillOverlay": NULL,
  "/MeetingNotificationOverlay": NULL,
  "/settings/UpdateSettings": NULL,
  "/preview/BrowserPreview": NULL,
  "/hooks/useSettings": "export function useSettings() { return {useCleanupModel: false}; }",
  "/hooks/useHotkey": "export function useHotkey() { return {hotkey: 'F7'}; }",
  "/hooks/useGpuBannerAvailability": "export function useGpuBannerAvailability() { return {}; }",
  "/hooks/useCollapsibleSidebar":
    "export function useCollapsibleSidebar() { return {collapsed:false}; }",
  "/hooks/useDialogs": `const dialog = {open:false}; export function useDialogs() {
return {confirmDialog:dialog, alertDialog:dialog}; }`,
  "/stores/transcriptionStore": `export const useTranscriptions = () => [];
export const useShowDiscarded = () => false;
export async function initializeTranscriptions() {}
export function updateTranscription() {} export function clearTranscriptions() {} export function removeTranscription() {}`,
  "/stores/noteStore": `export const useActiveNoteId = () => 42;
export const useActiveContext = () => ({spaceId:1, folderId:2});
export function initializeNotes() {} export function navigateToContainer() {}
export function setActiveFolderId() {} export function setActiveNoteId(id) { globalThis.__handoff.noteIds.push(id); }
export function setActiveContext() {} export function revealContainer() {}`,
  "/stores/meetingRecordingStore": `const state = {isRecording:false, recordingNoteId:42, recordingFolderId:2};
export const useMeetingRecordingStore = s => s({...state, isRecording:globalThis.__handoff.live});
export const useIsMeetingMode = () => false; export const useIsNarrowWindow = () => false;
export async function startRecording(options) { globalThis.__handoff.recordings.push(options); return true; }`,
  "/SettingsModal": `import React from "react"; export default function Settings({initialSection}) {
return React.createElement('div', {'data-settings-path': initialSection}, 'Settings'); }`,
  "/controlPanelNav": `export function useControlPanelNavItems() { return []; }`,
  "/ControlPanelSidebar": NULL,
  "/ControlPanelTopBar": NULL,
  "/MeetingRecordingMount": `import React from 'react'; export default function Recorder() {
return React.createElement('div', {'data-original-recorder': '42'}, 'Original live recording'); }`,
  "/notes/MeetingRecordingPill": NULL,
  "/notes/NewNoteMenu": NULL,
  "/HistoryView": NULL,
  "/FinishDictationSetupCard": NULL,
  "/notes/BackgroundActionNoticeListener": NULL,
  "/notes/PersonalNotesView": `import React from 'react'; export default function Notes() {
return React.createElement('div', {'data-notes-view': 'true'}, 'Preserved editor and chat fixture'); }`,
  "/CommandSearch": NULL,
  "/ui/dialog":
    "export function AlertDialog() { return null; } export function ConfirmDialog() { return null; }",
};

for (const kind of ["dictate-note", "open-settings"]) {
  for (const live of kind === "dictate-note" ? [false, true] : [true]) {
    test(`actual completion hands ${kind} once through StrictMode and workspace remount (live=${live})`, async (t) => {
      const state = { live, noteIds: [], recordings: [], saves: [] };
      globalThis.__handoff = state;
      t.after(() => {
        delete globalThis.__handoff;
        delete globalThis.__remountWorkspace;
      });
      const ui = await mountComponent(t, "/Task18Host", {
        mocks,
        windowProps: { location: { search: "?panel=true" } },
        storage: {
          ...MIGRATED_STORAGE,
          "loqui.onboarding.progress": JSON.stringify({
            version: 2,
            step: "finish",
            visited: ["finish"],
          }),
          meetingTranscriptionMode: "local",
          meetingUseLocalWhisper: "true",
          meetingLocalTranscriptionProvider: "whisper",
          meetingWhisperModel: "base",
          semanticReindexVersion: "2",
          ...(kind === "open-settings"
            ? {
                meetingTranscriptionMode: "self-hosted",
                meetingUseLocalWhisper: "false",
                remoteTranscriptionUrl: "http://10.0.0.5:9000",
              }
            : {}),
        },
        api: {
          getPlatform: () => "linux",
          checkMicrophoneAccess: async () => ({ granted: true }),
          getSystemProfile: async () => ({
            platform: "linux",
            locales: ["en-US"],
            totalMemoryBytes: 16e9,
          }),
          listWhisperModels: async () => ({
            success: true,
            models: [{ model: "base", downloaded: true }],
          }),
          saveNote: async (...args) => {
            state.saves.push(args);
            return { success: true, note: { id: 99, title: "New", space_id: 1, folder_id: 2 } };
          },
        },
      });
      for (let i = 0; i < 500 && !ui.text().includes("setupFlow.ready.dictateNote"); i++)
        await React.act(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });
      const button =
        kind === "dictate-note"
          ? ui.byAttr("data-variant", "live")[0]
          : ui.findAll(
              (n) => n.tagName === "BUTTON" && n.textContent.includes("setupFlow.ready.fixNote")
            )[0];
      assert.ok(button, "actual Ready action exists: " + ui.text());
      assert.equal(
        "disabled" in button.attributes,
        false,
        "eligible note route or its Settings fix is actionable"
      );
      await ui.click(button);
      for (let i = 0; i < 500 && !ui.byAttr("data-original-recorder").length; i++)
        await React.act(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });
      for (let i = 0; i < 8; i++) await React.act(async () => {});
      const destination = kind === "dictate-note" ? "data-notes-view" : "data-settings-path";
      for (let i = 0; i < 500 && !ui.byAttr(destination).length; i++)
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
      assert.equal(ui.storage.getItem("onboardingCompleted"), "true");
      assert.equal(ui.byAttr("data-original-recorder", "42").length, 1);
      if (kind === "dictate-note") {
        assert.equal(state.saves.length, 1, "actual useCreateNote creates exactly once");
        assert.deepEqual(state.noteIds, [99]);
        assert.equal(
          state.recordings.length,
          live ? 0 : 1,
          "existing recorder owns start and live capture is preserved"
        );
        if (!live) assert.equal(state.recordings[0].noteId, 99);
        assert.equal(ui.byAttr("data-notes-view", "true").length, 1);
      } else {
        assert.equal(ui.byAttr("data-settings-path", "stt/noteRecording").length, 1);
        assert.equal(state.saves.length, 0);
        assert.equal(state.recordings.length, 0);
      }
      await React.act(async () => globalThis.__remountWorkspace());
      for (let i = 0; i < 8; i++) await React.act(async () => {});
      assert.equal(
        state.saves.length,
        kind === "dictate-note" ? 1 : 0,
        "remount cannot consume twice"
      );
      assert.equal(
        ui.byAttr("data-settings-path").length,
        0,
        "Settings intent is not replayed on remount"
      );
      const intent = await ui.vite.ssrLoadModule("/utils/afterSetupIntent.ts");
      assert.equal(intent.takeAfterSetupIntent(), null);
      assert.equal(
        [...(ui.storage.entries?.() ?? [])].some(([k]) => /afterSetupIntent/.test(k)),
        false
      );
    });
  }
}

test("actual desktop Router resumes stored progress and remounts actual Flow on every same-step request", async (t) => {
  const events = new EventTarget();
  globalThis.__handoff = { live: false, noteIds: [], recordings: [], saves: [] };
  const ui = await mountComponent(t, "/Task18Host", {
    mocks,
    windowProps: {
      location: { search: "?panel=true" },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    },
    storage: {
      ...MIGRATED_STORAGE,
      onboardingCompleted: "true",
      semanticReindexVersion: "2",
      "loqui.onboarding.progress": JSON.stringify({
        version: 2,
        step: "cleanup",
        visited: ["welcome", "cleanup"],
      }),
    },
  });
  const wait = async (predicate) => {
    for (let i = 0; i < 200 && !predicate(); i++)
      await React.act(async () => new Promise((r) => setTimeout(r, 10)));
    assert.equal(Boolean(predicate()), true, "actual lazy Flow ready");
  };
  t.after(() => {
    delete globalThis.__handoff;
    delete globalThis.__remountWorkspace;
  });
  await wait(() => ui.byAttr("data-original-recorder").length);
  const { requestStartOnboarding } = await ui.vite.ssrLoadModule("/hooks/useStartOnboarding.ts");
  await React.act(async () => requestStartOnboarding());
  await wait(() => ui.text().includes("setupFlow.rail.cleanup.title"));
  const header = () =>
    ui
      .findAll((n) => n.tagName === "H1")
      .find((n) => n.textContent.includes("setupFlow.rail.cleanup.title"));
  const first = header();
  assert.ok(first, "unspecified desktop request resumes actual saved Cleanup");
  for (let i = 0; i < 2; i++) {
    const previous = header();
    await React.act(async () => requestStartOnboarding("cleanup"));
    await wait(() => header() && header() !== previous);
  }
  assert.equal(
    ui.byAttr("data-original-recorder").length,
    1,
    "existing Panel subtree stays mounted"
  );
});
