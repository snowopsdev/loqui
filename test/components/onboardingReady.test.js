const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");

const STEPS = {
  speech: "speech",
  microphone: "welcome",
  shortcut: "shortcuts",
  cleanup: "cleanup",
};
const rows = (statuses, extra = {}) =>
  ["speech", "microphone", "shortcut", "cleanup"].map((key, index) => ({
    key,
    status: statuses[index],
    step: STEPS[key],
    detail: `${key}.${statuses[index]}`,
    ...(extra[key] ?? {}),
  }));
// Plan 03's published chips (§5.1), stubbed so the test sees exactly what the step hands them.
const ROUTE_CHIPS_MOCK = `
import React from "react";
export function RouteDestinationChip({ route }) {
  return React.createElement("span", { "data-route-chip": "destination", "data-locality": route.locality, "data-provider": route.providerId ?? "" });
}
export function RouteStateChip({ state }) {
  return React.createElement("span", { "data-route-chip": "state", "data-state": state.status });
}`;
const readyNote = {
  status: "ready",
  block: null,
  locality: "device",
  providerId: null,
  model: null,
  settingsPath: "stt/noteRecording",
};

async function ready(t, summary, patch = {}) {
  const events = [];
  const ui = await mountComponent(t, "/components/onboarding/ReadyStep.tsx", {
    exportName: "ReadyStep",
    props: {
      platform: "darwin",
      summary,
      note: readyNote,
      noteProviderLabel: "OpenAI",
      onResume: (step) => events.push(["resume", step]),
      onDictateNote: () => events.push("note"),
      onOpenSettings: (to) => events.push(["settings", to]),
      onOpenWorkspace: () => events.push("workspace"),
      privacy: {
        historyEnabled: true,
        onHistoryChange() {},
        updatesEnabled: true,
        onUpdatesChange() {},
      },
      ...patch,
    },
    mocks: { "routing/RouteChips": ROUTE_CHIPS_MOCK },
  });
  return { ui, events };
}

test("proven: the title says so, icons use status colours, and the note action is live with its locality", async (t) => {
  const { ui, events } = await ready(t, {
    rows: rows(["ready", "ready", "ready", "optional"]),
    pending: 0,
    proven: true,
    allLocal: true,
  });
  expectKey(ui, "setupFlow.ready.titleProven");
  expectKey(ui, "setupFlow.ready.subAllLocalMac");
  assert.deepEqual(
    ui.byAttr("data-status").map((node) => node.attributes["data-status"]),
    ["ready", "ready", "ready", "optional"]
  );
  assert.equal(
    ui.byAttr("data-locality", "device").length,
    1,
    "the note action discloses where audio goes"
  );
  const [dictate] = ui.byAttr("data-variant", "live");
  assert.ok(dictate.textContent.includes("setupFlow.ready.dictateNote"));
  await ui.click(dictate);
  await ui.click("setupFlow.ready.openWorkspace");
  assert.deepEqual(events, ["note", "workspace"]);
});

test("set up but not tried does not claim dictation works (I07)", async (t) => {
  const { ui } = await ready(t, {
    rows: rows(["configured", "configured", "configured", "optional"]),
    pending: 0,
    proven: false,
    allLocal: true,
  });
  expectKey(ui, "setupFlow.ready.titleConfigured");
  assert.equal(ui.text().includes("setupFlow.ready.titleProven"), false);
  const resumable = ui.findAll(
    (node) => node.tagName === "BUTTON" && node.attributes["data-row"] !== undefined
  );
  assert.deepEqual(
    resumable.map((node) => node.attributes["data-row"]),
    ["speech", "microphone", "shortcut"]
  );
  assert.equal(ui.byAttr("data-status", "optional").length, 1);
  assert.equal(ui.byAttr("data-row", "cleanup").length, 0);
});

test("pending rows resume in setup, or open the exact Settings page when only Settings can fix them", async (t) => {
  const summary = {
    rows: rows(["ready", "pending", "ready", "pending"], {
      cleanup: { settingsPath: "llms/dictationCleanup" },
    }),
    pending: 2,
    proven: true,
    allLocal: true,
  };
  const { ui, events } = await ready(t, summary);
  expectKey(ui, "setupFlow.ready.titlePending", { count: 2 });
  await ui.click(ui.byAttr("data-row", "microphone")[0]);
  await ui.click(ui.byAttr("data-row", "cleanup")[0]);
  assert.deepEqual(events, [
    ["resume", "welcome"],
    ["settings", "llms/dictationCleanup"],
  ]);
});

