const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { mountComponent } = require("../helpers/harness/mountComponent");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");

test("Check for Updates is not disabled by turning automatic updates off", () => {
  const ui = read("src/components/settings/UpdateSettings.tsx");
  assert.doesNotMatch(ui, /!status\?\.enabled/);
  // Sealed mode (Task 14) also disables it; automatic updates never do.
  assert.match(
    ui,
    /disabled=\{!status \|\| sealed \|\| \["checking", "downloading"\]\.includes\(status\.phase\)\}/
  );
});

test("an available update offers the GitHub download and names the version", () => {
  const ui = read("src/components/settings/UpdateSettings.tsx");
  assert.match(
    ui,
    /status\?\.phase === "available" && \(\s*<p>\{t\("updates\.available", \{ version: status\.availableVersion \}\)\}<\/p>/
  );
  assert.match(ui, /status\?\.phase === "manual" \|\| status\?\.phase === "available" \?/);
  assert.match(read("src/types/updates.ts"), /"available"/);
});

test("no physical margin remains in the update controls", () => {
  assert.doesNotMatch(read("src/components/settings/UpdateSettings.tsx"), /\bml-2\b/);
});

test("the privacy doc explains the manual check with automatic updates off", () => {
  assert.match(
    read("docs/PRIVACY.md"),
    /With automatic updates off, \*\*Check for Updates\*\* still works/
  );
});

// ---- Sealed mode (Task 14; handed in from Task 10) --------------------------

const status = (over = {}) => ({
  phase: "idle",
  enabled: true,
  channel: "stable",
  version: "1.0.0",
  busy: false,
  supported: true,
  releasesUrl: "https://github.com/example/loqui/releases",
  sealed: false,
  ...over,
});

async function mountUpdates(t, current, { check, restart } = {}) {
  const calls = { check: 0, restart: 0, openExternal: [] };
  const api = {
    updates: {
      status: () => Promise.resolve(current),
      onStatus: () => () => {},
      preferences: () => Promise.resolve(current),
      check: () => {
        calls.check += 1;
        return check ? check() : Promise.resolve(current);
      },
      restart: () => {
        calls.restart += 1;
        return restart ? restart() : Promise.resolve();
      },
    },
    openExternal: (url) => {
      calls.openExternal.push(url);
      return Promise.resolve();
    },
  };
  const ui = await mountComponent(t, "/components/settings/UpdateSettings.tsx", { api });
  await React.act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  });
  return { ui, calls };
}

const button = (ui, label) =>
  ui.find((node) => node.tagName === "BUTTON" && node.textContent === label);

test("sealed: the panel says updates are paused and Check for Updates is disabled", async (t) => {
  const { ui } = await mountUpdates(t, status({ sealed: true }));
  assert.ok(ui.text().includes("updates.sealed"));
  assert.equal(ui.props(button(ui, "updates.check")).disabled, true);
});

test("unsealed: no sealed note, and Check for Updates works", async (t) => {
  const { ui, calls } = await mountUpdates(t, status());
  assert.equal(ui.text().includes("updates.sealed"), false);
  assert.equal(ui.props(button(ui, "updates.check")).disabled, false);
  await ui.click(button(ui, "updates.check"));
  assert.equal(calls.check, 1);
});

test("sealed: an update already found stays available with its GitHub download (D13)", async (t) => {
  const { ui, calls } = await mountUpdates(
    t,
    status({ sealed: true, phase: "available", availableVersion: "1.2.0" })
  );
  assert.ok(ui.text().includes("updates.available(version=1.2.0)"));
  assert.ok(ui.text().includes("updates.sealed"));
  await ui.click(button(ui, "updates.download"));
  assert.deepEqual(calls.openExternal, ["https://github.com/example/loqui/releases"]);
});

test("sealed: a ready update cannot be installed until Sealed mode is off", async (t) => {
  const { ui } = await mountUpdates(
    t,
    status({ sealed: true, phase: "ready", availableVersion: "1.2.0" })
  );
  assert.equal(ui.props(button(ui, "updates.restart")).disabled, true);
});

for (const [action, message] of [
  [
    "check",
    "Error invoking remote method 'update:check': Error: [SEALED_MODE] appUpdate to github.com blocked; nothing was sent.",
  ],
  ["restart", "Error invoking remote method 'update:restart': Error: NATIVE_BOUNDARY_UNAVAILABLE"],
]) {
  test(`a sealed ${action} refusal shows translated copy, never main's raw error text`, async (t) => {
    const { ui } = await mountUpdates(
      t,
      status({ phase: action === "restart" ? "ready" : "idle" }),
      {
        check: () => Promise.reject(new Error(message)),
        restart: () => Promise.reject(new Error(message)),
      }
    );
    await ui.click(button(ui, `updates.${action}`));
    await React.act(async () => new Promise((resolve) => setImmediate(resolve)));
    const alert = ui.find((node) => node.attributes?.role === "alert");
    assert.ok(alert, message);
    assert.equal(alert.textContent, "updates.sealedRefused");
    assert.equal(ui.text().includes("SEALED_MODE"), false);
    assert.equal(ui.text().includes("NATIVE_BOUNDARY_UNAVAILABLE"), false);
  });
}

test("other update errors keep their message", async (t) => {
  const { ui } = await mountUpdates(t, status(), {
    check: () => Promise.reject(new Error("Unable to update. Retry when online.")),
  });
  await ui.click(button(ui, "updates.check"));
  await React.act(async () => new Promise((resolve) => setImmediate(resolve)));
  assert.equal(
    ui.find((node) => node.attributes?.role === "alert").textContent,
    "Unable to update. Retry when online."
  );
});
