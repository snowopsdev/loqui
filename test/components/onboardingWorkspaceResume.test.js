const test = require("node:test");
const assert = require("node:assert/strict");
const { workspace, deferred } = require("../helpers/harness/onboardingWorkspace");

test("actual Router retains ChatView composer and current conversation across restart/return", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("chat"));
  await ui.wait(() => ui.findAll((n) => n.tagName === "TEXTAREA").length);
  await ui.act(() => ui.state.conversations.onSelectConversation(8));
  const textarea = () => ui.findAll((n) => n.tagName === "TEXTAREA")[0];
  await ui.act(() => ui.props(textarea()).onChange({ target: { value: "Unsaved newer draft" } }));
  const node = textarea();
  await ui.start("cleanup");
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  assert.equal(textarea() === node, true, "original composer remains mounted during setup");
  await ui.return();
  await ui.wait(() => textarea());
  assert.equal(textarea() === node, true, "original composer node must survive setup");
  assert.equal(ui.props(textarea()).value, "Unsaved newer draft");
  assert.equal(ui.state.conversations.activeConversationId, 8);
  assert.match(ui.text(), /Original history/);
});

test("actual Router preserves admitted provider callback and assistant persistence while setup is shown", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("chat"));
  await ui.wait(() => ui.findAll((n) => n.tagName === "TEXTAREA").length);
  const textarea = () => ui.findAll((n) => n.tagName === "TEXTAREA")[0];
  await ui.act(() => ui.props(textarea()).onChange({ target: { value: "Question A" } }));
  await ui.act(() =>
    ui.props(textarea()).onKeyDown({
      key: "Enter",
      shiftKey: false,
      nativeEvent: { isComposing: false, keyCode: 13 },
      preventDefault() {},
    })
  );
  await ui.wait(() => ui.state.requests.length === 1);
  const cancels = ui.state.cancels;
  await ui.start("cleanup");
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  assert.equal(ui.state.cancels, cancels, "setup must not unmount/cancel the admitted stream");
  await ui.act(() => ui.state.reply.resolve());
  await ui.wait(() => ui.state.writes.some((w) => w.role === "assistant"));
  assert.deepEqual(ui.state.writes, [
    { id: 7, role: "user", content: "Question A" },
    { id: 7, role: "assistant", content: "first answer" },
  ]);
  await ui.return();
  await ui.wait(() => textarea());
  assert.match(ui.text(), /first answer/);
});

test("actual note draft/editor and original live recording/save owners survive setup and deferred completion", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("personal-notes"));
  await ui.wait(() => ui.byAttr("data-document-editor").length);
  const editor = () => ui.byAttr("data-document-editor")[0];
  const node = editor();
  await ui.act(() => ui.props(editor()).onChange({ target: { value: "New document draft" } }));
  assert.equal(ui.props(editor()).value, "New document draft");
  await ui.act(() =>
    ui.meeting.startRecording({
      noteId: 42,
      noteTitle: "Original",
      folderId: 2,
      seedSegments: [],
      autoEndEligible: true,
    })
  );
  assert.equal(ui.meeting.useMeetingRecordingStore.getState().isRecording, true);
  const session = ui.meeting.getActiveRecordingSessionId();
  const segment = ui.state.segment;
  const autoEnd = ui.state.autoEnd;
  await ui.start("cleanup");
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  assert.equal(editor() === node, true, "actual NoteEditor and draft owner remain mounted");
  assert.equal(ui.state.segment === segment, true, "original recorder subscription remains owned");
  assert.equal(
    ui.state.autoEnd === autoEnd,
    true,
    "original MeetingRecordingMount auto-end consumer remains installed"
  );
  assert.equal(ui.meeting.getActiveRecordingSessionId(), session);
  assert.equal(ui.props(editor()).value, "New document draft");
  await ui.act(() =>
    segment({
      sessionId: session,
      text: "Captured live words",
      speaker: "speaker_0",
      isFinal: true,
      source: "mic",
    })
  );
  const portalButtons = [];
  const visit = (node) => {
    if (node.tagName === "BUTTON") portalButtons.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(globalThis.document.body);
  const stop = portalButtons.find((n) => n.attributes?.["aria-label"] === "notes.editor.stop");
  assert.ok(stop, "actual portalled live Stop remains available during setup");
  await ui.click(stop);
  assert.equal(ui.meeting.useMeetingRecordingStore.getState().isRecording, false);
  assert.ok(
    ui.state.updates.some((w) => w.id === 42 && w.updates.transcript),
    "original stop persists the transcript while setup is shown"
  );
  await ui.return();
  assert.equal(editor() === node, true);
  assert.equal(ui.props(editor()).value, "New document draft");
  await ui.wait(() => ui.state.updates.some((w) => w.updates.content === "New document draft"));
  assert.equal(ui.state.recordingStarts, 1);
});

