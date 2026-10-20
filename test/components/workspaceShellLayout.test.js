const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");

test("Notes no longer adds a second navigation column", () => {
  const notes = read("src/components/notes/PersonalNotesView.tsx");
  assert.doesNotMatch(notes, /<SpacesTree/);
  assert.doesNotMatch(notes, /width: isSidePanelLayout \? 0 : "13rem"/);
  assert.match(read("src/components/ControlPanelSidebar.tsx"), /<SpacesTree/);
});

test("the title column keeps at least 120px (WS-Q2)", () => {
  assert.match(
    read("src/components/ControlPanelTopBar.tsx"),
    /grid-cols-\[minmax\(120px,1fr\)_minmax\(0,340px\)_minmax\(max-content,1fr\)\]/
  );
});

test("the sidebar footer carries the mic card and the edge carries the capture rail", () => {
  const sidebar = read("src/components/ControlPanelSidebar.tsx");
  assert.match(sidebar, /<MicStatusCard/);
  assert.match(sidebar, /<CaptureRail/);
});

test("the new sidebar keeps Plan 02's full-opacity focus rings (I14)", () => {
  const sidebar = read("src/components/ControlPanelSidebar.tsx");
  assert.ok((sidebar.match(/focus-visible:ring-2 focus-visible:ring-ring"/g) ?? []).length >= 3);
  assert.doesNotMatch(sidebar, /ring-(?:ring|primary)\/\d+/);
});

test("hover peek is gone; collapse is a rail", () => {
  const panel = read("src/components/ControlPanel.tsx");
  assert.doesNotMatch(panel, /sidebarPeek|showSidebarPeek|SIDEBAR_WIDTH_PX/);
  assert.match(panel, /sidebarWidth\(sidebarMode\)/);
});

test("one capture owner supplies both controls and hidden navigation is inert", () => {
  const panel = read("src/components/ControlPanel.tsx");
  const sidebar = read("src/components/ControlPanelSidebar.tsx");
  assert.equal((panel.match(/useCaptureStatus\(\)/g) ?? []).length, 1);
  assert.equal((panel.match(/<CaptureControl\b/g) ?? []).length, 1);
  assert.equal((panel.match(/capture=\{capture\}/g) ?? []).length, 3);
  assert.match(panel, /<HistoryView[\s\S]*?capture=\{capture\}/);
  assert.doesNotMatch(read("src/components/HistoryView.tsx"), /useCaptureStatus\(\)/);
  assert.match(panel, /inert=\{sidebarMode === "hidden"\}/);
  assert.doesNotMatch(sidebar, /useCaptureStatus\(\)/);
  assert.match(sidebar, /navigation.openNote\(note.id\)/);
  assert.match(sidebar, /onOpenSettings\(route.settingsPath\)/);
  assert.doesNotMatch(sidebar, /routes this capture really takes|actual recipient/);
});
