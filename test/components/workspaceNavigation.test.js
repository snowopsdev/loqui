const assert = require("node:assert/strict");
const test = require("node:test");
const { React, renderStatic } = require("../helpers/harness/reactSsr");

const load = () => import("../../src/components/workspaceNavigation.tsx");

test("without a provider the navigation is inert, never undefined", async () => {
  const { useWorkspaceNavigation, INERT_WORKSPACE_NAVIGATION } = await load();
  let seen;
  const Probe = () => {
    seen = useWorkspaceNavigation();
    return null;
  };
  renderStatic(Probe, null);
  assert.equal(seen, INERT_WORKSPACE_NAVIGATION);
  assert.doesNotThrow(() => seen.openNote(1));
});

test("a provider value reaches deep consumers", async () => {
  const { useWorkspaceNavigation, WorkspaceNavigationProvider, INERT_WORKSPACE_NAVIGATION } =
    await load();
  const opened = [];
  const value = { ...INERT_WORKSPACE_NAVIGATION, openNote: (id) => opened.push(id) };
  const Probe = () => {
    useWorkspaceNavigation().openNote(17);
    return null;
  };
  renderStatic(WorkspaceNavigationProvider, { value }, React.createElement(Probe));
  assert.deepEqual(opened, [17]);
});