test("same-step requests have fresh setup lifetimes; hidden keyboard cannot replace current chat or open workspace search", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("chat"));
  await ui.wait(() => ui.findAll((n) => n.tagName === "TEXTAREA").length);
  await ui.act(() => ui.state.conversations.onSelectConversation(8));
  await ui.start("cleanup");
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  const first = ui.byAttr("data-setup-instance")[0].attributes["data-setup-instance"];
  const oldComplete = ui.state.flow.onComplete;
  await ui.start("cleanup");
  assert.notEqual(ui.byAttr("data-setup-instance")[0].attributes["data-setup-instance"], first);
  await ui.act(() => oldComplete({ next: { kind: "dictate-note" } }));
  assert.equal(
    ui.byAttr("data-setup-instance").length,
    1,
    "superseded callback cannot return or hand off"
  );
  for (const key of ["n", "k", ","])
    await ui.act(() =>
      globalThis.window.dispatchEvent({ type: "keydown", key, ctrlKey: true, preventDefault() {} })
    );
  assert.equal(ui.state.conversations.activeConversationId, 8);
  assert.equal(ui.state.saves.length, 0);
  await ui.return();
  assert.equal(ui.state.conversations.activeConversationId, 8);
  const intents = await ui.vite.ssrLoadModule("/utils/afterSetupIntent.ts");
  assert.equal(intents.takeAfterSetupIntent(), null);
});

for (const kind of ["dictate-note", "open-settings"])
  test(`retained Panel consumes each ${kind} completion only on return, once per new intent`, async (t) => {
    const ui = await workspace(t);
    const intents = await ui.vite.ssrLoadModule("/utils/afterSetupIntent.ts");
    for (let round = 0; round < 2; round++) {
      await ui.start("finish");
      await ui.wait(() => ui.byAttr("data-setup-instance").length);
      assert.equal(ui.state.saves.length, kind === "dictate-note" ? round : 0);
      await ui.act(() =>
        ui.state.flow.onComplete({
          next: kind === "dictate-note" ? { kind } : { kind, path: "stt/noteRecording" },
        })
      );
      if (kind === "dictate-note") await ui.wait(() => ui.state.saves.length === round + 1);
      else await ui.wait(() => ui.byAttr("data-settings-path", "stt/noteRecording").length);
      assert.equal(intents.takeAfterSetupIntent(), null, "consumed in RAM exactly once");
      await ui.start("cleanup");
      await ui.return();
      assert.equal(
        ui.state.saves.length,
        kind === "dictate-note" ? round + 1 : 0,
        "ordinary return cannot replay"
      );
    }
    if (kind === "dictate-note")
      assert.equal(
        ui.state.recordingStarts,
        1,
        "actual useCreateNote retains the original live recorder on the second intent"
      );
    else assert.equal(ui.state.recordingStarts ?? 0, 0);
  });

