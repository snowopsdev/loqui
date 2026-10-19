const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const repoRoot = path.join(__dirname, "../..");
const css = () =>
  fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8") +
  fs.readFileSync(path.join(repoRoot, "src/styles/dictation-panel.css"), "utf8");

test("radial ticks stay between 2 and 11px and rest at 2px for bad input", async () => {
  const { agentTickLength, AGENT_TICK_COUNT } =
    await import("../../src/components/dictation/agentOrbitMath.ts");
  assert.equal(AGENT_TICK_COUNT, 24);
  for (let j = 0; j < 24; j += 1) {
    for (const level of [0, 0.3, 1]) {
      const len = agentTickLength(j, level, 1234);
      assert.ok(len >= 2 && len <= 11, `${j} ${level} ${len}`);
    }
  }
  for (const bad of [NaN, -1, Infinity]) assert.equal(agentTickLength(3, bad, 0), 2);
});

test("reduced motion uses a flat phase: every tick has the same length", async () => {
  const { agentTickLength } = await import("../../src/components/dictation/agentOrbitMath.ts");
  const lengths = new Set(Array.from({ length: 24 }, (_, j) => agentTickLength(j, 0.8, 999, true)));
  assert.equal(lengths.size, 1);
});

test("tick level reuses the LevelBars peak and silence floor", async () => {
  const { agentTickLevel } = await import("../../src/components/dictation/agentOrbitMath.ts");
  const { LEVEL_BARS_SILENCE_FLOOR } = await import("../../src/components/ui/levelBarsMath.ts");
  const frame = { scales: [0, 0, 0, 0, 0], peak: 0.1 };
  assert.equal(agentTickLevel(frame, LEVEL_BARS_SILENCE_FLOOR / 2), 0);
  assert.equal(agentTickLevel(frame, 0.05), 0.5);
  assert.equal(agentTickLevel(frame, 0.5), 1);
  assert.equal(agentTickLevel(frame, "junk"), 0);
});