test("a blocked note action says why and links to its own Settings route (I06)", async (t) => {
  const note = {
    status: "blocked",
    block: "unsupported",
    locality: "network",
    providerId: null,
    model: null,
    settingsPath: "stt/noteRecording",
  };
  const { ui, events } = await ready(
    t,
    {
      rows: rows(["ready", "ready", "ready", "optional"]),
      pending: 0,
      proven: true,
      allLocal: false,
    },
    { note }
  );
  const [dictate] = ui.byAttr("data-variant", "live");
  assert.ok("disabled" in dictate.attributes);
  const [reason] = ui.byAttr("id", dictate.attributes["aria-describedby"]);
  assert.ok(reason.textContent.includes("setupFlow.ready.noteBlocked.unsupported"));
  await ui.click("setupFlow.ready.fixNote");
  assert.deepEqual(events, [["settings", "stt/noteRecording"]]);
});

test("an unconfirmed note route reads Checking…, with no fix and no claim (§5.1 rule 1)", async (t) => {
  const note = {
    status: "checking",
    block: null,
    locality: "device",
    providerId: null,
    model: null,
    settingsPath: "stt/noteRecording",
  };
  const { ui } = await ready(
    t,
    {
      rows: rows(["ready", "ready", "ready", "optional"]),
      pending: 0,
      proven: true,
      allLocal: true,
    },
    { note }
  );
  const [dictate] = ui.byAttr("data-variant", "live");
  assert.ok("disabled" in dictate.attributes);
  expectKey(ui, "setupFlow.ready.noteChecking");
  assert.equal(ui.text().includes("setupFlow.ready.fixNote"), false);
});

test("a denied microphone sends the note fix back to Hello", async (t) => {
  const note = {
    status: "blocked",
    block: "microphone",
    locality: "device",
    providerId: null,
    model: null,
    settingsPath: "stt/noteRecording",
  };
  const { ui, events } = await ready(
    t,
    {
      rows: rows(["ready", "pending", "ready", "optional"]),
      pending: 1,
      proven: true,
      allLocal: true,
    },
    { note }
  );
  await ui.click("setupFlow.ready.fixNote");
  assert.deepEqual(events, [["resume", "welcome"]]);
});

test("a remote note route names its provider and never claims everything stays on device", async (t) => {
  const note = {
    status: "ready",
    block: null,
    locality: "remote",
    providerId: "openai",
    model: "Whisper",
    settingsPath: "stt/noteRecording",
  };
  const { ui } = await ready(
    t,
    {
      rows: rows(["ready", "ready", "ready", "optional"]),
      pending: 0,
      proven: true,
      allLocal: false,
    },
    { note }
  );
  expectKey(ui, "setupFlow.ready.noteSends", { provider: "OpenAI" });
  expectKey(ui, "setupFlow.ready.subProven");
  assert.equal(/setupFlow\.ready\.subAllLocal(Mac|Other)/.test(ui.text()), false);
  const [chip] = ui.byAttr("data-route-chip", "destination");
  assert.deepEqual(
    [chip.attributes["data-locality"], chip.attributes["data-provider"]],
    ["remote", "openai"],
    "Plan 03's chip, fed the note route (R2-M02)"
  );
});

test("status colours stay off the words and fuchsia stays out of status (ONB-Q14)", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../src/styles/onboarding.css"), "utf8");
  assert.match(css, /\.onb-ready-row__icon\[data-status="ready"\]\s*\{[^}]*var\(--color-success\)/);
  assert.match(
    css,
    /\.onb-ready-row__icon\[data-status="pending"\]\s*\{[^}]*var\(--color-warning\)/
  );
  assert.doesNotMatch(css, /\.onb-ready-row__status\s*\{[^}]*--color-(success|warning)/);
  for (const block of css.match(/\.onb-ready[^{]*\{[^}]*\}/g) ?? []) {
    assert.doesNotMatch(
      block,
      /--color-(accent|nav-marker|live)\b/,
      "brand colours stay on the buttons"
    );
  }
});

test("status icon glyphs clear 3:1 against their actual token backgrounds in both themes", async () => {
  const { resolveTokens } = require("../helpers/harness/cssTokens");
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const css = fs.readFileSync(path.join(__dirname, "../../src/styles/onboarding.css"), "utf8");
  const themes = resolveTokens(
    fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8")
  );
  for (const status of ["ready", "configured", "pending", "optional"]) {
    const block = css.match(
      new RegExp(`\\.onb-ready-row__icon\\[data-status="${status}"\\]\\s*\\{([^}]*)\\}`)
    )[1];
    const foreground = block.match(/(?:^|;)\s*color:\s*var\((--[\w-]+)\)/)?.[1];
    const background = block.match(/background:\s*var\((--[\w-]+)\)/)?.[1];
    assert.ok(
      background,
      "actual icon background is a directly contrastable neutral token: " + status
    );
    for (const [theme, tokens] of Object.entries(themes))
      assert.ok(contrastRatio(tokens[foreground], tokens[background]) >= 3, theme + status);
  }
});