test("first launch does not mount workspace, DB/editor or recording consumers before setup completes", async (t) => {
  const ui = await workspace(t, { firstLaunch: true });
  assert.equal(ui.state.nav, undefined);
  assert.equal(ui.state.autoEnd, undefined);
  assert.equal(
    ui.calls.some(([name]) => name === "getSpaces" || name === "getTranscriptions"),
    false
  );
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  await ui.return();
  await ui.wait(() => ui.state.nav);
  assert.equal(typeof ui.state.autoEnd, "function");
});

test("restart supersedes a completion queued before workspace return without replay", async (t) => {
  const ui = await workspace(t);
  await ui.start("finish");
  await ui.wait(() => ui.state.flow);
  await ui.act(() => {
    ui.state.flow.onComplete({ next: { kind: "dictate-note" } });
    globalThis.window.dispatchEvent(
      new CustomEvent("loqui:start-onboarding", { detail: { step: "cleanup" } })
    );
  });
  assert.equal(ui.state.saves.length, 0);
  await ui.return();
  assert.equal(ui.state.saves.length, 0);
});

test("duplicate completion callbacks cannot leave a second intent in the RAM slot", async (t) => {
  const ui = await workspace(t);
  await ui.start("finish");
  await ui.wait(() => ui.state.flow);
  const complete = ui.state.flow.onComplete;
  await ui.act(() => {
    complete({ next: { kind: "open-settings", path: "stt/noteRecording" } });
    complete({ next: { kind: "dictate-note" } });
  });
  await ui.wait(() => ui.byAttr("data-settings-path", "stt/noteRecording").length);
  assert.equal(ui.state.saves.length, 0);
  assert.equal(ui.byAttr("data-settings-path", "stt/noteRecording").length, 1);
  const intents = await ui.vite.ssrLoadModule("/utils/afterSetupIntent.ts");
  assert.equal(intents.takeAfterSetupIntent(), null);
});

test("hidden ChatInput pauses a queued new send while the admitted answer still persists", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("chat"));
  await ui.wait(() => ui.findAll((n) => n.tagName === "TEXTAREA").length);
  const textarea = () => ui.findAll((n) => n.tagName === "TEXTAREA")[0];
  const type = (value) => ui.act(() => ui.props(textarea()).onChange({ target: { value } }));
  const enter = () =>
    ui.act(() =>
      ui.props(textarea()).onKeyDown({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: false, keyCode: 13 },
        preventDefault() {},
      })
    );
  await type("First question");
  await enter();
  await ui.wait(() => ui.state.requests.length === 1);
  await type("Queued question");
  await enter();
  assert.match(ui.text(), /agentMode.input.queued/);
  await ui.start("cleanup");
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  await ui.act(() => ui.state.reply.resolve());
  await ui.wait(() => ui.state.writes.some((w) => w.role === "assistant"));
  assert.equal(ui.state.requests.length, 1, "hidden composer cannot admit the queued next request");
  assert.equal(ui.props(textarea()).value, "Queued question");
  await ui.return();
  await ui.wait(() => ui.state.requests.length === 2);
  assert.equal(
    ui.state.writes.filter((w) => w.role === "user" && w.content === "Queued question").length,
    1
  );
});