test("listening draws 24 ticks; thinking draws the orbit with two satellites", async () => {
  const { AgentOrbit } = await import("../../src/components/dictation/AgentOrbit.tsx");
  const listening = renderStatic(AgentOrbit, { phase: "listening", readLevel: () => 0 });
  const thinking = renderStatic(AgentOrbit, { phase: "thinking", readLevel: () => 0 });
  assert.equal((listening.match(/<line /g) || []).length, 24);
  assert.match(thinking, /class="agent-orbit" data-phase="thinking"/);
  assert.equal((thinking.match(/class="agent-orbit__satellite/g) || []).length, 2);
});

test("orbit timing: 2.4s thinking, 1.2s answering that dissolves on the exit tokens", () => {
  const styles = css();
  assert.match(
    styles,
    /\.agent-orbit\[data-phase="thinking"\] \.agent-orbit__ring\s*\{[^}]*animation:\s*agent-orbit var\(--motion-agent-thinking\) linear infinite/
  );
  assert.match(
    styles,
    /\.agent-orbit\[data-phase="answering"\] \.agent-orbit__ring\s*\{[^}]*agent-orbit var\(--motion-agent-answering\) linear infinite,\s*agent-orbit-fade var\(--motion-hero\) var\(--motion-ease-exit\) var\(--motion-slow\) forwards/
  );
  assert.match(
    styles,
    /prefers-reduced-motion: reduce[\s\S]*\.agent-orbit__ring[\s\S]*animation:\s*none/
  );
});

test("the answering dissolve ends inside the answering phase", async () => {
  const { AGENT_ANSWERING_MS } = await import("../../src/hooks/useAgentAnswering.ts");
  const index = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  const token = (name) => Number(index.match(new RegExp(`${name}:\\s*(\\d+)ms;`))[1]);
  // 360 + 520 = 880 ms today: the ring has dissolved before data-phase leaves "answering".
  assert.ok(token("--motion-slow") + token("--motion-hero") <= AGENT_ANSWERING_MS);
});

test("no frame glyph and no beam ring ship with Agent Mode (owner note)", async () => {
  // Checks the rendered orbit, not its source: the source legitimately says
  // "frame" for LevelBars frames (nextLevelBarsFrame).
  const { AgentOrbit } = await import("../../src/components/dictation/AgentOrbit.tsx");
  for (const phase of ["listening", "thinking", "answering"]) {
    assert.doesNotMatch(
      renderStatic(AgentOrbit, { phase, readLevel: () => 0 }),
      /frame|glyph/i,
      phase
    );
  }
  assert.doesNotMatch(css(), /data-agent-beam-active/);
});

test("mounted answering hook resets on early finish/new thinking and the real pill keeps its dissolve mounted", async (t) => {
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
  const { installTree } = require("../helpers/harness/fakeDomTree");
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const { useAgentAnswering, AGENT_ANSWERING_MS } =
    await import("../../src/hooks/useAgentAnswering.ts");
  const { VoicePill } = await import("../../src/components/dictation/VoicePill.tsx");
  root = createRoot(tree.container);
  let answering;
  function Harness({ thinking, busy }) {
    answering = useAgentAnswering(thinking, busy);
    return React.createElement(VoicePill, {
      variant: "floating",
      state: thinking ? "thinking" : "idle",
      agentMode: true,
      agentPhase: answering ? "answering" : undefined,
      getAudioLevel: () => 0,
    });
  }
  const render = (thinking, busy) =>
    React.act(async () => root.render(React.createElement(Harness, { thinking, busy })));
  const phase = () =>
    tree.find((n) => n.attributes?.class === "agent-orbit")?.attributes["data-phase"];
  await render(true, true);
  assert.equal(phase(), "thinking");
  await render(false, true);
  assert.equal(answering, true);
  assert.equal(phase(), "answering", "the actual pill mounts after thinking ends");
  await render(false, false);
  assert.equal(answering, false);
  assert.equal(phase(), undefined);
  await render(true, true);
  assert.equal(answering, false);
  assert.equal(phase(), "thinking");
  await render(false, true);
  await React.act(
    async () => new Promise((resolve) => setTimeout(resolve, AGENT_ANSWERING_MS + 30))
  );
  assert.equal(answering, false);
  assert.equal(phase(), undefined, "does not restart thinking after the dissolve");
});

test("mounted reduced-motion listening still meters audio with a flat phase and cleans up its sampler", async (t) => {
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
  const { installTree } = require("../helpers/harness/fakeDomTree");
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window: { matchMedia: () => ({ matches: true }) } });
  installHookDom(t);
  const tree = installTree();
  const { AgentOrbit } = await import("../../src/components/dictation/AgentOrbit.tsx");
  t.mock.timers.enable({ apis: ["setInterval"] });
  let samples = 0;
  root = createRoot(tree.container);
  const render = (reader) =>
    React.act(async () =>
      root.render(
        React.createElement(AgentOrbit, {
          phase: "listening",
          readLevel: () => {
            samples++;
            return reader();
          },
        })
      )
    );
  const lengths = () => {
    const lines = [];
    const walk = (n) => {
      if (n.tagName === "line") lines.push(n);
      for (const c of n.childNodes ?? []) walk(c);
    };
    walk(tree.container);
    assert.equal(lines.length, 24);
    return lines.map((n) =>
      Math.hypot(
        Number(n.attributes.x2) - Number(n.attributes.x1),
        Number(n.attributes.y2) - Number(n.attributes.y1)
      )
    );
  };
  await render(() => 1);
  await React.act(async () => t.mock.timers.tick(100));
  assert.equal(samples, 1);
  assert.ok(
    lengths().every((n) => Math.abs(n - 6.5) < 0.00001),
    "reduced motion retains audio-driven level updates"
  );
  await render(() => {
    throw Error("unavailable meter");
  });
  await React.act(async () => t.mock.timers.tick(100));
  assert.ok(
    lengths().every((n) => Math.abs(n - 2) < 0.00001),
    "failed reader rests safely at 2px"
  );
  await React.act(async () => root.unmount());
  root = null;
  await React.act(async () => t.mock.timers.tick(500));
  assert.equal(samples, 2, "unmount clears the sampler");
});

test("reduced-motion answering retains the opacity dissolve without the rotational loop", () => {
  const styles = css();
  const reduce = styles.slice(styles.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(
    reduce,
    /\.agent-orbit\[data-phase="answering"\] \.agent-orbit__ring[^{}]*\{[^}]*animation: agent-orbit-fade var\(--motion-hero\)/
  );
  const answering = reduce.match(
    /\.agent-orbit\[data-phase="answering"\] \.agent-orbit__ring[^{}]*\{([^}]*)/
  )[1];
  assert.doesNotMatch(answering, /linear infinite/);
});

test("a concurrent answering phase never wraps an owned Undo/outcome capsule", async () => {
  const { VoicePill } = await import("../../src/components/dictation/VoicePill.tsx");
  for (const state of ["cancelled", "pasted", "failed", "sealedPaused", "meeting"]) {
    const html = renderStatic(VoicePill, {
      variant: "floating",
      state,
      agentMode: true,
      agentPhase: "answering",
      label: "owned stage",
      getAudioLevel: () => 0,
    });
    assert.doesNotMatch(html, /class="agent-orbit"/, state);
    assert.match(html, new RegExp(`data-pill-state="${state}"`));
  }
});

for (const terminalAt of ["before response", "during answering", "panel opened before response"])
  test(`explicit response owner prevents a retired flourish: ${terminalAt}`, async (t) => {
    const React = require("react");
    const { createRoot } = require("react-dom/client");
    const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
    let root;
    t.after(async () => {
      if (root) await React.act(async () => root.unmount());
    });
    installBrowserGlobals(t);
    const container = installHookDom(t);
    const { useAgentAnswering } = await import("../../src/hooks/useAgentAnswering.ts");
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let answering;
    function Harness({ thinking, response }) {
      answering = useAgentAnswering(thinking, true, response);
      return null;
    }
    root = createRoot(container);
    const render = (thinking, response) =>
      React.act(async () => root.render(React.createElement(Harness, { thinking, response })));
    const a = {},
      b = {};
    await render(true, { owner: a, responded: false });
    if (terminalAt === "during answering") {
      await render(false, { owner: a, responded: true });
      assert.equal(answering, true);
    }
    await render(
      false,
      terminalAt === "panel opened before response" ? { owner: a, responded: false } : null
    );
    assert.equal(
      answering,
      false,
      "retirement/opening a panel is not a first response while business remains busy"
    );
    await render(true, { owner: b, responded: false });
    await React.act(async () => t.mock.timers.tick(900));
    await render(false, { owner: b, responded: true });
    assert.equal(answering, true, "B's actual response starts a fresh phase");
    await React.act(async () => t.mock.timers.tick(999));
    assert.equal(answering, true, "A's old timer cannot end B's phase");
    await React.act(async () => t.mock.timers.tick(1));
    assert.equal(answering, false, "B owns its exact 1000ms deadline");
  });

test("production controller distinguishes opening a pending panel from its exact response and fences retired response callbacks", async (t) => {
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const { useAssistantPanel } = await import("../../src/hooks/useAssistantPanel.js");
  const { useAgentAnswering } = await import("../../src/hooks/useAgentAnswering.ts");
  let owner, answering, releaseA, releaseB;
  function Harness() {
    owner = useAssistantPanel({
      requestMainWindowSize: async () => {},
      wordsCardVisible: false,
      recordingControlsRef: { current: null },
    });
    answering = useAgentAnswering(owner.thinking, owner.busy, owner.responsePhase);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  const a = {
    agentOnly: true,
    routes: null,
    settings: {},
    intents: { voiceAgentRequested: true, translationRequested: false },
  };
  const b = { ...a };
  await React.act(async () => {
    releaseA = owner.handleTypedAdmission(a);
    owner.setBusy(true);
  });
  await React.act(async () => owner.openPanel());
  assert.equal(owner.thinking, false, "opening the real pending panel clears thinking");
  assert.equal(owner.responsePhase.responded, false);
  assert.equal(answering, false, "opening alone is not a first response");
  await React.act(async () => owner.handleTypedResponse(a));
  assert.equal(answering, true);
  await React.act(async () => {
    releaseA();
    releaseB = owner.handleTypedAdmission(b);
  });
  const bKey = owner.responsePhase.owner;
  await React.act(async () => {
    releaseA();
    owner.handleTypedResponse(a);
    owner.handleCommandResponse(1);
  });
  assert.equal(owner.responsePhase.owner, bKey);
  assert.equal(owner.responsePhase.responded, false, "late A response never marks B as responding");
  assert.equal(owner.thinking, true);
  assert.equal(answering, false);
  await React.act(async () => owner.handleTypedResponse(b));
  assert.equal(answering, true);
  await React.act(async () => releaseB());
  assert.equal(owner.busy, true);
  assert.equal(answering, false);
});
