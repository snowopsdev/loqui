const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const LOCALES = ["ar", "de", "en", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"];
const t = (key) => `t:${key}`;
const resources = Object.fromEntries(
  LOCALES.map((l) => [
    l,
    JSON.parse(fs.readFileSync(path.join(root, "src/locales", l, "translation.json"), "utf8")),
  ])
);
const lookup = (json, key) => key.split(".").reduce((node, part) => node?.[part], json);

function sourceFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      if (name !== "locales") sourceFiles(full, out);
    } else if (/\.(tsx?|jsx?|cjs|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

// T8-M4: every sealedMode.* key that code can hand to t() exists in all 11
// locales, so no raw key ever surfaces. Composed keys are listed explicitly.
test("every sealedMode key referenced in src exists in all 11 locales", () => {
  const keys = new Set();
  for (const file of [
    ...sourceFiles(path.join(root, "src")),
    path.join(root, "main.js"),
    path.join(root, "preload.js"),
  ]) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/["'`](sealedMode\.[A-Za-z0-9_.]+)["'`]/g)) keys.add(m[1]);
  }
  for (const family of ["sealedMode.blocked", "sealedMode.interrupted"])
    for (const leaf of ["dictationHeld", "dictationKept", "dictationNotKept", "generic"])
      keys.add(`${family}.${leaf}`);
  for (const key of ["sealedMode.markdown.imageBlocked", "sealedMode.markdown.imageChecking"])
    keys.add(`${key}Named`);
  assert.ok(keys.has("sealedMode.blocked.generic") && keys.has("sealedMode.interrupted.generic"));
  const missing = [];
  for (const key of keys) {
    // A namespace prefix used only to compose keys (listed above) is not a key.
    if (typeof lookup(resources.en, key) === "object") continue;
    for (const l of LOCALES) {
      const value = lookup(resources[l], key) ?? lookup(resources[l], `${key}_other`);
      if (typeof value !== "string" || !value.trim()) missing.push(`${l}:${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

// 07a honesty: no copy claims a verified seal, zero bytes or isolation.
test("no sealedMode copy claims verification, zero bytes or that nothing leaves", () => {
  const en = JSON.stringify(resources.en.sealedMode);
  assert.doesNotMatch(en, /verified|0 bytes|zero bytes|nothing leaves|is isolated|are isolated/i);
  // "Nothing was sent" only in refusal copy, never in interruption copy.
  for (const l of LOCALES) {
    const interrupted = resources[l].sealedMode.interrupted;
    const blocked = resources[l].sealedMode.blocked;
    for (const [leaf, text] of Object.entries(interrupted))
      for (const refusal of [blocked.generic.split(/[.。]/).at(-2)].filter(Boolean))
        assert.equal(
          text.includes(refusal.trim()) && refusal.trim().length > 6,
          false,
          `${l}:interrupted.${leaf}`
        );
  }
  for (const key of ["dictationKept", "dictationNotKept", "dictationHeld", "generic", "chat"])
    assert.doesNotMatch(resources.en.sealedMode.interrupted[key], /nothing was sent/i, key);
  for (const key of ["dictationKept", "dictationNotKept", "dictationHeld", "generic", "chat"])
    assert.match(resources.en.sealedMode.interrupted[key], /may have received/i, key);
});

test("chat keeps the message and says why, by phase", async () => {
  const { chatErrorContent } = await import("../../src/components/chat/chatErrorContent.ts");
  const refused = { code: "SEALED_MODE", message: "[SEALED_MODE] blocked; nothing was sent." };
  const interrupted = new Error("Error invoking remote method: [SEALED_MODE:interrupted] cut");
  assert.equal(chatErrorContent(refused, t), "t:sealedMode.blocked.chat");
  assert.equal(chatErrorContent(interrupted, t), "t:sealedMode.interrupted.chat");
  assert.equal(
    chatErrorContent(new Error("rate limited"), t),
    "t:agentMode.chat.errorPrefix: rate limited"
  );
});

test("local inference maps SEALED_MODE to translated generic copy by phase (T8-M4)", async () => {
  const { buildLocalInferenceError } = await import("../../src/utils/localInferenceError.ts");
  const refused = buildLocalInferenceError({
    success: false,
    error: "[SEALED_MODE] x",
    code: "SEALED_MODE",
  });
  assert.equal(refused.messageKey, "sealedMode.blocked.generic");
  const interrupted = buildLocalInferenceError({
    error: "[SEALED_MODE:interrupted] x",
    code: "SEALED_MODE",
  });
  assert.equal(interrupted.messageKey, "sealedMode.interrupted.generic");
  const byPhase = buildLocalInferenceError({
    error: "x",
    code: "SEALED_MODE",
    phase: "interrupted",
  });
  assert.equal(byPhase.messageKey, "sealedMode.interrupted.generic");
  assert.equal(buildLocalInferenceError({ error: "x", code: "OTHER" }).messageKey, undefined);
});

test("calendar connect: sealed results get honest copy, never the generic failure (T11-M6)", async () => {
  const { calendarConnectFailure, SEALED_CONNECT_COPY } =
    await import("../../src/utils/calendarConnectOutcome.ts");
  assert.equal(calendarConnectFailure({ success: true }, "oauth"), null);
  assert.equal(
    calendarConnectFailure(
      { success: false, error: "[SEALED_MODE] blocked", code: "SEALED_MODE", phase: "refused" },
      "oauth"
    ),
    "sealedRefused"
  );
  assert.equal(
    calendarConnectFailure(
      { success: false, error: "x", code: "SEALED_MODE", phase: "interrupted" },
      "oauth"
    ),
    "sealedInterrupted"
  );
  assert.equal(
    calendarConnectFailure({ success: false, error: "access_denied" }, "oauth"),
    "cancelled"
  );
  assert.equal(calendarConnectFailure({ success: false, error: "boom" }, "oauth"), "failed");
  assert.equal(
    calendarConnectFailure(
      { success: false, reason: "sealed", error: "NATIVE_BOUNDARY_UNAVAILABLE" },
      "apple"
    ),
    "sealedNative"
  );
  assert.equal(calendarConnectFailure({ success: false, reason: "denied" }, "apple"), "denied");
  assert.equal(
    calendarConnectFailure({ success: false, reason: "helper-missing" }, "apple"),
    "failed"
  );
  assert.match(resources.en.sealedMode.calendar.connectRefused, /Nothing was sent/);
  assert.match(resources.en.sealedMode.calendar.connectInterrupted, /may have received/);
  for (const key of Object.values(SEALED_CONNECT_COPY))
    for (const l of LOCALES)
      assert.equal(typeof lookup(resources[l], key), "string", `${l}:${key}`);
  const view = fs.readFileSync(path.join(root, "src/components/IntegrationsView.tsx"), "utf8");
  assert.equal(
    (view.match(/calendarConnectFailure\(result, "(oauth|apple)"\)/g) ?? []).length,
    3,
    "all three connects use it"
  );
});

test("erase: a sealed-refused Google revoke reaches the reset outcome (T11-M5)", async () => {
  const { resetOutcome } = await import("../../src/components/settings/storageMath.ts");
  assert.deepEqual(
    resetOutcome({
      success: true,
      message: "Cleanup completed",
      errors: [],
      googleGrantKept: true,
    }),
    { ok: true, errors: [], googleGrantKept: true }
  );
  assert.deepEqual(resetOutcome({ success: true, message: "Cleanup completed", errors: [] }), {
    ok: true,
    errors: [],
  });
  assert.match(
    resources.en.sealedMode.calendar.googleGrantKept,
    /until you remove it in your Google Account/
  );
});