test("restart preserves a pending first creation, newer draft and original captured inference", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("chat"));
  await ui.wait(() => ui.findAll((n) => n.tagName === "TEXTAREA").length);
  const textarea = () => ui.findAll((n) => n.tagName === "TEXTAREA")[0];
  ui.state.creation = deferred();
  await ui.act(() => ui.props(textarea()).onChange({ target: { value: "Admitted A" } }));
  await ui.act(() =>
    ui.props(textarea()).onKeyDown({
      key: "Enter",
      shiftKey: false,
      nativeEvent: { isComposing: false, keyCode: 13 },
      preventDefault() {},
    })
  );
  await ui.act(() => ui.props(textarea()).onChange({ target: { value: "Newer unsent draft" } }));
  const node = textarea();
  await ui.start("cleanup");
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  const { useSettingsStore } = await ui.vite.ssrLoadModule("/stores/settingsStore.ts");
  await ui.act(() =>
    useSettingsStore.setState({
      chatAgentMode: "local",
      chatAgentProvider: "ollama",
      chatAgentModel: "different-model",
    })
  );
  await ui.act(() => ui.state.creation.resolve({ id: 7 }));
  await ui.wait(() => ui.state.requests.length === 1);
  assert.equal(ui.state.requests[0][1], "tiny-1b");
  assert.equal(
    ui.state.requests[0][2],
    "lan",
    "admitted inference never retargets across persistence/setup"
  );
  await ui.act(() => ui.state.reply.resolve());
  await ui.wait(() => ui.state.writes.some((w) => w.role === "assistant"));
  await ui.return();
  assert.equal(textarea() === node, true);
  assert.equal(ui.props(textarea()).value, "Newer unsent draft");
  assert.equal(ui.state.conversations.activeConversationId, 7);
  assert.deepEqual(ui.state.writes, [
    { id: 7, role: "user", content: "Admitted A" },
    { id: 7, role: "assistant", content: "first answer" },
  ]);
});

test("live recording return names the workspace and restores its existing chat draft without retargeting", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("chat"));
  await ui.wait(() => ui.findAll((n) => n.tagName === "TEXTAREA").length);
  const textarea = () => ui.findAll((n) => n.tagName === "TEXTAREA")[0];
  await ui.act(() => ui.props(textarea()).onChange({ target: { value: "Keep this draft" } }));
  const node = textarea();
  await ui.act(() =>
    ui.meeting.startRecording({
      noteId: 42,
      noteTitle: "Original",
      folderId: 2,
      seedSegments: [],
      autoEndEligible: true,
    })
  );
  const session = ui.meeting.getActiveRecordingSessionId();
  await ui.start("cleanup");
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  const buttons = [];
  const visit = (n) => {
    if (n.tagName === "BUTTON") buttons.push(n);
    for (const child of n.childNodes ?? []) visit(child);
  };
  visit(globalThis.document.body);
  const control = buttons.find(
    (n) => n.attributes?.["aria-label"] === "setupFlow.ready.openWorkspace"
  );
  assert.ok(control, "the setup companion truthfully offers Open workspace");
  await ui.click(control);
  assert.equal(ui.byAttr("data-setup-instance").length, 0);
  assert.equal(textarea() === node, true);
  assert.equal(ui.props(textarea()).value, "Keep this draft");
  assert.equal(ui.meeting.getActiveRecordingSessionId(), session);
  assert.equal(ui.meeting.useMeetingRecordingStore.getState().isRecording, true);
});

