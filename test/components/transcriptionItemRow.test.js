process.env.TZ = "UTC";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const item = (over = {}) => ({
  id: 311,
  text: "Draft a reply to Maya: the pricing change goes out Thursday, not Monday.",
  raw_text: null,
  timestamp: "2026-10-14 19:51:00",
  created_at: "2026-10-14 19:51:00",
  has_audio: 1,
  audio_duration_ms: 7000,
  provider: "local-parakeet",
  model: "parakeet",
  status: "completed",
  error_message: null,
  error_code: null,
  client_transcription_id: "c311",
  cloud_id: null,
  sync_status: "synced",
  deleted_at: null,
  ...over,
});

async function renderRow(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-transcription-row-test-" });
  await vite.ssrLoadModule("/i18n.ts");
  const mod = await vite.ssrLoadModule("/components/ui/TranscriptionItem.tsx");
  return renderToStaticMarkup(
    createElement(mod.default, {
      item: item(),
      onCopy: () => {},
      onDelete: () => {},
      words: 13,
      ...props,
    })
  );
}

test("rows read time, words and duration at a glance", async (t) => {
  const html = await renderRow(t, {});
  assert.match(html, /data-transcript-id="311"/);
  assert.match(html, /grid-cols-\[64px_1fr_auto\]/);
  assert.match(html, />7:51 PM</);
  assert.doesNotMatch(html, />07:51/);
  assert.match(html, /0:07/);
  assert.match(html, /data-locality="device"/);
});

test("actions are visible at rest in a colour that clears 3:1, never faded (I14)", async (t) => {
  const html = await renderRow(t, {});
  assert.match(html, /data-row-actions="true"[^>]*class="[^"]*text-muted-foreground/);
  assert.doesNotMatch(html, /data-row-actions="true"[^>]*class="[^"]*opacity-\d+/);
  const fs = require("node:fs");
  const path = require("node:path");
  const { resolveTokens } = require("../helpers/harness/cssTokens");
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(
    fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8")
  );
  for (const map of [light, dark]) {
    for (const surface of ["--color-background", "--color-card", "--color-surface-1"]) {
      assert.ok(contrastRatio(map["--color-muted-foreground"], map[surface]) >= 3, surface);
    }
  }
});

test("no recorded provider means no locality claim", async (t) => {
  const html = await renderRow(t, { item: item({ provider: null }) });
  assert.doesNotMatch(html, /data-locality=/);
});

test("a deep-linked row is marked for the focus ring", async (t) => {
  const html = await renderRow(t, { focused: true });
  assert.match(html, /data-focused="true"/);
});

test("failed rows retain readable ink on the error tint and full focus on settings", async (t) => {
  const html = await renderRow(t, {
    item: item({ status: "failed", error_code: "API_KEY_MISSING" }),
  });
  assert.match(html, /class="text-sm font-medium text-foreground"/);
  assert.match(html, /Set up your transcription provider/);
  assert.match(html, /focus-visible:ring-2 focus-visible:ring-ring/);
});
