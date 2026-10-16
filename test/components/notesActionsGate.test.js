const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const view = fs.readFileSync(
  path.join(__dirname, "../../src/components/notes/PersonalNotesView.tsx"),
  "utf8"
);
const load = () => import("../../src/components/notes/shared.ts");
const loadReadiness = () => import("../../src/utils/noteActionsReadiness.ts");

test("a fresh profile's default local model is selected but not ready", async () => {
  const { noteActionsReadiness } = await loadReadiness();
  const fresh = { mode: "local", model: "qwen3.5-2b-q4_k_m", remoteUrl: "" };
  assert.equal(noteActionsReadiness(fresh, new Set()), false, "selected, not on disk");
  assert.equal(noteActionsReadiness(fresh, new Set(["qwen3.5-2b-q4_k_m"])), true);
  assert.equal(noteActionsReadiness(fresh, null), null, "still checking: no hint yet");
});

test("self-hosted needs a URL; an empty model is never ready; remote is unknown", async () => {
  const { noteActionsReadiness } = await loadReadiness();
  assert.equal(
    noteActionsReadiness({ mode: "self-hosted", model: "m", remoteUrl: " " }, null),
    false
  );
  assert.equal(
    noteActionsReadiness(
      { mode: "self-hosted", model: "m", remoteUrl: "http://localhost:11434/v1" },
      null
    ),
    true
  );
  assert.equal(noteActionsReadiness({ mode: "local", model: "", remoteUrl: "" }, new Set()), false);
  assert.equal(
    noteActionsReadiness({ mode: "providers", model: "gpt", remoteUrl: "" }, null),
    null
  );
});

test("the hint shows only when Actions cannot run, and until dismissed", async () => {
  const { shouldShowActionsModelHint, NOTES_ACTIONS_MODEL_HINT_KEY } = await load();
  assert.equal(NOTES_ACTIONS_MODEL_HINT_KEY, "notesActionsModelHintDismissed");
  assert.equal(shouldShowActionsModelHint(false, false), true);
  assert.equal(shouldShowActionsModelHint(true, false), false);
  assert.equal(shouldShowActionsModelHint(null, false), false, "unknown is not a reason to nag");
  assert.equal(shouldShowActionsModelHint(false, true), false);
});

test("notes render without passing through the Actions first run", () => {
  assert.doesNotMatch(view, /if \(!isOnboardingComplete\) \{\s*return/);
});

test("Actions opens the first run once, then the manager, from any view", () => {
  assert.equal(view.match(/<ActionManagerDialog\b/g)?.length, 1, "one manager dialog");
  assert.ok(
    view.indexOf("<ActionManagerDialog") > view.indexOf("<ContainerOverview"),
    "the manager is outside the editor-only branch"
  );
  assert.match(
    view,
    /<DialogContent[\s\S]*?<NotesOnboarding onComplete=\{finishActionsIntro\} \/>/
  );
  assert.equal(
    view.match(/setShowActionManager\(true\)/g)?.length,
    2,
    "openActions and finishActionsIntro"
  );
  assert.match(view, /onManageActions=\{openActions\}/);
});

test("the hint links to model settings and can be dismissed", () => {
  assert.match(view, /const noteActionsReady = useNoteActionsReady\(\);/);
  assert.match(view, /shouldShowActionsModelHint\(noteActionsReady, modelHintDismissed\)/);
  assert.doesNotMatch(view, /ring-ring\/\d+/, "full-opacity focus rings (Task 3)");
  assert.match(view, /onOpenSettings\("intelligence"\)/);
  assert.match(view, /localStorage\.setItem\(NOTES_ACTIONS_MODEL_HINT_KEY, "true"\)/);
});