const composer = (ui) => ui.findAll((n) => n.tagName === "TEXTAREA")[0];
async function pendingReadyNote(ui) {
  ui.state.noteSave = deferred();
  await ui.start("finish");
  await ui.wait(() => ui.state.flow);
  await ui.act(() => ui.state.flow.onComplete({ next: { kind: "dictate-note" } }));
  await ui.wait(() => ui.state.saves.length === 1);
}
async function typeDraft(ui, value) {
  const node = composer(ui);
  // The small DOM uses direct handlers: explicitly dispatch React's ancestor
  // capture phase as a browser would, then the real controlled composer change.
  await ui.act(() => {
    const path = [];
    for (let n = node; n; n = n.parentNode) path.unshift(n);
    for (const n of path) ui.props(n)?.onInputCapture?.({ target: node });
    ui.props(node).onChange({ target: { value } });
  });
}
for (const newer of [
  "setup-and-chat",
  "same-chat-draft",
  "workspace-selection",
  "workspace-command",
  "setup-request-boundary",
])
  test(`deferred Ready note saves under A without reclaiming ${newer}`, async (t) => {
    const ui = await workspace(t);
    await ui.act(() => ui.state.nav.onViewChange("chat"));
    await ui.wait(() => composer(ui));
    await ui.act(() => ui.notes.setActiveContext(1, 2));
    await pendingReadyNote(ui);
    let originalSelection = ui.notes.getActiveNoteIdValue();
    if (newer === "setup-and-chat") {
      await ui.start("cleanup");
      await ui.return();
      await ui.act(() => ui.state.nav.onViewChange("chat"));
      await ui.act(() => ui.state.conversations.onSelectConversation(8));
    } else if (newer === "workspace-command") {
      await ui.act(() => ui.state.showSettings());
    } else if (newer === "workspace-selection") {
      await ui.act(() => ui.state.nav.onViewChange("home"));
      await ui.act(() => {
        ui.state.nav.onViewChange("chat");
        ui.notes.setActiveContext(3, 4);
        ui.notes.setActiveNoteId(77);
      });
      originalSelection = 77;
    }
    const expandedBefore = ui.storage.getItem("notesTree.expanded");
    const folderBefore = ui.notes.getActiveFolderIdValue();
    const node = composer(ui);
    if (newer === "setup-and-chat") {
      await typeDraft(ui, "New question B");
      await ui.press(node, "Enter", {
        shiftKey: false,
        nativeEvent: { isComposing: false, keyCode: 13 },
      });
      await ui.wait(() => ui.state.requests.length === 1);
    }
    if (
      newer !== "setup-request-boundary" &&
      newer !== "workspace-selection" &&
      newer !== "workspace-command"
    )
      await typeDraft(ui, "Newer unsent draft");
    const cancels = ui.state.cancels;
    await ui.act(() => {
      if (newer === "setup-request-boundary")
        globalThis.window.dispatchEvent(
          new CustomEvent("loqui:start-onboarding", { detail: { step: "cleanup" } })
        );
      ui.state.noteSave.resolve();
    });
    await ui.wait(() => ui.state.savedNotes.length === 1);
    assert.equal(
      ui.notes.getActiveNoteIdValue(),
      originalSelection,
      "stale save must not select A"
    );
    assert.equal(ui.state.recordingStarts ?? 0, 0, "stale save cannot automatically start capture");
    assert.equal(
      ui.notes.getActiveFolderIdValue(),
      folderBefore,
      "stale save cannot change context"
    );
    assert.equal(
      ui.storage.getItem("notesTree.expanded"),
      expandedBefore,
      "stale save cannot reveal A"
    );
    assert.equal(composer(ui) === node, true, "new Chat owner must stay mounted");
    assert.equal(ui.state.cancels, cancels);
    if (
      newer !== "setup-request-boundary" &&
      newer !== "workspace-selection" &&
      newer !== "workspace-command"
    )
      assert.equal(ui.props(node).value, "Newer unsent draft");
    if (newer === "setup-and-chat") {
      await ui.act(() => ui.state.reply.resolve());
      await ui.wait(() => ui.state.writes.some((w) => w.role === "assistant"));
      assert.deepEqual(ui.state.writes, [
        { id: 8, role: "user", content: "New question B" },
        { id: 8, role: "assistant", content: "first answer" },
      ]);
      assert.equal(ui.props(node).value, "Newer unsent draft");
    }
    assert.deepEqual(ui.state.saves[0].slice(5), [2, 1], "A retains its admitted container");
    assert.equal(ui.state.savedNotes[0].id, 99, "A's data save still completes");
  });

