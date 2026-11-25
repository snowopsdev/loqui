const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

// Loads LocalEmbeddings without starting the ONNX worker or the debug logger.
function loadLocalEmbeddings() {
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === "./onnxWorkerClient") return {};
    if (request === "./debugLogger") return { debug() {}, info() {}, warn() {}, error() {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = require.resolve("../../src/helpers/localEmbeddings");
  delete require.cache[modulePath];
  try {
    return require(modulePath).LocalEmbeddings;
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  }
}

const { noteEmbedText, transcriptText } = loadLocalEmbeddings();
const transcript = JSON.stringify([
  { text: "Let's move the launch to April.", speaker: "speaker_0" },
  { text: "Legal still needs the DPA.", speakerName: "Priya" },
  { text: "Unnamed placeholder.", speakerName: "Speaker 2", speakerIsPlaceholder: true },
]);

test("[change-driving] a meeting with no typed notes embeds its transcript", () => {
  assert.equal(
    noteEmbedText("Launch sync", "", null, transcript),
    "Launch sync\nLet's move the launch to April.\nPriya: Legal still needs the DPA.\nUnnamed placeholder."
  );
});

test("[change-driving] a sparse body is topped up with the transcript", () => {
  assert.equal(
    noteEmbedText("Launch sync", "todo: DPA", null, transcript).split("\n").slice(0, 3).join("\n"),
    "Launch sync\ntodo: DPA\nLet's move the launch to April."
  );
});

test("a substantial body is embedded alone, preferring the AI summary", () => {
  const summary = "Summary. ".repeat(40);
  const text = noteEmbedText("T", "typed notes", summary, transcript);
  assert.equal(text, `T\n${summary.trim()}`);
  assert.doesNotMatch(text, /launch to April|typed notes/);
  const typed = "typed ".repeat(50);
  assert.equal(noteEmbedText("T", typed, null, transcript), `T\n${typed.trim()}`);
});

test("embed text stays capped and tolerates missing or malformed transcripts", () => {
  const long = JSON.stringify([{ text: "word ".repeat(1000) }]);
  assert.equal(noteEmbedText("T", "", "", long).length, 1500);
  assert.equal(noteEmbedText("T", "", null, null), "T");
  assert.equal(noteEmbedText("T", "body", null), "T\nbody");
  assert.equal(noteEmbedText("T", "", null, "{not json"), "T\n{not json");
  assert.equal(transcriptText('{"text":"x"}'), "");
  assert.equal(transcriptText([null, { text: 7 }, { text: " ok " }]), "ok");
});
