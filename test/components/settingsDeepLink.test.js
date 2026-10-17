const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

test("only Plan 03's settingsPath grammar is accepted", async () => {
  const { parseSettingsDeepLink } = await import("../../src/utils/settingsDeepLink.ts");
  assert.equal(
    parseSettingsDeepLink({ id: "settings-link-1", path: "llms/dictationCleanup" }),
    "llms/dictationCleanup"
  );
  assert.equal(parseSettingsDeepLink({ path: "privacyData" }), "privacyData");
  for (const bad of [
    null,
    {},
    { path: "" },
    { path: null },
    { path: "../x" },
    { path: "a/b/c" },
    { path: "javascript:alert(1)" },
    { path: 7 },
  ]) {
    assert.equal(parseSettingsDeepLink(bad), undefined, JSON.stringify(bad));
  }
});

test("ControlPanel subscribes through the acknowledged deep-link subscriber", () => {
  const panel = read("src/components/ControlPanel.tsx");
  assert.match(
    panel,
    /subscribeSettingsDeepLinks\(window\.electronAPI, \(section\) => \{\s*setSettingsSection\(section\);\s*setShowSettings\(true\);/
  );
  assert.doesNotMatch(panel, /onShowSettings\?\.\(\(\) =>/);
  // An already-open modal must move to the new section too.
  assert.match(read("src/components/SettingsModal.tsx"), /useEffect\(\(\) => \{\s*if \(open\)/);
});

test("deep links use the production section parser and known route sub-tab names", async () => {
  const { parseSettingsDeepLink } = await import("../../src/utils/settingsDeepLink.ts");
  const { parseSettingsPath } = await import("../../src/lib/settingsPaths.ts");
  assert.deepEqual(parseSettingsPath(parseSettingsDeepLink({ path: "llms/dictationCleanup" })), {
    section: "llms",
    subTab: "dictationCleanup",
  });
  assert.deepEqual(parseSettingsPath(parseSettingsDeepLink({ path: "privacyData" })), {
    section: "privacyData",
  });
});

test("disposal before pending lookup settles never acknowledges or opens", async () => {
  const { subscribeSettingsDeepLinks } = await import("../../src/utils/settingsDeepLink.ts");
  let deliver;
  const acks = [],
    opened = [];
  const dispose = subscribeSettingsDeepLinks(
    {
      onShowSettings: () => () => {},
      pendingSettingsLink: () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
      ackSettingsLink: async (id) => {
        acks.push(id);
        return true;
      },
    },
    (section) => opened.push(section)
  );
  dispose();
  deliver({ id: "late", path: "general" });
  await new Promise(setImmediate);
  assert.deepEqual(acks, []);
  assert.deepEqual(opened, []);
});

test("disposed and replaced in-flight acknowledgments cannot reopen old Settings", async () => {
  const { subscribeSettingsDeepLinks } = await import("../../src/utils/settingsDeepLink.ts");
  let push;
  const answers = new Map(),
    opened = [];
  const dispose = subscribeSettingsDeepLinks(
    {
      onShowSettings: (listener) => {
        push = listener;
        return () => {};
      },
      ackSettingsLink: (id) => new Promise((resolve) => answers.set(id, resolve)),
    },
    (section) => opened.push(section)
  );
  push({ id: "old", path: "general" });
  await new Promise(setImmediate);
  push({ id: "new", path: "llms/dictationCleanup" });
  await new Promise(setImmediate);
  answers.get("new")(true);
  await new Promise(setImmediate);
  answers.get("old")(true);
  await new Promise(setImmediate);
  assert.deepEqual(opened, ["llms/dictationCleanup"]);
  push({ id: "disposed", path: "general" });
  await new Promise(setImmediate);
  dispose();
  answers.get("disposed")(true);
  await new Promise(setImmediate);
  assert.deepEqual(opened, ["llms/dictationCleanup"]);
});

test("an old rejected push cannot suppress a current acknowledgment that is still pending", async () => {
  const { subscribeSettingsDeepLinks } = await import("../../src/utils/settingsDeepLink.ts");
  let push, answer;
  const opened = [];
  const dispose = subscribeSettingsDeepLinks(
    {
      onShowSettings: (listener) => {
        push = listener;
        return () => {};
      },
      ackSettingsLink: (id) =>
        id === "current"
          ? new Promise((resolve) => {
              answer = resolve;
            })
          : Promise.resolve(false),
    },
    (section) => opened.push(section)
  );
  push({ id: "current", path: "llms/dictationCleanup" });
  await new Promise(setImmediate);
  push({ id: "stale", path: "general" });
  await new Promise(setImmediate);
  answer(true);
  await new Promise(setImmediate);
  assert.deepEqual(opened, ["llms/dictationCleanup"]);
  dispose();
});
