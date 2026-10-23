const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("[change-driving] route chips", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-route-chips-test-", withOptions: true })
  );
  const chips = await vite.ssrLoadModule("/components/settings/routing/RouteChips.tsx");
  const tr = (k, o) => (o ? `${k}${JSON.stringify(o)}` : k);

  await t.test("[change-driving] every state has words, never colour alone", () => {
    assert.equal(chips.routeStateLabel({ status: "ready" }, tr), "routes.state.ready");
    assert.equal(chips.routeStateLabel({ status: "off" }, tr), "routes.state.off");
    assert.equal(chips.routeStateLabel({ status: "unknown" }, tr), "routes.state.checking");
    assert.equal(
      chips.routeStateLabel({ status: "needsModel", sizeBytes: 1329766560 }, tr),
      'routes.state.download{"size":"1.3 GB"}'
    );
    assert.equal(chips.routeStateLabel({ status: "needsModel" }, tr), "routes.state.chooseModel");
    assert.equal(
      chips.routeStateLabel({ status: "needsKey", provider: "Groq" }, tr),
      "routes.state.addKey"
    );
    assert.equal(
      chips.routeStateLabel({ status: "needsKey", provider: "" }, tr),
      "routes.state.chooseProvider"
    );
    assert.equal(chips.routeStateLabel({ status: "needsUrl" }, tr), "routes.state.addUrl");
    for (const detail of ["sealed", "retired", "unsupported"])
      assert.equal(
        chips.routeStateLabel({ status: "unreachable", detail }, tr),
        `routes.state.${detail}`
      );
    assert.equal(chips.routeStateLabel({ status: "unreachable" }, tr), "routes.state.cantReach");
    assert.equal(
      chips.routeStateLabel({ status: "unreachable", detail: "new" }, tr),
      "routes.state.cantReach"
    );
  });

  await t.test("[change-driving] every state renders a glyph, words and data-state", () => {
    const states = [
      { status: "ready" },
      { status: "off" },
      { status: "unknown" },
      { status: "needsModel", sizeBytes: 1000000 },
      { status: "needsKey", provider: "Groq" },
      { status: "needsUrl" },
      { status: "unreachable", detail: "sealed" },
      { status: "unreachable", detail: "retired" },
      { status: "unreachable", detail: "unsupported" },
      { status: "unreachable" },
    ];
    for (const state of states) {
      const html = renderToStaticMarkup(React.createElement(chips.RouteStateChip, { state }));
      assert.match(html, new RegExp(`data-state="${state.status}"`));
      assert.match(html, /<svg/);
      assert.match(html, /routes\.state\./);
    }
  });

  await t.test("[change-driving] unknown reads Checking and does not claim readiness", () => {
    const html = renderToStaticMarkup(
      React.createElement(chips.RouteStateChip, { state: { status: "unknown" } })
    );
    assert.match(html, /routes\.state\.checking/);
    assert.doesNotMatch(html, /routes\.state\.ready/);
  });

  await t.test(
    "[change-driving] chip words use readable roles and destructive hue stays on glyph",
    () => {
      const states = [
        { status: "ready" },
        { status: "off" },
        { status: "unknown" },
        { status: "needsModel" },
        { status: "needsKey", provider: "Groq" },
        { status: "needsUrl" },
        { status: "unreachable", detail: "retired" },
        { status: "unreachable", detail: "unsupported" },
        { status: "unreachable", detail: "sealed" },
        { status: "unreachable" },
      ];
      for (const state of states) {
        const html = renderToStaticMarkup(React.createElement(chips.RouteStateChip, { state }));
        const span = html.match(/^<span[^>]*class="([^"]*)"/)[1].split(/\s+/);
        for (const bad of ["text-destructive", "text-success", "text-warning", "text-primary"])
          assert.ok(!span.includes(bad), `${JSON.stringify(state)} text uses ${bad}`);
      }
      const failing = renderToStaticMarkup(
        React.createElement(chips.RouteStateChip, {
          state: { status: "needsKey", provider: "Groq" },
        })
      );
      assert.match(failing, /<svg[^>]*class="[^"]*text-destructive/);
    }
  );

  await t.test("[change-driving] destination chip shows locality ring, provider and model", () => {
    const remote = renderToStaticMarkup(
      React.createElement(chips.RouteDestinationChip, {
        route: { locality: "remote", providerId: "groq", model: "gpt-oss-120b" },
      })
    );
    assert.match(remote, /data-locality="remote"/);
    assert.match(remote, /Groq · gpt-oss-120b/);
    const device = renderToStaticMarkup(
      React.createElement(chips.RouteDestinationChip, {
        route: { locality: "device", providerId: null, model: "Qwen3.5 2B" },
      })
    );
    assert.match(device, /locality\.device · Qwen3\.5 2B/);
    const custom = renderToStaticMarkup(
      React.createElement(chips.RouteDestinationChip, {
        route: { locality: "remote", providerId: "custom", model: null },
      })
    );
    assert.match(custom, /locality\.customEndpoint/);
    const unchosen = renderToStaticMarkup(
      React.createElement(chips.RouteDestinationChip, {
        route: { locality: "remote", providerId: null, model: null },
      })
    );
    assert.match(unchosen, /routes\.place\.chooseProvider/);
  });
});
