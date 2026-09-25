const test = require("node:test");
const assert = require("node:assert/strict");

test("an accepted local meeting start leaves meeting mode active and clears its request", async () => {
  const { handleMeetingRecordingRequest } =
    await import("../../src/helpers/meetingRecordingRequest.ts");
  const lifecycle = [];
  await handleMeetingRecordingRequest({
    args: { noteId: 41, noteTitle: "Local meeting", folderId: 7 },
    startRecording: async () => true,
    restoreFromMeetingMode: () => lifecycle.push("restored"),
    onHandled: () => lifecycle.push("handled"),
  });
  assert.deepEqual(lifecycle, ["handled"]);
});

test("a meeting start exception clears the pending request and preserves the error", async () => {
  const { handleMeetingRecordingRequest } =
    await import("../../src/helpers/meetingRecordingRequest.ts");
  const lifecycle = [];
  await assert.rejects(
    handleMeetingRecordingRequest({
      args: { noteId: 42, noteTitle: "Local meeting", folderId: null },
      startRecording: async () => {
        throw new Error("Audio device unavailable");
      },
      restoreFromMeetingMode: () => lifecycle.push("restored"),
      onHandled: () => lifecycle.push("handled"),
    }),
    /Audio device unavailable/
  );
  assert.deepEqual(lifecycle, ["handled"]);
});
