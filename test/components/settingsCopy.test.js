const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

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

test("[baseline guard] setup title and description stay translated", () => {
  const page = read("src/components/SettingsPage.tsx");
  assert.doesNotMatch(page, />Review dictation setup</);
  assert.doesNotMatch(page, /Open setup\s*</);
  assert.match(page, /t\("settingsPage\.reviewSetup\.title"\)/);
  assert.match(page, /t\("settingsPage\.reviewSetup\.description"\)/);
});

test("[baseline guard] CodexConnection uses logical margins", () => {
  assert.doesNotMatch(read("src/components/CodexConnection.tsx"), /\b(ml|mr|pl|pr)-\d/);
});

test("[baseline guard] no component ships a private LAN address as a placeholder", () => {
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

test("[baseline guard] Bedrock asks for the access key ID in the clear and labels AWS fields honestly", () => {
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
  const vite = await createRendererServer(
    t,
    withI18nMock(
      {
        cachePrefix: "loqui-openai-compatible-copy-",
        resolveAlias: { "@": path.resolve(repoRoot, "src") },
      },
      { withOptions: true }
    )
  );
  const { default: Panel } = await vite.ssrLoadModule("/components/OpenAICompatiblePanel.tsx");
  return renderToStaticMarkup(
    createElement(Panel, {
      baseUrl,
      onUseEndpoint() {},
      apiKey: "",
      saveApiKey() {},
      model: "",
      onSelectModel() {},
    })
  );
}

test("[baseline guard] empty staged URL announces no discovery recipient", async (t) => {
  const html = await renderPanel(t, "");
  assert.doesNotMatch(html, /reasoning\.custom\.queryPrefix/);
  assert.doesNotMatch(html, /api\.openai\.com\/v1\/models/);
  assert.match(html, /staging\.url\.empty/);
  assert.match(html, /value=""/);
  assert.match(html, /data-action="list-models"[^>]*disabled=""/);
  assert.match(html, /reasoning\.custom\.listModelsNeedsEndpoint/);
  assert.doesNotMatch(html, /reasoning\.custom\.listModels(?:SendsKey|NoKey)/);
});

test("[baseline guard] saved endpoint stays exact while discovery awaits recipient metadata", async (t) => {
  const html = await renderPanel(t, "http://localhost:11434/v1");
  assert.match(html, /value="http:\/\/localhost:11434\/v1"/);
  assert.match(html, /staging\.url\.http/);
  assert.match(html, /data-action="list-models"[^>]*disabled=""/);
  assert.match(html, /reasoning\.custom\.listModelsNeedsEndpoint/);
  assert.doesNotMatch(html, /reasoning\.custom\.listModels(?:SendsKey|NoKey)/);
});

test("[baseline guard] discovery copy names the exact committed host and credential slot only after metadata, while unsent text stays exact (mounted)", async (t) => {
  const { createProbeRoot, findElement } = require("../lib/probeRoot");
  let describeCalls = 0,
    requests = 0,
    used = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        personalInference: {
          describeModels: async ({ baseUrl, credentialRef }) => {
            describeCalls++;
            return {
              host: new URL(baseUrl).host,
              credentialId: credentialRef,
              generation: 1,
              present: true,
              recipientToken: "fixture-token",
            };
          },
          models: async () => {
            requests++;
            return { data: [] };
          },
        },
      },
    },
  });
  const vite = await createRendererServer(
    t,
    withI18nMock(
      {
        cachePrefix: "loqui-exact-endpoint-copy-",
        resolveAlias: { "@": path.resolve(repoRoot, "src") },
      },
      { withOptions: true }
    )
  );
  const Panel = (await vite.ssrLoadModule("/components/OpenAICompatiblePanel.tsx")).default;
  const probes = createProbeRoot(t);
  const committed = "https://models.example.test:9443/team/v1";
  const tree = await probes.mount("panel", () =>
    Panel({
      baseUrl: committed,
      credentialRef: "custom:noteFormatting",
      apiKey: "__stored__",
      saveApiKey() {},
      model: "",
      onSelectModel() {},
      onUseEndpoint: (url) => used.push(url),
    })
  );
  await probes.settle();
  const button = () => findElement(tree(), (n) => n.props?.["data-action"] === "list-models");
  assert.match(button().props.title, /reasoning\.custom\.listModelsSendsKey/);
  assert.match(button().props.title, /models\.example\.test:9443/);
  assert.match(button().props.title, /routes\.names\.noteFormatting/);
  const field = findElement(tree(), (n) => typeof n.props?.onUse === "function");
  const draft = await probes.mount("draft", () => field.type(field.props));
  const input = () => findElement(draft(), (n) => n.props?.dir === "ltr" && n.props?.onChange);
  assert.equal(input().props.value, committed);
  const entered = "https://other.example.test:9444/a/path/v1";
  await probes.act(() => input().props.onChange({ target: { value: entered } }));
  assert.equal(input().props.value, entered);
  assert.match(button().props.title, /models\.example\.test:9443/);
  assert.doesNotMatch(button().props.title, /other\.example/);
  assert.equal(describeCalls, 1, "draft typing does not even re-describe committed recipient");
  assert.deepEqual(used, []);
  assert.equal(requests, 0);
  await probes.act(() => button().props.onClick());
  assert.equal(requests, 1, "only an explicit fixture click discovers");
});