for (const kind of ["note", "meeting"])
  test(`pending ${kind} event expires Ready activation before its deferred getter replies`, async (t) => {
    const ui = await workspace(t);
    await ui.act(() => ui.state.nav.onViewChange("chat"));
    await ui.wait(() => composer(ui));
    await ui.act(() => ui.state.conversations.onSelectConversation(8));
    await typeDraft(ui, "Original unsent draft");
    await ui.act(() => ui.notes.setActiveContext(1, 2));
    const node = composer(ui);
    await pendingReadyNote(ui);
    const navigation = ui.state.navigation[kind];
    const reply = deferred();
    let replied = false;
    navigation.replies.push(reply);
    const reads = navigation.reads;
    const selected = ui.notes.getActiveNoteIdValue();
    const folder = ui.notes.getActiveFolderIdValue();
    const expanded = ui.storage.getItem("notesTree.expanded");
    const cancels = ui.state.cancels;
    const session = ui.meeting.getActiveRecordingSessionId();
    const recordingNote = ui.meeting.useMeetingRecordingStore.getState().recordingNoteId;
    assert.equal(ui.meeting.useMeetingRecordingStore.getState().isRecording, false);
    assert.equal(navigation.listeners.size, 1, "real StrictMode subscription is installed once");
    assert.equal(ui.state.savedNotes.length, 0, "A is consumed but its save is pending");

    // The only new workspace command is the actual no-argument IPC signal.
    // No DOM capture, setup request or manual generation invalidation intervenes.
    await ui.act(() => ui.emitNavigation(kind));
    assert.equal(navigation.reads, reads + 1, "registered callback invoked the actual getter");
    await ui.act(() => ui.state.noteSave.resolve());
    await ui.wait(() => ui.state.savedNotes.length === 1);
    assert.equal(replied, false, "B's payload is still pending when A finishes");
    assert.deepEqual(ui.state.saves[0].slice(5), [2, 1]);
    assert.equal(ui.state.savedNotes[0].id, 99, "A's original data save really completed");
    assert.equal(ui.state.savedNotes[0].folder_id, 2);
    assert.equal(ui.state.savedNotes[0].space_id, 1);
    assert.equal(ui.notes.getActiveNoteIdValue(), selected, "A cannot select itself");
    assert.equal(ui.notes.getActiveFolderIdValue(), folder, "A cannot change context");
    assert.equal(ui.storage.getItem("notesTree.expanded"), expanded, "A cannot reveal itself");
    assert.equal(ui.state.recordingStarts ?? 0, 0, "A cannot automatically start capture");
    assert.equal(ui.meeting.getActiveRecordingSessionId(), session);
    assert.equal(ui.meeting.useMeetingRecordingStore.getState().recordingNoteId, recordingNote);
    assert.equal(composer(ui) === node, true, "A cannot activate Notes or unmount Chat");
    assert.equal(ui.props(node).value, "Original unsent draft");
    assert.equal(ui.state.conversations.activeConversationId, 8);
    assert.equal(ui.state.requests.length, 0);
    assert.equal(ui.state.cancels, cancels);

    await ui.act(() => {
      replied = true;
      reply.resolve({
        noteId: 42,
        folderId: 2,
        event: { summary: "Meeting B" },
        trigger: "hotkey",
      });
    });
    await ui.wait(() => ui.notes.getActiveNoteIdValue() === 42);
    await ui.wait(() => ui.byAttr("data-document-editor").length);
    assert.equal(ui.notes.getActiveFolderIdValue(), 2);
    if (kind === "meeting") {
      await ui.wait(() => ui.state.recordingStarts === 1);
      assert.equal(ui.meeting.useMeetingRecordingStore.getState().recordingNoteId, 42);
      assert.equal(ui.meeting.useMeetingRecordingStore.getState().isRecording, true);
    } else {
      assert.equal(
        ui.state.recordingStarts ?? 0,
        0,
        "ordinary note navigation does not start recording"
      );
    }
    await ui.unmount();
    assert.equal(navigation.listeners.size, 0, "event subscription is disposed");
  });

