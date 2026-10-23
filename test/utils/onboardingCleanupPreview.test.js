const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingCleanupPreview.ts");
const examples = {
  original: "um let's send the draft to maya before lunch",
  local: "Let's send the draft to Maya before lunch.",
  codex: "Let's send the draft to Maya before lunch.",
  provider: "Let's send Maya the draft before lunch.",
};
const route = (state, locality = "remote") => ({
  id: "dictationCleanup",
  locality,
  providerId: "openai",
  state,
  settingsPath: "llms/dictationCleanup",
});

test("changed words are marked against the original", async () => {
  const { diffWords } = await load();
  assert.deepEqual(diffWords(examples.original, examples.local), [
    { text: "Let's", changed: true },
    { text: "send", changed: false },
    { text: "the", changed: false },
    { text: "draft", changed: false },
    { text: "to", changed: false },
    { text: "Maya", changed: true },
    { text: "before", changed: false },
    { text: "lunch.", changed: true },
  ]);
  assert.deepEqual(diffWords("same words", "same words"), [
    { text: "same", changed: false },
    { text: "words", changed: false },
  ]);
  assert.deepEqual(diffWords("", ""), []);
});

test("word counts ignore extra whitespace", async () => {
  const { countWords } = await load();
  assert.equal(countWords("  um   hi there "), 3);
  assert.equal(countWords("um remind me to book the room"), 7);
  assert.equal(countWords(""), 0);
});

test("None shows your words unchanged", async () => {
  const { cleanupPreview } = await load();
  const preview = cleanupPreview({ choice: "none", userText: "um hi", run: null, examples });
  assert.deepEqual(
    [preview.original, preview.source, preview.locality, preview.wordsSent],
    ["um hi", "yours", null, null]
  );
  assert.ok(preview.segments.every((segment) => !segment.changed));
});

test("your own sentence appears only after a run really happened, with where it ran", async () => {
  const { cleanupPreview } = await load();
  const local = cleanupPreview({
    choice: "local",
    userText: "um hi there",
    run: { text: "Hi there.", locality: "device" },
    examples,
  });
  assert.deepEqual(
    [local.original, local.source, local.locality, local.wordsSent],
    ["um hi there", "yours", "device", null]
  );
  const waiting = cleanupPreview({ choice: "local", userText: "um hi there", run: null, examples });
  assert.deepEqual([waiting.original, waiting.source], [examples.original, "example"]);
  const consented = cleanupPreview({
    choice: "codex",
    userText: "um remind me to book the room",
    run: { text: "Remind me to book the room.", locality: "remote" },
    examples,
  });
  assert.deepEqual(
    [consented.source, consented.locality, consented.wordsSent],
    ["yours", "remote", 7]
  );
});

test("before consent, remote options show the example and count what would leave", async () => {
  const { cleanupPreview } = await load();
  const codex = cleanupPreview({
    choice: "codex",
    userText: "um remind me to book the room",
    run: null,
    examples,
  });
  assert.deepEqual([codex.source, codex.locality, codex.wordsSent], ["example", "remote", 7]);
  const noTrial = cleanupPreview({ choice: "provider", userText: null, run: null, examples });
  assert.equal(noTrial.wordsSent, 9, "without a trial, the example's own words are counted");
});

test("the situation follows the user's choice and its check, then the active route (I05)", async () => {
  const { cleanupSituation } = await load();
  const off = route({ status: "off" });
  assert.equal(cleanupSituation("none", "skipped", off), "off");
  assert.equal(cleanupSituation("provider", "checking", off), "checking");
  assert.equal(
    cleanupSituation("provider", "failed", off),
    "needsKey",
    "chosen but not available is not 'off'"
  );
  assert.equal(cleanupSituation("codex", "failed", off), "needsConnection");
  assert.equal(
    cleanupSituation("local", "pending", route({ status: "off" }, "device")),
    "needsModel"
  );
  assert.equal(cleanupSituation("provider", "ready", route({ status: "ready" })), "ready");
  assert.equal(
    cleanupSituation("provider", "ready", route({ status: "needsKey", provider: "openai" })),
    "needsKey"
  );
  assert.equal(
    cleanupSituation("local", "ready", route({ status: "needsModel" }, "device")),
    "needsModel"
  );
  assert.equal(cleanupSituation("codex", "ready", route({ status: "unreachable" })), "unreachable");
  assert.equal(
    cleanupSituation("provider", "ready", route({ status: "unknown" })),
    "checking",
    "§5.1 rule 1: unknown is never ready"
  );
});
