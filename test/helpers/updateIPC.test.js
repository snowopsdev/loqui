const { test } = require("node:test");
const assert = require("node:assert/strict");
const { trackUpdateActivity } = require("../../src/helpers/updateIPC");
test("restart lock blocks new recording/generation/download work but permits saves", async () => {
  const handlers = new Map();
  const ipc = { handle: (name, fn) => handlers.set(name, fn) };
  const activity = trackUpdateActivity(ipc);
  for (const name of [
    "acquire-recording-lock",
    "personal-inference:text-generate",
    "download-model",
    "update-note",
  ])
    ipc.handle(name, async () => true);
  activity.lock(true);
  for (const name of [
    "acquire-recording-lock",
    "personal-inference:text-generate",
    "download-model",
  ])
    await assert.rejects(handlers.get(name)({}), /preparing to restart/);
  assert.equal(await handlers.get("update-note")({}), true);
});
test("in-flight processing remains busy through completion", async () => {
  const handlers = new Map();
  let finish;
  const ipc = { handle: (name, fn) => handlers.set(name, fn) };
  const tracked = trackUpdateActivity(ipc);
  ipc.handle(
    "transcribe-audio",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const pending = handlers.get("transcribe-audio")({});
  assert.equal(tracked.busy(), true);
  finish();
  await pending;
  assert.equal(tracked.busy(), false);
});
