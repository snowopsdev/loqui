const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const view = fs.readFileSync(
  path.join(__dirname, "../../src/components/notes/PersonalNotesView.tsx"),
  "utf8"
);
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
