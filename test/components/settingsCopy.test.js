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

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

test("the setup card is translated", () => {
  const page = read("src/components/SettingsPage.tsx");
  assert.doesNotMatch(page, />Review dictation setup</);
  assert.doesNotMatch(page, /Open setup\s*</);
  assert.match(page, /t\("settingsPage\.reviewSetup\.title"\)/);
  assert.match(page, /t\("settingsPage\.reviewSetup\.description"\)/);
  assert.match(page, /t\("settingsPage\.reviewSetup\.action"\)/);
});

test("CodexConnection uses logical margins", () => {
  assert.doesNotMatch(read("src/components/CodexConnection.tsx"), /\b(ml|mr|pl|pr)-\d/);
});

test("no component ships a private LAN address as a placeholder", () => {
  const lan = /\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/;
  const offenders = walk(path.join(repoRoot, "src/components")).filter((file) =>
    lan.test(fs.readFileSync(file, "utf8"))
  );
  assert.deepEqual(
    offenders.map((f) => path.relative(repoRoot, f)),
    []
  );
  assert.match(read("src/components/SelfHostedPanel.tsx"), /"http:\/\/localhost:8178"/);
  assert.match(read("src/components/SelfHostedPanel.tsx"), /"http:\/\/localhost:11434\/v1"/);
});

test("Bedrock asks for the access key ID in the clear and labels AWS fields honestly", () => {
  const config = read("src/components/EnterpriseProviderConfig.tsx");
  assert.match(
    config,
    /label=\{t\("reasoning\.enterprise\.accessKeyId"\)\}[\s\S]*?masked=\{false\}[\s\S]*?placeholder="AKIA…"/
  );
  assert.match(read("src/components/ui/ApiKeyInput.tsx"), /type=\{masked \? "password" : "text"\}/);
  const en = JSON.parse(read("src/locales/en/translation.json")).reasoning.enterprise;
  assert.equal(en.accessKeyId, "AWS access key ID");
  assert.equal(en.secretAccessKey, "Secret access key");
  assert.equal(en.sessionToken, "Session token (optional)");
});

async function renderPanel(t, baseUrl) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-openai-compatible-copy-"));
  const { default: Panel } = await vite.ssrLoadModule("/components/OpenAICompatiblePanel.tsx");
  return renderToStaticMarkup(
    createElement(Panel, {
      baseUrl,
      setBaseUrl() {},
      apiKey: "",
      setApiKey() {},
      model: "",
      setModel() {},
    })
  );
}

test("no endpoint is announced while the URL is empty", async (t) => {
  const html = await renderPanel(t, "");
  assert.doesNotMatch(html, /reasoning\.custom\.queryPrefix/);
  assert.doesNotMatch(html, /api\.openai\.com\/v1\/models/);
  assert.match(html, /reasoning\.custom\.enterEndpoint/);
});

test("a saved endpoint is named exactly", async (t) => {
  const html = await renderPanel(t, "http://localhost:11434/v1");
  assert.match(html, /reasoning\.custom\.queryPrefix/);
  assert.match(html, /http:\/\/localhost:11434\/v1\/models/);
});