for (const entry of ["initial", "return"])
  test(`empty ${entry} navigation drains preserve a valid Ready note activation`, async (t) => {
    const ui = await workspace(t, { firstLaunch: entry === "initial" });
    if (entry === "return") await ui.start("finish");
    const replies = [deferred(), deferred()];
    for (const [index, kind] of ["note", "meeting"].entries())
      ui.state.navigation[kind].replies.push(replies[index]);
    const reads = [ui.state.navigation.note.reads, ui.state.navigation.meeting.reads];
    ui.state.noteSave = deferred();
    await ui.wait(() => ui.state.flow);
    await ui.act(() => ui.state.flow.onComplete({ next: { kind: "dictate-note" } }));
    await ui.wait(() => ui.state.saves.length === 1);
    for (const [index, kind] of ["note", "meeting"].entries()) {
      assert.ok(ui.state.navigation[kind].reads > reads[index], "actual entry getter ran");
      assert.equal(ui.state.navigation[kind].listeners.size, 1);
    }
    await ui.act(() => replies.forEach((reply) => reply.resolve(null)));
    await ui.act(() => ui.state.noteSave.resolve());
    await ui.wait(() => ui.state.recordingStarts === 1);
    assert.equal(ui.notes.getActiveNoteIdValue(), 99);
    assert.equal(ui.meeting.useMeetingRecordingStore.getState().recordingNoteId, 99);
    assert.equal(ui.state.savedNotes.length, 1);
    assert.equal(ui.state.saves.length, 1, "StrictMode/return does not replay Ready");
  });

for (const kind of ["note", "meeting"])
  test(`pending ${kind} payload arriving during setup stages for ordinary return`, async (t) => {
    const ui = await workspace(t);
    const navigation = ui.state.navigation[kind];
    const reply = deferred();
    navigation.replies.push(reply);
    await ui.act(() => ui.emitNavigation(kind));
    await ui.start("cleanup");
    assert.equal(navigation.listeners.size, 0, "hidden workspace unsubscribes");
    const reads = navigation.reads;
    const selected = ui.notes.getActiveNoteIdValue();
    await ui.act(() => reply.resolve({ noteId: 42, folderId: 2, event: { summary: "B" } }));
    assert.equal(ui.notes.getActiveNoteIdValue(), selected, "hidden delivery only stages");
    assert.equal(ui.state.recordingStarts ?? 0, 0);
    await ui.return();
    await ui.wait(() => ui.byAttr("data-document-editor").length);
    assert.equal(ui.notes.getActiveNoteIdValue(), 42);
    assert.equal(
      navigation.reads,
      reads,
      "return consumes the retained payload without another getter"
    );
    assert.equal(navigation.listeners.size, 1, "return installs one listener");
    if (kind === "meeting") {
      await ui.wait(() => ui.state.recordingStarts === 1);
      assert.equal(ui.meeting.useMeetingRecordingStore.getState().recordingNoteId, 42);
    } else assert.equal(ui.state.recordingStarts ?? 0, 0);
    await ui.unmount();
    assert.equal(navigation.listeners.size, 0, "unmount disposes the listener");
  });

test("deferred Ready note with no newer interaction selects and starts exactly once", async (t) => {
  const ui = await workspace(t);
  await pendingReadyNote(ui);
  await ui.act(() => ui.state.noteSave.resolve());
  await ui.wait(() => ui.state.recordingStarts === 1);
  assert.equal(ui.state.saves.length, 1);
  assert.equal(ui.notes.getActiveNoteIdValue(), 99);
  assert.equal(ui.meeting.useMeetingRecordingStore.getState().recordingNoteId, 99);
  await ui.start("cleanup");
  await ui.return();
  assert.equal(ui.state.saves.length, 1);
  assert.equal(ui.state.recordingStarts, 1);
});

test("deferred Ready note respects a recorder that became live during its save", async (t) => {
  const ui = await workspace(t);
  await pendingReadyNote(ui);
  await ui.act(() =>
    ui.meeting.startRecording({ noteId: 42, noteTitle: "Original", folderId: 2, seedSegments: [] })
  );
  const session = ui.meeting.getActiveRecordingSessionId();
  await ui.act(() => ui.state.noteSave.resolve());
  await ui.wait(() => ui.state.savedNotes.length === 1);
  assert.equal(ui.notes.getActiveNoteIdValue(), 99);
  assert.equal(ui.state.recordingStarts, 1);
  assert.equal(ui.meeting.getActiveRecordingSessionId(), session);
  assert.equal(ui.meeting.useMeetingRecordingStore.getState().recordingNoteId, 42);
});

