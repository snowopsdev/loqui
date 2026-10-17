const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { deferred } = require("../helpers/harness/deferred");

const note = { id: 9, space_id: 1, folder_id: 2, title: "Fixture", transcript: "" };
async function mount(t, saveNote = async () => ({ success: true, note })) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const saves = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        saveNote: (...args) => {
          saves.push(args);
          return saveNote(...args);
        },
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `const t = (key) => key; export const useTranslation = () => ({ t });`,
      "/stores/noteStore": `export const selections = []; export const useActiveContext = () => ({ spaceId: 1, folderId: 2 }); export const setActiveContext = (...args) => selections.push(["context", ...args]); export const revealContainer = (...args) => selections.push(["reveal", ...args]); export const setActiveNoteId = (id) => selections.push(["note", id]);`,
      "/stores/meetingRecordingStore": `let state = { isRecording: false }; export const starts = []; export let activation = Promise.resolve(true); export const setActivation = (promise) => { activation = promise; }; export const setRecording = (value) => { state.isRecording = value; }; export const useMeetingRecordingStore = Object.assign((select) => select(state), { getState: () => state }); export const startRecording = async (args) => { starts.push(args); await activation; state.isRecording = true; return true; };`,
    },
  });
  const mod = await vite.ssrLoadModule("/hooks/useCreateNote.ts");
  const meeting = await vite.ssrLoadModule("/stores/meetingRecordingStore");
  const notes = await vite.ssrLoadModule("/stores/noteStore");
  let hook;
  function Probe() {
    hook = mod.useCreateNote();
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  return {
    hook: () => hook,
    saves,
    meeting,
    notes,
    rerender: async () => React.act(async () => root.render(React.createElement(Probe))),
  };
}

test("createNote defaults to recording and forwards context and seeded note", async (t) => {
  const h = await mount(t);
  await h.hook().createNote();
  assert.deepEqual(h.saves[0], ["notes.list.untitledNote", "", "personal", null, null, 2, 1]);
  assert.equal(h.meeting.starts.length, 1);
  assert.equal(h.meeting.starts[0].noteId, 9);
  assert.deepEqual(h.notes.selections, [
    ["context", 1, 2],
    ["reveal", 1, 2],
    ["note", 9],
  ]);
});

test("plain New note opts out through both additive APIs", async (t) => {
  const h = await mount(t);
  await h.hook().createNote({ record: false });
  await h.hook().createNoteIn(3, null, { record: false });
  assert.equal(h.saves.length, 2);
  assert.equal(h.saves[1][6], 3);
  assert.equal(h.meeting.starts.length, 0);
});

test("repeated Record meeting admits once across deferred save and start activation; plain notes remain independent", async (t) => {
  const save = deferred();
  const activation = deferred();
  const h = await mount(t, () => save.promise);
  h.meeting.setActivation(activation.promise);
  const first = h.hook().createNote({ record: true });
  const second = h.hook().createNote({ record: true });
  assert.equal(h.saves.length, 1, "save admission is synchronous");
  await React.act(async () => save.resolve({ success: true, note }));
  assert.equal(h.meeting.starts.length, 1);
  await h.rerender();
  const third = h.hook().createNote({ record: true });
  assert.equal(h.saves.length, 1, "admission remains held until start settles");
  await h.hook().createNote({ record: false });
  assert.equal(h.saves.length, 2, "plain creation is independent");
  assert.equal(h.meeting.starts.length, 1);
  activation.resolve(true);
  await Promise.all([first, second, third]);
});

test("failed saves and rejected activation release admission for a retry", async (t) => {
  let result = { success: false };
  const h = await mount(t, async () => result);
  await h.hook().createNote();
  assert.equal(h.meeting.starts.length, 0);
  assert.deepEqual(h.notes.selections, []);
  result = { success: true, note };
  let rejectActivation;
  const activation = new Promise((_, reject) => {
    rejectActivation = reject;
  });
  h.meeting.setActivation(activation);
  await h.hook().createNote();
  rejectActivation(new Error("fixture activation"));
  await Promise.resolve();
  await Promise.resolve();
  h.meeting.setActivation(Promise.resolve(true));
  await h.hook().createNote();
  assert.equal(h.saves.length, 3);
  assert.equal(h.meeting.starts.length, 2);
});

test("recording state is read after save rather than from a stale render", async (t) => {
  const save = deferred();
  const h = await mount(t, () => save.promise);
  const pending = h.hook().createNote();
  h.meeting.setRecording(true);
  save.resolve({ success: true, note });
  await pending;
  assert.equal(h.meeting.starts.length, 0);
});

test("createNoteIn also defaults to recording and a rejected save releases admission", async (t) => {
  let fail = true;
  const h = await mount(t, async () => {
    if (fail) throw new Error("fixture save");
    return { success: true, note };
  });
  await assert.rejects(h.hook().createNoteIn(3, null), /fixture save/);
  assert.equal(h.meeting.starts.length, 0);
  fail = false;
  await h.hook().createNoteIn(3, null);
  assert.equal(h.meeting.starts.length, 1);
  assert.equal(h.saves.length, 2);
  assert.equal(h.saves[1][6], 3);
});
