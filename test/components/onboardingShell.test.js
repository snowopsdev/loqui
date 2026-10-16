const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

test("the shell pins html, body and #root while onboarding is mounted", () => {
  const css = read("src/styles/onboarding-welcome.css");
  assert.match(
    css,
    /html:has\(\.onboarding-welcome\),\s*html:has\(\.onboarding-welcome\) body,\s*html:has\(\.onboarding-welcome\) #root\s*\{\s*height: 100%;\s*\}/
  );
  assert.doesNotMatch(read("src/index.css"), /onboarding-welcome/, "onboarding CSS stays out of index.css");
});

test("traffic-light clearance is physical, not logical, and survives the narrow layout", () => {
  const css = read("src/styles/onboarding-welcome.css");
  const wide = css.match(
    /\.onboarding-welcome\[data-platform="darwin"\] \.onboarding-welcome-header\s*\{([^}]*)\}/
  );
  assert.ok(wide, "macOS header rule exists");
  assert.match(wide[1], /padding-left: max\(84px, calc\(\(100vw - 1320px\) \/ 2\)\);/);
  assert.doesNotMatch(wide[1], /padding-inline-start/);
  const narrow = css.match(/@media \(max-width: 760px\)\s*\{([\s\S]*?)\n\}/)[1];
  assert.match(
    narrow,
    /\.onboarding-welcome\[data-platform="darwin"\] \.onboarding-welcome-header\s*\{\s*padding-left: 84px;\s*\}/
  );
});

test("both shells carry the platform", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-onboarding-shell-"));
  const { default: WelcomeScreen } = await vite.ssrLoadModule(
    "/components/onboarding/WelcomeScreen.tsx"
  );
  const html = renderToStaticMarkup(
    createElement(WelcomeScreen, {
      platform: "darwin",
      updatesEnabled: true,
      onUpdatesChange() {},
      dataRetentionEnabled: true,
      onDataRetentionChange() {},
      onContinue() {},
      onExplore() {},
    })
  );
  assert.match(html, /<div class="onboarding-welcome" data-platform="darwin">/);

  const flow = read("src/components/OnboardingFlow.tsx");
  assert.match(
    flow,
    /<div className="onboarding-welcome onboarding-guided" data-platform=\{platform\}>/
  );
  assert.match(flow, /<StepShell[\s\S]*?platform=\{platform\}/);
  assert.match(flow, /<WelcomeScreen[\s\S]*?platform=\{platform\}/);
});