for (const checkSearch of [true, false])
  test(`actual retained Settings ${checkSearch ? "gates search" : "applies every Ready destination including identical sub-tabs"}`, async (t) => {
    const ui = await workspace(t, { realSettings: true });
    await ui.act(() => ui.state.nav.onOpenSettings());
    await ui.wait(() => ui.byAttr("data-settings-section").length);
    await ui.click("speechToText");
    await ui.wait(() => ui.text().includes("settingsPage.reviewSetup.title"));
    const search = ui.findAll((n) => n.tagName === "INPUT")[0];
    const { useRouteDraftStore } = await ui.vite.ssrLoadModule("/stores/routeDraftStore.ts");
    const draft = {
      routeId: "chat",
      kind: "patch",
      patch: { azureEndpoint: "https://fixture.invalid" },
    };
    await ui.act(() => useRouteDraftStore.getState().stage(draft));
    const requestEpoch = useRouteDraftStore.getState().requestEpoch;
    for (let round = 0; round < 2; round++) {
      // Actual SettingsPage Review setup caller, with modal logically open.
      await ui.click("settingsPage.reviewSetup.title");
      await ui.wait(() => ui.byAttr("data-setup-instance").length);
      let prevented = false;
      await ui.act(() => {
        for (const cb of ui.state.documentListeners.get("keydown") ?? [])
          cb({
            key: "f",
            ctrlKey: true,
            target: { tagName: "DIV" },
            preventDefault() {
              prevented = true;
            },
          });
      });
      if (checkSearch)
        assert.equal(prevented, false, "inactive actual Settings search must not consume Ctrl+F");
      await ui.act(() =>
        ui.state.flow.onComplete({ next: { kind: "open-settings", path: "stt/noteRecording" } })
      );
      assert.equal(
        JSON.parse(ui.storage.getItem("settings.speechToTextTab")),
        "noteRecording",
        "actual retained useSubTab must apply the Ready path"
      );
      assert.equal(ui.byAttr("data-settings-section", "speechToText").length, 1);
      const selected = ui.findAll((n) => n.attributes?.["aria-selected"] === "true");
      assert.equal(
        selected.some((n) => n.textContent.includes("tabs.noteRecording")),
        true,
        "real useSubTab renders requested destination"
      );
      assert.equal(
        ui.findAll((n) => n.tagName === "INPUT")[0] === search,
        true,
        "modal subtree is retained"
      );
      assert.equal(
        useRouteDraftStore.getState().draft === draft,
        true,
        "retained Settings keeps its route draft"
      );
      assert.equal(
        useRouteDraftStore.getState().requestEpoch,
        requestEpoch,
        "hiding setup never ends the Settings draft session"
      );
      await ui.click("settingsPage.speechToText.tabs.dictation");
      assert.equal(JSON.parse(ui.storage.getItem("settings.speechToTextTab")), "dictation");
    }
  });

test("original assistant completion during A's deferred save does not expire A activation", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("chat"));
  await ui.wait(() => composer(ui));
  await typeDraft(ui, "Original admitted question");
  await ui.press(composer(ui), "Enter", {
    shiftKey: false,
    nativeEvent: { isComposing: false, keyCode: 13 },
  });
  await ui.wait(() => ui.state.requests.length === 1);
  await pendingReadyNote(ui);
  await ui.act(() => ui.state.reply.resolve());
  await ui.wait(() => ui.state.writes.some((w) => w.role === "assistant"));
  await ui.act(() => ui.state.noteSave.resolve());
  await ui.wait(() => ui.state.recordingStarts === 1);
  assert.equal(ui.notes.getActiveNoteIdValue(), 99);
  assert.deepEqual(ui.state.writes, [
    { id: 7, role: "user", content: "Original admitted question" },
    { id: 7, role: "assistant", content: "first answer" },
  ]);
});
