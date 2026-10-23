const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// Final review I4 (T14-M6 and the "Nothing leaves" strings). Plan 07a has no
// native boundary: Loqui cannot attest that nothing leaves this computer, and
// its local engines don't run while Sealed mode is on. Local routes may say
// Loqui doesn't send content to a provider; they may not claim that nothing
// leaves, that tasks can only run on this device, or that sealing keeps a
// task here. Translations are in-model; no native speaker has verified them.

const root = path.join(__dirname, "../..");
const LOCALES = ["ar", "de", "en", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"];
const resources = Object.fromEntries(
  LOCALES.map((l) => [
    l,
    JSON.parse(fs.readFileSync(path.join(root, "src/locales", l, "translation.json"), "utf8")),
  ])
);
const lookup = (json, key) => key.split(".").reduce((node, part) => node?.[part], json);

const KEYS = [
  "settingsPage.aiModels.modes.localDesc",
  "settingsPage.transcription.modes.localDesc",
  "dictationAgent.modes.localDesc",
  "agentMode.settings.modes.localDesc",
  "patchbay.dest.nothingLeaves",
  "patchbay.leaves.none",
  "setupFlow.tour.privacy.bodyMac",
  "setupFlow.tour.privacy.bodyOther",
  "patchbay.sealed",
  "patchbay.no.sealed",
  "reasoning.mode.localDescription",
  "patchbay.locked.semanticSearch",
];

// The pre-07a absolute claims, as each locale phrased them.
const ABSOLUTE = {
  en: /nothing leaves|can only run on this device|keeps this task on this device|complete privacy|never sends/i,
  ar: /لا يغادر شيء|لا تُرسل أي بيانات خارجه|لا يُرسل شيء إلى الخارج|لا يُرسل أي شيء خارج|لا يمكن تشغيل المهام إلا|يحتفظ الوضع المغلق بهذه المهمة|خصوصية تامة|أي مكان أبدًا/,
  de: /Nichts verlässt|Keine Übertragung nach außen|nur auf diesem Gerät ausgeführt|behält diese Aufgabe|Volle Privatsphäre|niemals irgendwohin/i,
  es: /Nada sale|solo se pueden ejecutar|mantiene esta tarea|Privacidad total|nunca envía/i,
  fr: /Rien n’en sort|Rien ne part|Rien ne sort|Rien ne quitte|ne peuvent s'exécuter que|conserve cette tâche|Confidentialité totale|jamais vos notes/i,
  it: /Nulla lo lascia|Nessun invio all’esterno|Niente lascia|Nulla lascia|possono essere eseguite solo|mantiene questa attività|Privacy completa|non invia mai/i,
  ja: /外部には何も送信されません|外部へ送信されるものはありません|何も送信されません|でのみ実行できます|保持されます|完全なプライバシー|どこにも送信/,
  pt: /Nada sai|só podem ser executadas|mantém esta tarefa|Privacidade total|nunca envia/i,
  ru: /Ничего не передаётся за его пределы|Ничего не уходит|Ничего не покидает|Ничто не покидает|только на этом устройстве|сохраняет эту задачу|Полная приватность|никогда никуда/i,
  "zh-CN":
    /不会向外发送任何内容|不向外发送任何内容|以外发送任何内容|不会有任何内容离开|只能在此设备上运行|保留在此设备上|完全隐私|永远不会/,
  "zh-TW":
    /不會向外傳送任何內容|不向外傳送任何內容|以外傳送任何內容|不會有任何內容離開|只能在此裝置上執行|保留在此裝置上|完全私密|永遠不會/,
};

test("I4: local and sealed route copy makes no absolute 'nothing leaves' claim in any locale", () => {
  const bad = [];
  for (const l of LOCALES)
    for (const key of KEYS) {
      const value = lookup(resources[l], key);
      if (typeof value !== "string" || !value.trim()) bad.push(`${l}:${key} missing`);
      else if (ABSOLUTE[l].test(value)) bad.push(`${l}:${key}: ${value}`);
      else if (l !== "en" && value === lookup(resources.en, key))
        bad.push(`${l}:${key} untranslated`);
    }
  assert.deepEqual(bad, []);
});

test("I4: the English copy says what Loqui does, not that nothing leaves", () => {
  const en = (key) => lookup(resources.en, key);
  for (const key of KEYS.filter((k) => k.endsWith("localDesc")))
    assert.match(en(key), /doesn't send your content to a provider/, key);
  assert.match(en("patchbay.dest.nothingLeaves"), /^Not sent to a provider$/);
  assert.match(en("patchbay.leaves.none"), /provider or server/);
  for (const key of ["setupFlow.tour.privacy.bodyMac", "setupFlow.tour.privacy.bodyOther"])
    assert.match(en(key), /unless you choose one/, key);
  // On 07a, sealing pauses outgoing work and the local engines don't run either.
  assert.match(en("patchbay.sealed"), /local engines don't run while Sealed mode is on/);
  assert.doesNotMatch(en("patchbay.sealed"), /only run on this device/);
  assert.doesNotMatch(en("patchbay.no.sealed"), /keeps this task/);
  assert.doesNotMatch(en("reasoning.mode.localDescription"), /privacy/i);
  assert.match(en("patchbay.locked.semanticSearch"), /doesn't send your notes to a provider/);
  // No English string anywhere repeats the old claims.
  const all = JSON.stringify(resources.en);
  assert.doesNotMatch(
    all,
    /nothing leaves|tasks can only run on this device|keeps this task on this device/i
  );
});
