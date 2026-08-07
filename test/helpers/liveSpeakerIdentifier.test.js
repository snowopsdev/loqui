const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const identifierModulePath = require.resolve("../../src/helpers/liveSpeakerIdentifier");
const originalLoad = Module._load;

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function loadIdentifier() {
  delete require.cache[identifierModulePath];
  const warnings = [];

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === "./debugLogger") {
      return {
        info() {},
        warn(message, data) {
          warnings.push({ message, data });
        },
        debug() {},
        error() {},
      };
    }
    if (request === "./speakerEmbeddings") {
      return {
        MAX_EMBEDDING_SECONDS: 8,
        isAvailable: () => true,
        cosineSimilarity,
        extractEmbeddingFromSamples: async () => null,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { LiveSpeakerIdentifier } = require(identifierModulePath);
    return { LiveSpeakerIdentifier, warnings };
  } finally {
    Module._load = originalLoad;
  }
}

const unit = (values) => {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return new Float32Array(values.map((v) => v / norm));
};

const voiceA = unit([1, 0, 0]);
const voiceB = unit([0, 1, 0]);
// ~0.7 similar to both A and B: fails the match margin, so it mints a cluster
// that the next recluster pass merges back into A.
const ambiguousVoice = unit([0.7, 0.7, 0.14]);
const voiceC = unit([0.05, 0.05, 0.99]);

function seedMergedSession(identifier) {
  identifier.setMaxSpeakers(3);
  identifier._resolveSpeakerForEmbedding(voiceA, { updateCentroid: true });
  identifier._resolveSpeakerForEmbedding(voiceB, { updateCentroid: true });
  identifier._resolveSpeakerForEmbedding(ambiguousVoice, { updateCentroid: true });
  const merges = identifier._performRecluster();
  assert.equal(merges.length, 1, "expected the ambiguous cluster to merge away");
  return merges[0];
}

test("new voice after a recluster merge reuses the freed speaker slot", () => {
  const { LiveSpeakerIdentifier } = loadIdentifier();
  const identifier = new LiveSpeakerIdentifier();

  const merge = seedMergedSession(identifier);
  assert.equal(merge.remove, "speaker_2");

  const resolved = identifier._resolveSpeakerForEmbedding(voiceC, { updateCentroid: true });
  assert.equal(
    resolved.speakerId,
    "speaker_2",
    "a freed slot must be reused so cluster ids stay aligned with the labels the UI shows"
  );
});

test("manual identification sticks for a voice that appeared after a merge", () => {
  const { LiveSpeakerIdentifier } = loadIdentifier();
  const identifier = new LiveSpeakerIdentifier();

  seedMergedSession(identifier);
  identifier._resolveSpeakerForEmbedding(voiceC, { updateCentroid: true });

  // "speaker_2" is the label the transcript shows for the new voice — the
  // renderer reuses the slot freed by the merge. Naming that label must work.
  const mapped = identifier.mapSpeaker("speaker_2", 42, "Carol", 7);
  assert.equal(mapped, true, "mapSpeaker must recognize the id shown in the transcript");

  const embedding = identifier.getSpeakerEmbedding("speaker_2");
  assert.ok(embedding, "profile persistence needs the cluster embedding");

  const again = identifier._resolveSpeakerForEmbedding(voiceC, { updateCentroid: true });
  assert.equal(again.displayName, "Carol", "the manual name must carry to later speech");
});

test("stop() state keys match the resolved speaker ids", async () => {
  const { LiveSpeakerIdentifier } = loadIdentifier();
  const identifier = new LiveSpeakerIdentifier();

  seedMergedSession(identifier);
  identifier._resolveSpeakerForEmbedding(voiceC, { updateCentroid: true });

  const state = identifier.getTransientState();
  assert.deepEqual(
    Object.keys(state).sort(),
    ["speaker_0", "speaker_1", "speaker_2"],
    "post-meeting reconciliation looks mappings up by these keys"
  );
});

test("mapSpeaker on an unknown id fails loudly", () => {
  const { LiveSpeakerIdentifier, warnings } = loadIdentifier();
  const identifier = new LiveSpeakerIdentifier();

  identifier.setMaxSpeakers(3);
  identifier._resolveSpeakerForEmbedding(voiceA, { updateCentroid: true });

  const mapped = identifier.mapSpeaker("speaker_9", 1, "Alice", null);
  assert.equal(mapped, false);
  assert.ok(
    warnings.some((w) => /speaker/i.test(w.message)),
    "a dropped manual identification must leave a trace in the logs"
  );
});

test("distinct voices are folded into one cluster when the session cap is 1", () => {
  const { LiveSpeakerIdentifier } = loadIdentifier();
  const identifier = new LiveSpeakerIdentifier();
  identifier.setMaxSpeakers(1);

  const first = identifier._resolveSpeakerForEmbedding(voiceA, { updateCentroid: true });
  const second = identifier._resolveSpeakerForEmbedding(voiceB, { updateCentroid: true });

  assert.equal(cosineSimilarity(voiceA, voiceB), 0);
  assert.equal(
    second.speakerId,
    first.speakerId,
    "at the cap, new voices are force-merged into the nearest cluster by design"
  );
});
