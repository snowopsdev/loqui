const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingDetection.ts");
const plenty = 500e9;

test("an English Mac gets the fast English voice", async () => {
  const { detectVoice } = await load();
  for (const locales of [["en-US"], ["en-GB", "en-US"], []]) {
    const pick = detectVoice({ locales, freeDiskBytes: plenty });
    assert.equal(pick.modelId, "parakeet-unified-en-0.6b", JSON.stringify(locales));
    assert.equal(pick.outcome, "fastEnglish");
    assert.deepEqual(pick.reason, { kind: "english" });
    assert.equal(pick.disk, null);
  }
});

test("two languages pick one offline voice that hears both", async () => {
  const { detectVoice } = await load();
  const pick = detectVoice({ locales: ["es-ES", "en-US"], freeDiskBytes: plenty });
  assert.equal(pick.modelId, "orukeet-v0.1.0");
  assert.equal(pick.outcome, "manyLanguages");
  assert.deepEqual(pick.reason, { kind: "multilingual", languages: ["es", "en"] });
  assert.equal(detectVoice({ locales: ["pt-BR", "en-US"], freeDiskBytes: plenty }).modelId, "orukeet-v0.1.0");
});

test("Japanese never gets an English-only voice", async () => {
  const { detectVoice } = await load();
  const solo = detectVoice({ locales: ["ja-JP"], freeDiskBytes: plenty });
  assert.equal(solo.modelId, "nemotron-3.5-asr-streaming-0.6b");
  assert.deepEqual(solo.reason, { kind: "language", language: "ja" });
  const mixed = detectVoice({ locales: ["ja-JP", "en-US"], freeDiskBytes: plenty });
  assert.equal(mixed.modelId, "nemotron-3.5-asr-streaming-0.6b");
  assert.deepEqual(mixed.reason, { kind: "multilingual", languages: ["ja", "en"] });
  assert.equal(detectVoice({ locales: ["de-DE", "ja-JP"], freeDiskBytes: plenty }).modelId, "nemotron-3.5-asr-streaming-0.6b");
});

test("an unsupported language is said out loud, with no model guessed", async () => {
  const { detectVoice, spokenLocalesFor, voiceSupportsAll } = await load();
  for (const [locales, language] of [[["he-IL"], "he"], [["zh-Hant-TW"], "zh"]]) {
    const pick = detectVoice({ locales, freeDiskBytes: plenty });
    assert.equal(pick.modelId, null);
    assert.equal(pick.outcome, null);
    assert.deepEqual(pick.languages, []);
    assert.deepEqual(pick.reason, { kind: "unsupported", language });
  }
  const partial = detectVoice({ locales: ["he-IL", "fr-FR"], freeDiskBytes: plenty });
  assert.equal(partial.modelId, "orukeet-v0.1.0");
  assert.deepEqual(partial.reason, { kind: "language", language: "fr" });
  assert.deepEqual(partial.languages, ["fr"]);
  const spoken = spokenLocalesFor(["he-IL", "fr-FR"], partial.languages);
  assert.deepEqual(spoken, ["fr-FR"]);
  assert.equal(voiceSupportsAll(partial.modelId, spoken), true);
});

test("disk is flagged when free space is under 2.5 times the download", async () => {
  const { detectVoice, modelDownloadBytes } = await load();
  assert.equal(modelDownloadBytes("parakeet-unified-en-0.6b"), 631_000_000);
  const short = detectVoice({ locales: ["en-US"], freeDiskBytes: 412_000_000 });
  assert.deepEqual(short.disk, { neededBytes: 1_577_500_000, freeBytes: 412_000_000 });
  assert.equal(short.modelId, "parakeet-unified-en-0.6b");
  assert.equal(detectVoice({ locales: ["en-US"], freeDiskBytes: null }).disk, null);
});

test("base languages ignore junk and keep OS order", async () => {
  const { baseLanguages } = await load();
  assert.deepEqual(baseLanguages(["en_US", "EN-gb", "", "1234", "fil-PH", "de"]), ["en", "fil", "de"]);
  assert.deepEqual(baseLanguages([]), ["en"]);
});

test("detection applies only until the user has chosen a voice", async () => {
  const { shouldApplyDetectedVoice } = await load();
  assert.equal(shouldApplyDetectedVoice(null), true);
  assert.equal(shouldApplyDetectedVoice("orukeet-v0.1.0"), false);
});

test("a language change keeps, replaces or clears the voice; never an incompatible one", async () => {
  const { reconcileVoice, voiceSupportsAll } = await load();
  assert.deepEqual(reconcileVoice("orukeet-v0.1.0", ["de-DE"]), { modelId: "orukeet-v0.1.0", changed: false });
  assert.deepEqual(reconcileVoice("parakeet-unified-en-0.6b", ["ja-JP"]), { modelId: "nemotron-3.5-asr-streaming-0.6b", changed: true });
  assert.deepEqual(reconcileVoice("parakeet-unified-en-0.6b", ["he-IL"]), { modelId: null, changed: true });
  assert.deepEqual(reconcileVoice(null, ["es-ES", "en-US"]), { modelId: "orukeet-v0.1.0", changed: true });
  assert.equal(voiceSupportsAll("parakeet-unified-en-0.6b", ["en-US", "ja-JP"]), false);
  assert.equal(voiceSupportsAll("nemotron-3.5-asr-streaming-0.6b", ["en-US", "ja-JP"]), true);
  assert.equal(voiceSupportsAll("nemotron-3.5-asr-streaming-0.6b", []), false);
});

test("only catalog voices count as an explicit onboarding choice", async () => {
  const { isOnboardingVoice } = await load();
  assert.equal(isOnboardingVoice("orukeet-v0.1.0"), true);
  assert.equal(isOnboardingVoice("cohere-transcribe-03-2026"), false);
  assert.equal(isOnboardingVoice(null), false);
});

test("spoken languages keep the OS's full locale tags for the voice's languages", async () => {
  const { spokenLocalesFor } = await load();
  assert.deepEqual(spokenLocalesFor(["es-ES", "en-US", "he-IL"], ["es", "en"]), ["es-ES", "en-US"]);
  assert.deepEqual(spokenLocalesFor([], ["en"]), ["en"]);
});
